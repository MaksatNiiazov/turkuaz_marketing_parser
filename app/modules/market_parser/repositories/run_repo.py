from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm import selectinload

from app.modules.market_parser.models.entities import ParserRun, ParserRunCategory


class RunRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(self, source_id: int | None = None) -> list[ParserRun]:
        stmt = select(ParserRun).order_by(ParserRun.created_at.desc())
        if source_id is not None:
            stmt = stmt.where(ParserRun.source_id == source_id)
        result = self.db.execute(stmt)
        return list(result.scalars().all())

    def latest_for_source(self, source_id: int) -> ParserRun | None:
        result = self.db.execute(
            select(ParserRun)
            .where(ParserRun.source_id == source_id)
            .order_by(ParserRun.created_at.desc(), ParserRun.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    def has_active_run(self, source_id: int) -> bool:
        result = self.db.execute(
            select(ParserRun.id)
            .where(ParserRun.source_id == source_id, ParserRun.status.in_(("pending", "running")))
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    def get(self, run_id: int) -> ParserRun | None:
        result = self.db.execute(
            select(ParserRun).options(selectinload(ParserRun.categories)).where(ParserRun.id == run_id)
        )
        return result.scalar_one_or_none()

    def get_category(self, run_category_id: int) -> ParserRunCategory | None:
        return self.db.get(ParserRunCategory, run_category_id)

    def create_running(
        self, source_id: int, total_categories: int, created_by: str | None = None
    ) -> ParserRun:
        now = datetime.now(timezone.utc)
        run = ParserRun(
            source_id=source_id,
            status="running",
            started_at=now,
            total_categories=total_categories,
            created_by=created_by,
        )
        self.db.add(run)
        self.db.flush()
        return run

    def start_category(self, run_id: int, category_id: int) -> ParserRunCategory:
        item = ParserRunCategory(
            run_id=run_id,
            category_id=category_id,
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        self.db.add(item)
        self.db.flush()
        return item

    def finish_category(
        self,
        item: ParserRunCategory,
        status: str,
        products_found: int = 0,
        products_saved: int = 0,
        error_message: str | None = None,
    ) -> ParserRunCategory:
        item.status = status
        item.products_found = products_found
        item.products_saved = products_saved
        item.error_message = error_message
        item.finished_at = datetime.now(timezone.utc)
        self.db.flush()
        return item

    def finish_run(
        self,
        run: ParserRun,
        status: str,
        processed_categories: int,
        total_products: int,
        saved_products: int,
        error_message: str | None = None,
    ) -> ParserRun:
        run.status = status
        run.processed_categories = processed_categories
        run.total_products = total_products
        run.saved_products = saved_products
        run.error_message = error_message
        run.finished_at = datetime.now(timezone.utc)
        self.db.flush()
        return run

    def update_progress(
        self,
        run: ParserRun,
        processed_categories: int,
        total_products: int,
        saved_products: int,
        error_message: str | None = None,
    ) -> ParserRun:
        run.processed_categories = processed_categories
        run.total_products = total_products
        run.saved_products = saved_products
        run.error_message = error_message
        self.db.flush()
        return run
