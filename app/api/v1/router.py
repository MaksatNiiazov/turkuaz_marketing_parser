from fastapi import APIRouter

from app.api.v1 import auth, health
from app.modules.market_parser.api import (
    routes_categories,
    routes_export,
    routes_products,
    routes_reports,
    routes_runs,
    routes_sources,
    routes_stats,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["system"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(routes_sources.router, prefix="/market-parser", tags=["market-parser"])
api_router.include_router(routes_categories.router, prefix="/market-parser", tags=["market-parser"])
api_router.include_router(routes_runs.router, prefix="/market-parser", tags=["market-parser"])
api_router.include_router(routes_products.router, prefix="/market-parser", tags=["market-parser"])
api_router.include_router(routes_stats.router, prefix="/market-parser", tags=["market-parser"])
api_router.include_router(routes_reports.router, prefix="/market-parser", tags=["market-parser-reports"])
api_router.include_router(routes_export.router, prefix="/market-parser", tags=["market-parser"])
