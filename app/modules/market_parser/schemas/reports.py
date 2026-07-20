from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class ReportRun(BaseModel):
    id: int
    status: str
    collected_at: datetime | None


class ComparisonSummary(BaseModel):
    base_products: int = 0
    current_products: int = 0
    comparable_products: int = 0
    new_products: int = 0
    disappeared_products: int = 0
    price_increased: int = 0
    price_decreased: int = 0
    price_unchanged: int = 0
    promotions_started: int = 0
    promotions_ended: int = 0
    available_products: int = 0
    unavailable_products: int = 0
    unknown_availability: int = 0
    became_available: int = 0
    became_unavailable: int = 0
    average_price_change_percent: Decimal | None = None


class ComparisonItem(BaseModel):
    product_id: int
    sku: str | None
    name: str
    category_id: int | None
    category_name: str | None
    product_url: str | None
    event_types: list[str] = Field(default_factory=list)
    old_price: Decimal | None
    new_price: Decimal | None
    old_effective_price: Decimal | None
    new_effective_price: Decimal | None
    price_change_percent: Decimal | None
    old_discount_percent: Decimal | None
    new_discount_percent: Decimal | None
    old_availability: bool | None
    new_availability: bool | None


class RunComparisonReport(BaseModel):
    base_run: ReportRun
    compare_run: ReportRun
    summary: ComparisonSummary
    items: list[ComparisonItem]
    total: int
    limit: int
    offset: int


class QualityIssue(BaseModel):
    code: str
    severity: str
    label: str
    count: int


class DataQualityReport(BaseModel):
    latest_run: ReportRun | None
    failed_categories: int
    stale_categories: int
    missing_price: int
    missing_sku: int
    missing_image: int
    missing_product_url: int
    issues: list[QualityIssue]
