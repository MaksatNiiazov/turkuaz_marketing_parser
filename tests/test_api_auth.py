import jwt
from fastapi.testclient import TestClient

from app.core.auth import has_permission
from app.core.config import settings
from app.main import app


def make_token(permissions: list[str]) -> str:
    return jwt.encode(
        {"sub": "user-1", "email": "user@example.com", "permissions": permissions},
        settings.identity_secret_key,
        algorithm=settings.identity_algorithm,
    )


def test_market_parser_routes_require_identity_token():
    client = TestClient(app)

    response = client.get("/api/v1/market-parser/sources")

    assert response.status_code == 401


def test_market_parser_routes_require_permission():
    client = TestClient(app)
    token = make_token(["market_parser.products.read"])

    response = client.get(
        "/api/v1/market-parser/sources",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403


def test_permission_accepts_active_branch_scope():
    assert has_permission(
        {
            "active_branch_id": 7,
            "branch_code": "bishkek",
            "branch_permissions_by_id": {"7": ["market_parser.products.read"]},
            "branch_permissions": {"bishkek": ["market_parser.runs.read"]},
            "permissions": [],
        },
        "market_parser.products.read",
    )


def test_global_route_rejects_active_branch_scope():
    client = TestClient(app)
    token = jwt.encode(
        {
            "sub": "branch-user",
            "active_branch_id": 7,
            "branch_permissions_by_id": {"7": ["market_parser.sources.read"]},
            "permissions": [],
        },
        settings.identity_secret_key,
        algorithm=settings.identity_algorithm,
    )

    response = client.get(
        "/api/v1/market-parser/sources",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "Missing permission: market_parser.sources.read"}
    assert has_permission(
        {
            "active_branch_id": 7,
            "branch_code": "bishkek",
            "branch_permissions_by_id": {"7": ["market_parser.products.read"]},
            "branch_permissions": {"bishkek": ["market_parser.runs.read"]},
            "permissions": [],
        },
        "market_parser.runs.read",
    )


def test_permission_rejects_other_branch_scope():
    claims = {
        "active_branch_id": 7,
        "branch_code": "bishkek",
        "branch_permissions_by_id": {"8": ["market_parser.products.read"]},
        "branch_permissions": {"osh": ["market_parser.runs.read"]},
        "permissions": [],
    }

    assert not has_permission(claims, "market_parser.products.read")
    assert not has_permission(claims, "market_parser.runs.read")
