from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "marketing-parser"}


@router.get("/ready")
def ready() -> dict[str, str]:
    return {"status": "ready", "service": "marketing-parser"}
