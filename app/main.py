from pathlib import Path
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.engine import make_url

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.base import Base
from app.db.session import engine
from app.modules.market_parser.services.auto_run_scheduler import AutoRunScheduler
from app.modules.market_parser.services.bootstrap import bootstrap_market_parser


def bootstrap_app() -> None:
    database_url = make_url(settings.database_url)
    if database_url.drivername.startswith("sqlite") and database_url.database not in (None, ":memory:"):
        Path(database_url.database).parent.mkdir(parents=True, exist_ok=True)
    if settings.auto_create_schema:
        Base.metadata.create_all(bind=engine)
        bootstrap_market_parser()


bootstrap_app()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    scheduler = AutoRunScheduler()
    scheduler.start()
    app.state.auto_run_scheduler = scheduler
    try:
        yield
    finally:
        await scheduler.stop()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_origin_regex=settings.backend_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


def run() -> None:
    uvicorn.run("app.main:app", host="0.0.0.0", port=8503, reload=True)


if __name__ == "__main__":
    run()
