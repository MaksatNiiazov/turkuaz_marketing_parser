from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.auth import require_permission
from app.db.session import get_db
from app.modules.market_parser.services.export_service import ExportService

router = APIRouter()


@router.get("/export/products.xlsx")
def export_products(
    source_id: int | None = None,
    category_id: int | None = None,
    name: str | None = None,
    sku: str | None = None,
    has_discount: bool | None = None,
    is_available: bool | None = None,
    run_id: int | None = None,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.export.read")),
):
    output = ExportService(db).products_xlsx(
        source_id=source_id,
        category_id=category_id,
        name=name,
        sku=sku,
        has_discount=has_discount,
        is_available=is_available,
        from_date=from_date,
        to_date=to_date,
        run_id=run_id,
    )
    filename = f"market_run_{run_id}.xlsx" if run_id is not None else "market_products.xlsx"
    return xlsx_response(output, filename)


@router.get("/export/stats.xlsx")
def export_stats(
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.export.read")),
):
    output = ExportService(db).stats_xlsx(from_date, to_date)
    return xlsx_response(output, "market_stats.xlsx")


@router.get("/export/category/{category_id}.xlsx")
def export_category(
    category_id: int,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.export.read")),
):
    output = ExportService(db).stats_xlsx(from_date, to_date, category_id=category_id)
    return xlsx_response(output, f"market_category_{category_id}.xlsx")


def xlsx_response(output, filename: str) -> StreamingResponse:
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
