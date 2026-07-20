from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.modules.market_parser.models.entities import (
    MarketProduct,
    MarketProductSnapshot,
    ParserCategory,
    ParserRun,
    ParserRunCategory,
)
from app.modules.market_parser.schemas.reports import (
    ComparisonItem,
    ComparisonSummary,
    DataQualityReport,
    QualityIssue,
    ReportRun,
    RunComparisonReport,
)


FINISHED_RUN_STATUSES = ("success", "partial")


class ReportService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def latest_run_pair(self, source_id: int) -> tuple[ParserRun, ParserRun]:
        runs = list(
            self.db.execute(
                select(ParserRun)
                .where(ParserRun.source_id == source_id, ParserRun.status.in_(FINISHED_RUN_STATUSES))
                .order_by(ParserRun.finished_at.desc(), ParserRun.id.desc())
                .limit(2)
            ).scalars()
        )
        if len(runs) < 2:
            raise ValueError("Для сравнения нужны минимум два завершенных запуска")
        return runs[1], runs[0]

    def compare_runs(
        self,
        base_run_id: int,
        compare_run_id: int,
        category_id: int | None = None,
        event_type: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> RunComparisonReport:
        base_run = self._run(base_run_id)
        compare_run = self._run(compare_run_id)
        if base_run.source_id != compare_run.source_id:
            raise ValueError("Запуски должны принадлежать одному источнику")
        if base_run.status not in FINISHED_RUN_STATUSES or compare_run.status not in FINISHED_RUN_STATUSES:
            raise ValueError("Сравнивать можно только завершенные успешные или частичные запуски")

        scope = self._category_scope(category_id) if category_id is not None else None
        base = self._snapshots(base_run_id, scope)
        current = self._snapshots(compare_run_id, scope)
        successful_categories = self._successful_categories(compare_run_id)
        summary = ComparisonSummary(
            base_products=len(base),
            current_products=len(current),
            available_products=sum(item.is_available is True for item in current.values()),
            unavailable_products=sum(item.is_available is False for item in current.values()),
            unknown_availability=sum(item.is_available is None for item in current.values()),
        )
        items: list[ComparisonItem] = []
        price_changes: list[Decimal] = []

        for product_id in sorted(set(base) | set(current)):
            old = base.get(product_id)
            new = current.get(product_id)
            product = (new or old).product
            events: list[str] = []
            if old is None:
                events.append("new_product")
                summary.new_products += 1
            elif new is None:
                # A missing snapshot is meaningful only when that category completed successfully.
                if old.category_id not in successful_categories:
                    continue
                events.append("disappeared_product")
                summary.disappeared_products += 1
            else:
                summary.comparable_products += 1
                if old.price is not None and new.price is not None:
                    change = percent_change(old.price, new.price)
                    if new.price > old.price:
                        events.append("price_increased")
                        summary.price_increased += 1
                    elif new.price < old.price:
                        events.append("price_decreased")
                        summary.price_decreased += 1
                    else:
                        summary.price_unchanged += 1
                    if change is not None:
                        price_changes.append(change)
                old_discount = is_discounted(old)
                new_discount = is_discounted(new)
                if not old_discount and new_discount:
                    events.append("promotion_started")
                    summary.promotions_started += 1
                elif old_discount and not new_discount:
                    events.append("promotion_ended")
                    summary.promotions_ended += 1
                if old.is_available is not True and new.is_available is True:
                    events.append("became_available")
                    summary.became_available += 1
                elif old.is_available is True and new.is_available is False:
                    events.append("became_unavailable")
                    summary.became_unavailable += 1

            if not events:
                continue
            item = ComparisonItem(
                product_id=product_id,
                sku=product.sku,
                name=product.name,
                category_id=(new or old).category_id,
                category_name=(new or old).category.name if (new or old).category else None,
                product_url=product.product_url,
                event_types=events,
                old_price=old.price if old else None,
                new_price=new.price if new else None,
                old_effective_price=effective_price(old),
                new_effective_price=effective_price(new),
                price_change_percent=(
                    percent_change(old.price, new.price)
                    if old and new and old.price is not None and new.price is not None
                    else None
                ),
                old_discount_percent=old.discount_percent if old else None,
                new_discount_percent=new.discount_percent if new else None,
                old_availability=old.is_available if old else None,
                new_availability=new.is_available if new else None,
            )
            if event_type is None or event_type in events:
                items.append(item)

        if price_changes:
            summary.average_price_change_percent = (
                sum(price_changes) / Decimal(len(price_changes))
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        items.sort(key=lambda item: abs(item.price_change_percent or Decimal("0")), reverse=True)
        return RunComparisonReport(
            base_run=run_read(base_run),
            compare_run=run_read(compare_run),
            summary=summary,
            items=items[offset : offset + limit],
            total=len(items),
            limit=limit,
            offset=offset,
        )

    def quality(self, source_id: int) -> DataQualityReport:
        latest = self.db.execute(
            select(ParserRun)
            .where(ParserRun.source_id == source_id)
            .order_by(ParserRun.created_at.desc(), ParserRun.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        product_ids = list(
            self.db.execute(select(MarketProduct.id).where(MarketProduct.source_id == source_id)).scalars()
        )
        snapshots = self._latest_product_snapshots(product_ids)
        failed_categories = 0
        if latest is not None:
            failed_categories = int(
                self.db.execute(
                    select(func.count(ParserRunCategory.id)).where(
                        ParserRunCategory.run_id == latest.id,
                        ParserRunCategory.status != "success",
                    )
                ).scalar_one()
            )
        missing_price = sum(row.price is None and row.discount_price is None for row in snapshots)
        missing_sku = self._missing_product_field(source_id, MarketProduct.sku)
        missing_image = self._missing_product_field(source_id, MarketProduct.image_url)
        missing_url = self._missing_product_field(source_id, MarketProduct.product_url)
        stale_categories = int(
            self.db.execute(
                select(func.count(ParserCategory.id)).where(
                    ParserCategory.source_id == source_id,
                    ParserCategory.is_enabled.is_(True),
                    ~ParserCategory.id.in_(
                        select(MarketProductSnapshot.category_id).where(
                            MarketProductSnapshot.run_id == latest.id if latest else False
                        )
                    ),
                )
            ).scalar_one()
        ) if latest else int(
            self.db.execute(select(func.count(ParserCategory.id)).where(
                ParserCategory.source_id == source_id, ParserCategory.is_enabled.is_(True)
            )).scalar_one()
        )
        issues = [
            QualityIssue(code="failed_categories", severity="critical" if failed_categories else "ok", label="Категории с ошибками", count=failed_categories),
            QualityIssue(code="stale_categories", severity="warning" if stale_categories else "ok", label="Категории без данных в последнем запуске", count=stale_categories),
            QualityIssue(code="missing_price", severity="critical" if missing_price else "ok", label="Товары без цены", count=missing_price),
            QualityIssue(code="missing_sku", severity="warning" if missing_sku else "ok", label="Товары без SKU", count=missing_sku),
            QualityIssue(code="missing_image", severity="info" if missing_image else "ok", label="Товары без изображения", count=missing_image),
            QualityIssue(code="missing_product_url", severity="warning" if missing_url else "ok", label="Товары без ссылки", count=missing_url),
        ]
        return DataQualityReport(
            latest_run=run_read(latest) if latest else None,
            failed_categories=failed_categories,
            stale_categories=stale_categories,
            missing_price=missing_price,
            missing_sku=missing_sku,
            missing_image=missing_image,
            missing_product_url=missing_url,
            issues=issues,
        )

    def _run(self, run_id: int) -> ParserRun:
        run = self.db.get(ParserRun, run_id)
        if run is None:
            raise ValueError(f"Запуск {run_id} не найден")
        return run

    def _snapshots(self, run_id: int, scope: set[int] | None) -> dict[int, MarketProductSnapshot]:
        stmt = (
            select(MarketProductSnapshot)
            .options(
                selectinload(MarketProductSnapshot.product),
                selectinload(MarketProductSnapshot.category),
            )
            .where(MarketProductSnapshot.run_id == run_id)
            .order_by(MarketProductSnapshot.collected_at)
        )
        if scope is not None:
            stmt = stmt.where(MarketProductSnapshot.category_id.in_(scope))
        return {row.product_id: row for row in self.db.execute(stmt).scalars()}

    def _successful_categories(self, run_id: int) -> set[int]:
        return set(self.db.execute(select(ParserRunCategory.category_id).where(
            ParserRunCategory.run_id == run_id, ParserRunCategory.status == "success"
        )).scalars())

    def _category_scope(self, category_id: int) -> set[int]:
        result = {category_id}
        pending = {category_id}
        while pending:
            children = set(self.db.execute(select(ParserCategory.id).where(
                ParserCategory.parent_id.in_(pending)
            )).scalars()) - result
            result.update(children)
            pending = children
        return result

    def _latest_product_snapshots(self, product_ids: list[int]) -> list[MarketProductSnapshot]:
        if not product_ids:
            return []
        ranked = select(
            MarketProductSnapshot.id,
            func.row_number().over(
                partition_by=MarketProductSnapshot.product_id,
                order_by=MarketProductSnapshot.collected_at.desc(),
            ).label("position"),
        ).where(MarketProductSnapshot.product_id.in_(product_ids)).subquery()
        return list(self.db.execute(
            select(MarketProductSnapshot).join(ranked, MarketProductSnapshot.id == ranked.c.id).where(ranked.c.position == 1)
        ).scalars())

    def _missing_product_field(self, source_id: int, field) -> int:
        return int(self.db.execute(select(func.count(MarketProduct.id)).where(
            MarketProduct.source_id == source_id, (field.is_(None) | (field == ""))
        )).scalar_one())


def is_discounted(snapshot: MarketProductSnapshot | None) -> bool:
    return bool(snapshot and (snapshot.discount_price is not None or snapshot.discount_percent is not None))


def effective_price(snapshot: MarketProductSnapshot | None) -> Decimal | None:
    if snapshot is None:
        return None
    return snapshot.discount_price if snapshot.discount_price is not None else snapshot.price


def percent_change(old: Decimal, new: Decimal) -> Decimal | None:
    if old == 0:
        return None
    return ((new - old) * Decimal("100") / old).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def run_read(run: ParserRun) -> ReportRun:
    return ReportRun(id=run.id, status=run.status, collected_at=run.finished_at or run.started_at or run.created_at)
