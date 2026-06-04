from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.market_parser.models.entities import ParserRun
from app.modules.market_parser.repositories.category_repo import CategoryRepository
from app.modules.market_parser.repositories.run_repo import RunRepository
from app.modules.market_parser.repositories.source_repo import SourceRepository
from app.modules.market_parser.schemas.run import RunCreate
from app.modules.market_parser.services.parser_service import ParserService

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class AutoRunDecision:
    should_run: bool
    reason: str
    payload: RunCreate | None = None


class AutoRunScheduler:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if not settings.parser_auto_run_enabled:
            logger.info("parser auto-run scheduler disabled")
            return
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run_loop(), name="market-parser-auto-run")
        logger.info(
            "parser auto-run scheduler started",
            extra={
                "source_code": settings.parser_auto_run_source_code,
                "interval_days": settings.parser_auto_run_interval_days,
            },
        )

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
        logger.info("parser auto-run scheduler stopped")

    async def _run_loop(self) -> None:
        startup_delay = max(settings.parser_auto_run_startup_delay_seconds, 0)
        if startup_delay:
            await asyncio.sleep(startup_delay)

        while True:
            try:
                await run_due_parser_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("parser auto-run check failed")

            await asyncio.sleep(max(settings.parser_auto_run_check_interval_seconds, 60))


async def run_due_parser_once(now: datetime | None = None) -> AutoRunDecision:
    with SessionLocal() as db:
        decision = build_auto_run_decision(db, now=now)
        if not decision.should_run or decision.payload is None:
            logger.info("parser auto-run skipped", extra={"reason": decision.reason})
            return decision
        logger.info("parser auto-run started", extra={"source_id": decision.payload.source_id})
        await ParserService(db).run_parser(decision.payload)
        logger.info("parser auto-run finished", extra={"source_id": decision.payload.source_id})
        return decision


def build_auto_run_decision(db: Session, now: datetime | None = None) -> AutoRunDecision:
    now = now or datetime.now(timezone.utc)
    interval = timedelta(days=max(settings.parser_auto_run_interval_days, 1))

    source = SourceRepository(db).get_by_code(settings.parser_auto_run_source_code)
    if source is None:
        return AutoRunDecision(False, "source_not_found")
    if not source.is_active:
        return AutoRunDecision(False, "source_inactive")

    categories = CategoryRepository(db)
    enabled_leaf_categories = [
        category
        for category in categories.list(source_id=source.id, enabled_only=True)
        if not categories.has_children(category.id)
    ]
    if not enabled_leaf_categories:
        return AutoRunDecision(False, "no_enabled_categories")

    runs = RunRepository(db)
    if runs.has_active_run(source.id):
        return AutoRunDecision(False, "active_run_exists")

    latest = runs.latest_for_source(source.id)
    if latest is not None and not is_run_due(latest, now, interval):
        return AutoRunDecision(False, "interval_not_elapsed")

    return AutoRunDecision(
        True,
        "due",
        RunCreate(
            source_id=source.id,
            category_ids=[],
            parse_all_enabled=True,
            created_by="scheduler",
        )
    )


def is_run_due(run: ParserRun, now: datetime, interval: timedelta) -> bool:
    last_run_at = normalize_datetime(run.started_at or run.created_at)
    return now - last_run_at >= interval


def normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
