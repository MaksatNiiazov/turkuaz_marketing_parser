from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from app.modules.market_parser.models.entities import MarketProductSnapshot


class SnapshotRepository:
    def __init__(self, db: Session):
        self.db = db

    def _period_filter(
        self, stmt: Select, from_date: date | None = None, to_date: date | None = None
    ) -> Select:
        if from_date is not None:
            stmt = stmt.where(
                MarketProductSnapshot.collected_at
                >= datetime.combine(from_date, time.min, tzinfo=timezone.utc)
            )
        if to_date is not None:
            stmt = stmt.where(
                MarketProductSnapshot.collected_at
                <= datetime.combine(to_date, time.max, tzinfo=timezone.utc)
            )
        return stmt

    def create(
        self,
        product_id: int,
        source_id: int,
        category_id: int | None,
        run_id: int | None,
        price: Decimal | None,
        discount_price: Decimal | None,
        discount_percent: Decimal | None,
        is_available: bool | None,
        raw_data: dict,
        collected_at: datetime,
    ) -> MarketProductSnapshot:
        snapshot = MarketProductSnapshot(
            product_id=product_id,
            source_id=source_id,
            category_id=category_id,
            run_id=run_id,
            price=price,
            discount_price=discount_price,
            discount_percent=discount_percent,
            is_available=is_available,
            raw_data=raw_data,
            collected_at=collected_at,
        )
        self.db.add(snapshot)
        self.db.flush()
        return snapshot

    def list_for_product(
        self, product_id: int, from_date: date | None = None, to_date: date | None = None
    ) -> list[MarketProductSnapshot]:
        stmt = select(MarketProductSnapshot).where(MarketProductSnapshot.product_id == product_id)
        stmt = self._period_filter(stmt, from_date, to_date).order_by(MarketProductSnapshot.collected_at)
        result = self.db.execute(stmt)
        return list(result.scalars().all())

    def list_for_product_ids(
        self,
        product_ids: list[int],
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> list[MarketProductSnapshot]:
        if not product_ids:
            return []
        stmt = select(MarketProductSnapshot).where(MarketProductSnapshot.product_id.in_(product_ids))
        stmt = self._period_filter(stmt, from_date, to_date).order_by(
            MarketProductSnapshot.product_id,
            MarketProductSnapshot.collected_at,
        )
        result = self.db.execute(stmt)
        return list(result.scalars().all())

    def list_for_run(
        self,
        run_id: int,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> list[MarketProductSnapshot]:
        stmt = select(MarketProductSnapshot).where(MarketProductSnapshot.run_id == run_id)
        stmt = self._period_filter(stmt, from_date, to_date).order_by(
            MarketProductSnapshot.product_id,
            MarketProductSnapshot.collected_at,
        )
        result = self.db.execute(stmt)
        return list(result.scalars().all())

    def list_for_category(
        self, category_id: int, from_date: date | None = None, to_date: date | None = None
    ) -> list[MarketProductSnapshot]:
        stmt = select(MarketProductSnapshot).where(MarketProductSnapshot.category_id == category_id)
        stmt = self._period_filter(stmt, from_date, to_date).order_by(MarketProductSnapshot.collected_at)
        result = self.db.execute(stmt)
        return list(result.scalars().all())

    def list_all(
        self, from_date: date | None = None, to_date: date | None = None
    ) -> list[MarketProductSnapshot]:
        stmt = select(MarketProductSnapshot)
        stmt = self._period_filter(stmt, from_date, to_date).order_by(MarketProductSnapshot.collected_at)
        result = self.db.execute(stmt)
        return list(result.scalars().all())

    def latest_by_product_ids(
        self,
        product_ids: list[int],
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> list[MarketProductSnapshot]:
        if not product_ids:
            return []
        latest_stmt = select(
            MarketProductSnapshot.product_id,
            func.max(MarketProductSnapshot.collected_at).label("max_collected_at"),
        ).where(MarketProductSnapshot.product_id.in_(product_ids))
        latest_stmt = self._period_filter(latest_stmt, from_date, to_date)
        subq = (
            latest_stmt.group_by(MarketProductSnapshot.product_id)
            .subquery()
        )
        stmt = select(MarketProductSnapshot).join(
            subq,
            and_(
                MarketProductSnapshot.product_id == subq.c.product_id,
                MarketProductSnapshot.collected_at == subq.c.max_collected_at,
            ),
        )
        result = self.db.execute(stmt)
        return list(result.scalars().all())
