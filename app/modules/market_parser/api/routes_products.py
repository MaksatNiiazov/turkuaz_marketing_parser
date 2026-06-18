from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.auth import require_permission
from app.db.session import get_db
from app.modules.market_parser.repositories.product_repo import ProductRepository
from app.modules.market_parser.repositories.snapshot_repo import SnapshotRepository
from app.modules.market_parser.schemas.product import ProductPage, ProductRead, ProductSummary, SnapshotRead

router = APIRouter()


@router.get("/products", response_model=list[ProductRead])
def list_products(
    source_id: int | None = None,
    category_id: int | None = None,
    name: str | None = None,
    sku: str | None = None,
    has_discount: bool | None = None,
    is_available: bool | None = None,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.products.read")),
):
    products = ProductRepository(db).list(source_id=source_id, category_id=category_id, name=name, sku=sku)
    if has_discount is None and is_available is None and from_date is None and to_date is None:
        return products
    snapshots = SnapshotRepository(db).latest_by_product_ids(
        [product.id for product in products],
        from_date,
        to_date,
    )
    latest = {snapshot.product_id: snapshot for snapshot in snapshots}
    filtered = []
    for product in products:
        snapshot = latest.get(product.id)
        if (from_date is not None or to_date is not None) and snapshot is None:
            continue
        if has_discount is not None:
            discounted = bool(snapshot and (snapshot.discount_price is not None or snapshot.discount_percent is not None))
            if discounted != has_discount:
                continue
        if is_available is not None and (snapshot is None or snapshot.is_available != is_available):
            continue
        filtered.append(product)
    return filtered


@router.get("/products/summary", response_model=ProductSummary)
def products_summary(
    source_id: int | None = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.products.read")),
):
    return ProductSummary(count=ProductRepository(db).count(source_id=source_id))


@router.get("/products/page", response_model=ProductPage)
def products_page(
    source_id: int | None = None,
    category_id: int | None = None,
    name: str | None = None,
    sku: str | None = None,
    has_discount: bool | None = None,
    is_available: bool | None = None,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=250)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.products.read")),
):
    repo = ProductRepository(db)
    if has_discount is None and is_available is None and from_date is None and to_date is None:
        total = repo.count(source_id=source_id, category_id=category_id, name=name, sku=sku)
        items = repo.list(
            source_id=source_id,
            category_id=category_id,
            name=name,
            sku=sku,
            limit=limit,
            offset=offset,
        )
        return ProductPage(items=items, total=total, limit=limit, offset=offset)

    products = repo.list(source_id=source_id, category_id=category_id, name=name, sku=sku)
    filtered = filter_products_by_snapshot(products, has_discount, is_available, from_date, to_date, db)
    return ProductPage(items=filtered[offset : offset + limit], total=len(filtered), limit=limit, offset=offset)


@router.get("/products/{product_id}", response_model=ProductRead)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.products.read")),
):
    product = ProductRepository(db).get(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("/products/{product_id}/snapshots", response_model=list[SnapshotRead])
def product_snapshots(
    product_id: int,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.products.read")),
):
    return SnapshotRepository(db).list_for_product(product_id, from_date, to_date)


def filter_products_by_snapshot(
    products: list,
    has_discount: bool | None,
    is_available: bool | None,
    from_date: date | None,
    to_date: date | None,
    db: Session,
) -> list:
    snapshots = SnapshotRepository(db).latest_by_product_ids(
        [product.id for product in products],
        from_date,
        to_date,
    )
    latest = {snapshot.product_id: snapshot for snapshot in snapshots}
    filtered = []
    for product in products:
        snapshot = latest.get(product.id)
        if (from_date is not None or to_date is not None) and snapshot is None:
            continue
        if has_discount is not None:
            discounted = bool(snapshot and (snapshot.discount_price is not None or snapshot.discount_percent is not None))
            if discounted != has_discount:
                continue
        if is_available is not None and (snapshot is None or snapshot.is_available != is_available):
            continue
        filtered.append(product)
    return filtered
