from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import require_permission
from app.db.session import get_db
from app.modules.market_parser.schemas.stats import (
    CategoryStats,
    PriceChangeItem,
    ProductDiscountItem,
    ProductDiscountPage,
    ProductStats,
)
from app.modules.market_parser.services.stats_service import StatsService

router = APIRouter()


@router.get("/products/{product_id}/stats", response_model=ProductStats)
def product_stats(
    product_id: int,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.stats.read")),
):
    return StatsService(db).product_stats(product_id, from_date, to_date)


@router.get("/categories/{category_id}/stats", response_model=CategoryStats)
def category_stats(
    category_id: int,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.stats.read")),
):
    return StatsService(db).category_stats(category_id, from_date, to_date)


@router.get("/reports/price-changes", response_model=list[PriceChangeItem])
def price_changes(
    category_id: int | None = None,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.stats.read")),
):
    return StatsService(db).price_changes(from_date, to_date, category_id=category_id)


@router.get("/reports/discounts", response_model=list[ProductDiscountItem])
def discounts(
    category_id: int | None = None,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.stats.read")),
):
    return StatsService(db).top_discounts(from_date, to_date, category_id=category_id)


@router.get("/reports/top-discounts", response_model=ProductDiscountPage)
def top_discounts(
    category_id: int | None = None,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=250)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.stats.read")),
):
    return StatsService(db).discount_page(from_date, to_date, category_id=category_id, limit=limit, offset=offset)
