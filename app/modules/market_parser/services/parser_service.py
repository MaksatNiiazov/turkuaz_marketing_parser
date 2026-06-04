from __future__ import annotations

import logging
import asyncio
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.market_parser.models.entities import ParserRun
from app.modules.market_parser.repositories.category_repo import CategoryRepository
from app.modules.market_parser.repositories.run_repo import RunRepository
from app.modules.market_parser.repositories.source_repo import SourceRepository
from app.modules.market_parser.schemas.category import CategoryCreate
from app.modules.market_parser.schemas.run import RunCreate
from app.modules.market_parser.services.globus_parser import BaseMarketParser, GlobusParser
from app.modules.market_parser.services.snapshot_service import SnapshotService

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class CategoryFetchResult:
    category_id: int
    category_name: str
    run_category_id: int
    products: list
    error: Exception | None = None


class ParserService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.sources = SourceRepository(db)
        self.categories = CategoryRepository(db)
        self.runs = RunRepository(db)
        self.snapshots = SnapshotService(db)

    async def sync_categories(self, source_id: int) -> list:
        source = self.sources.get(source_id)
        if source is None:
            raise ValueError("Source not found")
        parser = self._parser_for_source(source.code, source.base_url)
        parsed_categories = await parser.fetch_categories()
        parent_items = [
            CategoryCreate(
                source_id=source.id,
                external_id=item.external_id,
                name=item.name,
                url=item.url,
                is_enabled=not item.is_group,
            )
            for item in parsed_categories
            if item.parent_external_id is None
        ]
        parents = self.categories.upsert_many(parent_items)
        parent_by_external_id = {
            category.external_id: category
            for category in parents
            if category.external_id
        }
        child_items = [
            CategoryCreate(
                source_id=source.id,
                external_id=item.external_id,
                name=item.name,
                url=item.url,
                parent_id=parent_by_external_id[item.parent_external_id].id,
                is_enabled=True,
            )
            for item in parsed_categories
            if item.parent_external_id and item.parent_external_id in parent_by_external_id
        ]
        children = self.categories.upsert_many(child_items)
        saved = parents + children
        self.categories.disable_parents_with_children(source_id=source.id)
        self.categories.disable_missing(
            source_id=source.id,
            external_ids={item.external_id for item in parent_items + child_items if item.external_id},
        )
        self.db.commit()
        return saved

    async def run_parser(self, payload: RunCreate) -> ParserRun:
        run = self.create_parser_run(payload)
        await self.execute_parser_run(payload, run.id)
        finished = self.runs.get(run.id)
        assert finished is not None
        return finished

    def create_parser_run(self, payload: RunCreate) -> ParserRun:
        source = self.sources.get(payload.source_id)
        if source is None:
            raise ValueError("Source not found")
        categories = self._parse_categories(source.id, payload)
        run = self.runs.create_running(
            source_id=source.id,
            total_categories=len(categories),
            created_by=payload.created_by,
        )
        self.db.commit()
        logger.info("parser run queued", extra={"run_id": run.id, "source": source.code})
        return run

    async def execute_parser_run(self, payload: RunCreate, run_id: int) -> ParserRun:
        source = self.sources.get(payload.source_id)
        if source is None:
            raise ValueError("Source not found")
        categories = self._parse_categories(source.id, payload)
        run = self.runs.get(run_id)
        if run is None:
            raise ValueError("Run not found")
        logger.info("parser run started", extra={"run_id": run.id, "source": source.code})

        parser = self._parser_for_source(source.code, source.base_url)
        processed = 0
        total_products = 0
        saved_products = 0
        errors: list[str] = []

        tasks = []
        semaphore = asyncio.Semaphore(settings.parser_concurrency)
        for category in categories:
            run_category = self.runs.start_category(run.id, category.id)
            self.db.commit()
            tasks.append(
                asyncio.create_task(
                    self._fetch_category_products(parser, category, run_category.id, semaphore)
                )
            )

        for task in asyncio.as_completed(tasks):
            result = await task
            run_category = self.runs.get_category(result.run_category_id)
            if run_category is None:
                errors.append(f"{result.category_name}: run category not found")
                processed += 1
                continue
            try:
                if result.error is not None:
                    raise result.error
                category_saved = 0
                for product in result.products:
                    self.snapshots.save_product_snapshot(
                        source_id=source.id,
                        category_id=result.category_id,
                        run_id=run.id,
                        parsed=product,
                    )
                    category_saved += 1
                processed += 1
                total_products += len(result.products)
                saved_products += category_saved
                self.runs.finish_category(
                    run_category,
                    status="success",
                    products_found=len(result.products),
                    products_saved=category_saved,
                )
                self.runs.update_progress(
                    run,
                    processed_categories=processed,
                    total_products=total_products,
                    saved_products=saved_products,
                    error_message="\n".join(errors) or None,
                )
                self.db.commit()
                logger.info(
                    "parser category completed",
                    extra={
                        "run_id": run.id,
                        "category_id": result.category_id,
                        "products": len(result.products),
                    },
                )
            except Exception as exc:  # noqa: BLE001
                processed += 1
                message = summarize_parser_error(exc)
                errors.append(f"{result.category_name}: {message}")
                self.db.rollback()
                run = self.runs.get(run.id)
                assert run is not None
                run_category = self.runs.get_category(result.run_category_id)
                if run_category is not None:
                    self.runs.finish_category(run_category, status="failed", error_message=message)
                self.runs.update_progress(
                    run,
                    processed_categories=processed,
                    total_products=total_products,
                    saved_products=saved_products,
                    error_message="\n".join(errors) or None,
                )
                self.db.commit()
                logger.exception(
                    "parser category failed",
                    extra={"run_id": run.id, "category_id": result.category_id},
                )

        status = "success" if not errors else ("failed" if saved_products == 0 else "partial")
        finished_run = self.runs.get(run.id)
        assert finished_run is not None
        self.runs.finish_run(
            finished_run,
            status=status,
            processed_categories=processed,
            total_products=total_products,
            saved_products=saved_products,
            error_message="\n".join(errors) or None,
        )
        self.db.commit()
        logger.info("parser run finished", extra={"run_id": run.id, "status": status})
        return finished_run

    async def _fetch_category_products(
        self,
        parser: BaseMarketParser,
        category,
        run_category_id: int,
        semaphore: asyncio.Semaphore,
    ) -> CategoryFetchResult:
        async with semaphore:
            try:
                products = await parser.fetch_products_by_category(category)
                return CategoryFetchResult(
                    category_id=category.id,
                    category_name=category.name,
                    run_category_id=run_category_id,
                    products=products,
                )
            except Exception as exc:  # noqa: BLE001
                return CategoryFetchResult(
                    category_id=category.id,
                    category_name=category.name,
                    run_category_id=run_category_id,
                    products=[],
                    error=exc,
                )

    def _parser_for_source(self, code: str, base_url: str) -> BaseMarketParser:
        if code == "globus":
            return GlobusParser(base_url=base_url)
        raise ValueError(f"Unsupported source: {code}")

    def _parse_categories(self, source_id: int, payload: RunCreate):
        if payload.parse_all_enabled:
            return [
                category
                for category in self.categories.list(source_id=source_id, enabled_only=True)
                if not self.categories.has_children(category.id)
            ]

        selected = self.categories.list_by_ids(payload.category_ids)
        child_categories = self.categories.list_child_categories(
            [category.id for category in selected],
            enabled_only=True,
        )
        selected_leaf = [category for category in selected if not self.categories.has_children(category.id)]
        merged = {category.id: category for category in selected_leaf + child_categories}
        return list(merged.values())


def summarize_parser_error(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        if status_code == 404:
            return "Globus вернул 404: раздел не найден или больше недоступен"
        if status_code == 403:
            return "Globus запретил доступ к разделу (403)"
        if status_code == 429:
            return "Globus ограничил частоту запросов (429), нужно повторить позже"
        if status_code >= 500:
            return f"Globus временно недоступен (HTTP {status_code})"
        return f"Globus вернул HTTP {status_code}"
    if isinstance(exc, httpx.TimeoutException):
        return "Globus не ответил вовремя, нужно повторить запуск позже"
    if isinstance(exc, httpx.TransportError):
        return "Не удалось подключиться к Globus"
    message = str(exc).strip()
    return message or exc.__class__.__name__
