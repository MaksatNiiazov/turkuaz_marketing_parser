from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.auth import require_permission
from app.db.session import get_db
from app.modules.market_parser.schemas.reports import DataQualityReport, RunComparisonReport
from app.modules.market_parser.services.report_service import ReportService

router = APIRouter()


@router.get("/reports/comparison", response_model=RunComparisonReport)
def comparison_report(
    base_run_id: int,
    compare_run_id: int,
    category_id: int | None = None,
    event_type: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.stats.read")),
):
    try:
        return ReportService(db).compare_runs(
            base_run_id, compare_run_id, category_id, event_type, limit, offset
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/reports/latest-comparison", response_model=RunComparisonReport)
def latest_comparison_report(
    source_id: int,
    category_id: int | None = None,
    event_type: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.stats.read")),
):
    service = ReportService(db)
    try:
        base, current = service.latest_run_pair(source_id)
        return service.compare_runs(base.id, current.id, category_id, event_type, limit, offset)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/reports/quality", response_model=DataQualityReport)
def quality_report(
    source_id: int,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.stats.read")),
):
    return ReportService(db).quality(source_id)
