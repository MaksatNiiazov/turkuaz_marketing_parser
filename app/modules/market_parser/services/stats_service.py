from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session

from app.modules.market_parser.models.entities import MarketProductSnapshot
from app.modules.market_parser.repositories.product_repo import ProductRepository
from app.modules.market_parser.repositories.snapshot_repo import SnapshotRepository
from app.modules.market_parser.schemas.stats import (
    CategoryStats,
    PriceChangeItem,
    ProductDiscountItem,
    ProductDiscountPage,
    ProductStats,
)


class StatsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.products = ProductRepository(db)
        self.snapshots = SnapshotRepository(db)

    def product_stats(
        self, product_id: int, from_date: date | None = None, to_date: date | None = None
    ) -> ProductStats:
        product = self.products.get(product_id)
        snapshots = self.snapshots.list_for_product(product_id, from_date, to_date)
        prices = [effective_price(snapshot) for snapshot in snapshots if effective_price(snapshot) is not None]
        first_price = prices[0] if prices else None
        last_price = prices[-1] if prices else None
        return ProductStats(
            product_id=product_id,
            current_price=last_price,
            min_price=min(prices) if prices else None,
            max_price=max(prices) if prices else None,
            avg_price=avg_decimal(prices),
            price_change_percent=change_percent(first_price, last_price),
            min_discount_price=min(
                [s.discount_price for s in snapshots if s.discount_price is not None], default=None
            ),
            max_discount_percent=max(
                [s.discount_percent for s in snapshots if s.discount_percent is not None], default=None
            ),
            discount_days_count=len(
                {
                    s.collected_at.date()
                    for s in snapshots
                    if s.discount_price is not None or s.discount_percent is not None
                }
            ),
            snapshots_count=len(snapshots),
            first_seen_at=product.first_seen_at if product else None,
            last_seen_at=product.last_seen_at if product else None,
        )

    def category_stats(
        self, category_id: int, from_date: date | None = None, to_date: date | None = None
    ) -> CategoryStats:
        snapshots = self.snapshots.list_for_category(category_id, from_date, to_date)
        latest = latest_per_product(snapshots)
        prices = [effective_price(snapshot) for snapshot in latest if effective_price(snapshot) is not None]
        discounted = [s for s in latest if s.discount_price is not None or s.discount_percent is not None]
        top = sorted(
            discounted,
            key=lambda s: s.discount_percent or Decimal("0"),
            reverse=True,
        )[:10]
        price_changes = self.price_changes(from_date, to_date, category_id=category_id)
        return CategoryStats(
            category_id=category_id,
            products_count=len(latest),
            avg_price=avg_decimal(prices),
            avg_discount_percent=avg_decimal(
                [s.discount_percent for s in discounted if s.discount_percent is not None]
            ),
            discounted_products_count=len(discounted),
            available_products_count=len([s for s in latest if s.is_available is True]),
            top_discounted_products=[
                ProductDiscountItem(
                    product_id=s.product_id,
                    name=s.product.name,
                    discount_percent=s.discount_percent,
                    discount_price=s.discount_price,
                    price=s.price,
                )
                for s in top
            ],
            price_increased_products=len([item for item in price_changes if (item.change_percent or 0) > 0]),
            price_decreased_products=len([item for item in price_changes if (item.change_percent or 0) < 0]),
        )

    def price_changes(
        self,
        from_date: date | None = None,
        to_date: date | None = None,
        category_id: int | None = None,
    ) -> list[PriceChangeItem]:
        snapshots = (
            self.snapshots.list_for_category(category_id, from_date, to_date)
            if category_id is not None
            else self.snapshots.list_all(from_date, to_date)
        )
        by_product: dict[int, list[MarketProductSnapshot]] = defaultdict(list)
        for snapshot in snapshots:
            by_product[snapshot.product_id].append(snapshot)
        result = []
        for product_id, items in by_product.items():
            prices = [item.price for item in items if item.price is not None]
            if len(prices) < 2:
                continue
            product = items[-1].product
            result.append(
                PriceChangeItem(
                    product_id=product_id,
                    name=product.name,
                    first_price=prices[0],
                    last_price=prices[-1],
                    change_percent=change_percent(prices[0], prices[-1]),
                )
            )
        return result

    def top_discounts(
        self,
        from_date: date | None = None,
        to_date: date | None = None,
        category_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ProductDiscountItem]:
        return self.discount_page(from_date, to_date, category_id=category_id, limit=limit, offset=offset).items

    def discount_page(
        self,
        from_date: date | None = None,
        to_date: date | None = None,
        category_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ProductDiscountPage:
        snapshots = (
            self.snapshots.list_for_category(category_id, from_date, to_date)
            if category_id is not None
            else self.snapshots.list_all(from_date, to_date)
        )
        latest = latest_per_product(snapshots)
        discounted = [s for s in latest if s.discount_percent is not None]
        sorted_discounts = sorted(discounted, key=lambda s: s.discount_percent or Decimal("0"), reverse=True)
        items = [
            ProductDiscountItem(
                product_id=s.product_id,
                name=s.product.name,
                discount_percent=s.discount_percent,
                discount_price=s.discount_price,
                price=s.price,
            )
            for s in sorted_discounts[offset : offset + limit]
        ]
        return ProductDiscountPage(items=items, total=len(sorted_discounts), limit=limit, offset=offset)


def effective_price(snapshot: MarketProductSnapshot) -> Decimal | None:
    return snapshot.discount_price if snapshot.discount_price is not None else snapshot.price


def avg_decimal(values: list[Decimal]) -> Decimal | None:
    if not values:
        return None
    return (sum(values) / Decimal(len(values))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def change_percent(first: Decimal | None, last: Decimal | None) -> Decimal | None:
    if first is None or last is None or first == 0:
        return None
    return ((last - first) * Decimal("100") / first).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def latest_per_product(snapshots: list[MarketProductSnapshot]) -> list[MarketProductSnapshot]:
    latest: dict[int, MarketProductSnapshot] = {}
    for snapshot in snapshots:
        current = latest.get(snapshot.product_id)
        if current is None or snapshot.collected_at > current.collected_at:
            latest[snapshot.product_id] = snapshot
    return list(latest.values())
