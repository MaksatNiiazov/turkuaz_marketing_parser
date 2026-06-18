from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class ProductStats(BaseModel):
    product_id: int
    current_price: Decimal | None
    min_price: Decimal | None
    max_price: Decimal | None
    avg_price: Decimal | None
    price_change_percent: Decimal | None
    min_discount_price: Decimal | None
    max_discount_percent: Decimal | None
    discount_days_count: int
    snapshots_count: int
    first_seen_at: datetime | None
    last_seen_at: datetime | None


class ProductDiscountItem(BaseModel):
    product_id: int
    name: str
    discount_percent: Decimal | None
    discount_price: Decimal | None
    price: Decimal | None


class ProductDiscountPage(BaseModel):
    items: list[ProductDiscountItem]
    total: int
    limit: int
    offset: int


class CategoryStats(BaseModel):
    category_id: int
    products_count: int
    avg_price: Decimal | None
    avg_discount_percent: Decimal | None
    discounted_products_count: int
    available_products_count: int
    top_discounted_products: list[ProductDiscountItem]
    price_increased_products: int
    price_decreased_products: int


class PriceChangeItem(BaseModel):
    product_id: int
    name: str
    first_price: Decimal | None
    last_price: Decimal | None
    change_percent: Decimal | None


class ReportPeriod(BaseModel):
    from_date: date | None = None
    to_date: date | None = None
