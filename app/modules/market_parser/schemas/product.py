from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ProductRead(BaseModel):
    id: int
    source_id: int
    category_id: int | None
    external_sku: str
    sku: str | None
    name: str
    unit: str | None
    image_url: str | None
    product_url: str | None
    is_active: bool
    first_seen_at: datetime
    last_seen_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProductSummary(BaseModel):
    count: int


class ProductPage(BaseModel):
    items: list[ProductRead]
    total: int
    limit: int
    offset: int


class SnapshotRead(BaseModel):
    id: int
    product_id: int
    source_id: int
    category_id: int | None
    run_id: int | None
    price: Decimal | None
    discount_price: Decimal | None
    discount_percent: Decimal | None
    is_available: bool | None
    raw_data: dict | None
    collected_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
