from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import require_permission
from app.db.session import get_db
from app.modules.market_parser.repositories.category_repo import CategoryRepository
from app.modules.market_parser.schemas.category import CategoryRead, CategorySyncRequest
from app.modules.market_parser.services.parser_service import ParserService

router = APIRouter()


@router.get("/categories", response_model=list[CategoryRead])
def list_categories(
    source_id: int | None = None,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.categories.read")),
):
    return CategoryRepository(db).list(source_id=source_id)


@router.post("/categories/sync", response_model=list[CategoryRead])
async def sync_categories(
    payload: CategorySyncRequest,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.categories.manage")),
):
    try:
        return await ParserService(db).sync_categories(payload.source_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/categories/{category_id}/enable", response_model=CategoryRead)
def enable_category(
    category_id: int,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.categories.manage")),
):
    return set_category_enabled(category_id, True, db)


@router.patch("/categories/{category_id}/disable", response_model=CategoryRead)
def disable_category(
    category_id: int,
    db: Session = Depends(get_db),
    _claims: dict = Depends(require_permission("market_parser.categories.manage")),
):
    return set_category_enabled(category_id, False, db)


def set_category_enabled(category_id: int, enabled: bool, db: Session):
    repo = CategoryRepository(db)
    category = repo.get(category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    category = repo.set_enabled(category, enabled)
    db.commit()
    db.refresh(category)
    return category
