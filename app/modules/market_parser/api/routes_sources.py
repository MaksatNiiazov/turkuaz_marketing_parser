from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import require_permission
from app.db.session import get_db
from app.modules.market_parser.repositories.source_repo import SourceRepository
from app.modules.market_parser.schemas.source import SourceCreate, SourceRead, SourceUpdate

router = APIRouter()


@router.get("/sources", response_model=list[SourceRead])
def list_sources(
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.sources.read")),
):
    return SourceRepository(db).list()


@router.post("/sources", response_model=SourceRead)
def create_source(
    payload: SourceCreate,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.sources.manage")),
):
    repo = SourceRepository(db)
    if repo.get_by_code(payload.code) is not None:
        raise HTTPException(status_code=409, detail="Source code already exists")
    source = repo.create(payload)
    db.commit()
    db.refresh(source)
    return source


@router.patch("/sources/{source_id}", response_model=SourceRead)
def patch_source(
    source_id: int,
    payload: SourceUpdate,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.sources.manage")),
):
    repo = SourceRepository(db)
    source = repo.get(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    source = repo.patch(source, payload)
    db.commit()
    db.refresh(source)
    return source
