from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import actor_from_claims, require_permission
from app.db.session import get_db
from app.modules.market_parser.repositories.run_repo import RunRepository
from app.modules.market_parser.schemas.run import RunCreate, RunRead
from app.modules.market_parser.services.parser_service import ParserService
from app.modules.market_parser.tasks.parser_tasks import execute_market_parser_run

router = APIRouter()


@router.post("/runs", response_model=RunRead)
async def create_run(
    payload: RunCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    claims: dict = Depends(require_permission("market_parser.runs.create")),
):
    try:
        if not payload.created_by:
            payload = payload.model_copy(update={"created_by": actor_from_claims(claims)})
        run = ParserService(db).create_parser_run(payload)
        background_tasks.add_task(execute_market_parser_run, payload, run.id)
        return run
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/runs", response_model=list[RunRead])
def list_runs(
    source_id: int | None = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.runs.read")),
):
    return RunRepository(db).list(source_id=source_id)


@router.get("/runs/{run_id}", response_model=RunRead)
def get_run(
    run_id: int,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.runs.read")),
):
    run = RunRepository(db).get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run
