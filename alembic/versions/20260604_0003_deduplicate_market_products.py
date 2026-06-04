"""deduplicate products split by short sku

Revision ID: 20260604_0003
Revises: 20260604_0002
Create Date: 2026-06-04
"""

from __future__ import annotations

from collections.abc import Sequence
import re
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "20260604_0003"
down_revision: str | None = "20260604_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PRODUCT_ID_RE = re.compile(r"/good/([^/?#]+)")
SHORT_SKU_RE = re.compile(r"^(?:Ц\d+|\d{5,8})$")


def upgrade() -> None:
    connection = op.get_bind()
    rows = list(
        connection.execute(
            sa.text(
                """
                select id, source_id, category_id, external_sku, sku, product_url,
                       first_seen_at, last_seen_at
                from market_products
                where product_url is not null and product_url != ''
                order by id
                """
            )
        ).mappings()
    )
    grouped: dict[tuple[int, str], list[dict[str, Any]]] = {}
    for row in rows:
        product_id = product_id_from_url(row["product_url"])
        if product_id:
            grouped.setdefault((row["source_id"], product_id), []).append(dict(row))

    for (source_id, product_id), products in grouped.items():
        if not products:
            continue
        keeper = choose_keeper(products, product_id)
        short_sku = choose_short_sku(products, product_id)
        first_seen_at = min_not_none(row["first_seen_at"] for row in products) or keeper["first_seen_at"]
        last_seen_at = max_not_none(row["last_seen_at"] for row in products) or keeper["last_seen_at"]
        category_id = choose_latest_category_id(products) if len(products) > 1 else keeper["category_id"]

        connection.execute(
            sa.text(
                """
                update market_products
                set external_sku = :external_sku,
                    sku = coalesce(:sku, sku),
                    category_id = :category_id,
                    first_seen_at = :first_seen_at,
                    last_seen_at = :last_seen_at
                where id = :id
                """
            ),
            {
                "id": keeper["id"],
                "external_sku": product_id,
                "sku": short_sku,
                "category_id": category_id,
                "first_seen_at": first_seen_at,
                "last_seen_at": last_seen_at,
            },
        )

        duplicate_ids = [row["id"] for row in products if row["id"] != keeper["id"]]
        for duplicate_id in duplicate_ids:
            connection.execute(
                sa.text("update market_product_snapshots set product_id = :keeper_id where product_id = :duplicate_id"),
                {"keeper_id": keeper["id"], "duplicate_id": duplicate_id},
            )
            connection.execute(
                sa.text("delete from market_products where id = :duplicate_id"),
                {"duplicate_id": duplicate_id},
            )


def downgrade() -> None:
    pass


def product_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    match = PRODUCT_ID_RE.search(url)
    return match.group(1) if match else None


def choose_keeper(products: list[dict[str, Any]], product_id: str) -> dict[str, Any]:
    for row in products:
        if row["external_sku"] == product_id:
            return row
    return min(products, key=lambda row: row["id"])


def choose_short_sku(products: list[dict[str, Any]], product_id: str) -> str | None:
    existing_skus = [row["sku"] for row in products if row.get("sku")]
    if existing_skus:
        return existing_skus[0]
    candidates = [
        row["external_sku"]
        for row in products
        if row["external_sku"] != product_id and SHORT_SKU_RE.match(row["external_sku"] or "")
    ]
    return candidates[0] if candidates else None


def choose_latest_category_id(products: list[dict[str, Any]]) -> int | None:
    latest = max(products, key=lambda row: str(row["last_seen_at"] or ""))
    return latest["category_id"]


def min_not_none(values) -> Any:
    filtered = [value for value in values if value is not None]
    return min(filtered) if filtered else None


def max_not_none(values) -> Any:
    filtered = [value for value in values if value is not None]
    return max(filtered) if filtered else None
