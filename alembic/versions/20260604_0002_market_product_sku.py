"""add short product sku

Revision ID: 20260604_0002
Revises: 20260529_0001
Create Date: 2026-06-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260604_0002"
down_revision: str | None = "20260529_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("market_products", sa.Column("sku", sa.String(length=255), nullable=True))
    op.create_index(
        "ix_market_products_source_short_sku",
        "market_products",
        ["source_id", "sku"],
    )


def downgrade() -> None:
    op.drop_index("ix_market_products_source_short_sku", table_name="market_products")
    op.drop_column("market_products", "sku")
