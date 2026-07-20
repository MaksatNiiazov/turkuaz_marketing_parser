from __future__ import annotations

from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

bearer_scheme = HTTPBearer(auto_error=False)


def get_identity_claims(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> dict[str, Any]:
    if not settings.auth_enabled:
        return {"sub": "local-dev", "email": "local-dev", "permissions": ["*"]}

    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        return jwt.decode(
            credentials.credentials,
            settings.identity_secret_key,
            algorithms=[settings.identity_algorithm],
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc


def require_permission(permission: str):
    def dependency(claims: Annotated[dict[str, Any], Depends(get_identity_claims)]) -> dict[str, Any]:
        if has_global_permission(claims, permission):
            return claims

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing permission: {permission}",
        )

    return dependency


def has_global_permission(claims: dict[str, Any], permission: str) -> bool:
    """Check permissions for endpoints whose data is not scoped to an Identity branch."""
    global_permissions = claims.get("permissions")
    return isinstance(global_permissions, list) and (
        "*" in global_permissions or permission in global_permissions
    )


def has_permission(claims: dict[str, Any], permission: str) -> bool:
    """Check global or active-branch permissions for explicitly branch-scoped endpoints."""
    if has_global_permission(claims, permission):
        return True

    branch_id, branch_code = _active_branch_claim(claims)
    branch_permissions_by_id = claims.get("branch_permissions_by_id")
    if isinstance(branch_permissions_by_id, dict) and branch_id is not None:
        values = branch_permissions_by_id.get(str(branch_id))
        if isinstance(values, list) and permission in values:
            return True

    branch_permissions = claims.get("branch_permissions")
    if isinstance(branch_permissions, dict) and branch_code is not None:
        values = branch_permissions.get(branch_code)
        if isinstance(values, list) and permission in values:
            return True
    return False


def _active_branch_claim(claims: dict[str, Any]) -> tuple[int | None, str | None]:
    branch = claims.get("branch")
    branch_id = None
    branch_code = _string_claim(claims.get("branch_code"))
    if isinstance(branch, dict):
        branch_id = _int_claim(branch.get("id"))
        branch_code = _string_claim(branch.get("code")) or branch_code
    branch_id = branch_id or _int_claim(claims.get("active_branch_id")) or _int_claim(
        claims.get("branch_id")
    )
    return branch_id, branch_code


def _int_claim(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _string_claim(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def actor_from_claims(claims: dict[str, Any]) -> str | None:
    value = claims.get("email") or claims.get("sub")
    return str(value) if value else None
