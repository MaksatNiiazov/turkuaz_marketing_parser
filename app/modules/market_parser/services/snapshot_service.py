from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.market_parser.models.entities import MarketProductSnapshot
from app.modules.market_parser.repositories.product_repo import ProductRepository
from app.modules.market_parser.repositories.snapshot_repo import SnapshotRepository
from app.modules.market_parser.services.globus_parser import ParsedProduct, stable_product_hash


class SnapshotService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.products = ProductRepository(db)
        self.snapshots = SnapshotRepository(db)

    def save_product_snapshot(
        self,
        *,
        source_id: int,
        category_id: int | None,
        run_id: int | None,
        parsed: ParsedProduct,
        collected_at: datetime | None = None,
    ) -> MarketProductSnapshot:
        seen_at = collected_at or datetime.now(timezone.utc)
        external_sku = parsed.external_sku or stable_product_hash(
            parsed.product_url, parsed.name, parsed.category_name
        )
        product = self.products.upsert(
            source_id=source_id,
            category_id=category_id,
            external_sku=external_sku,
            sku=parsed.sku,
            name=parsed.name,
            unit=parsed.unit,
            image_url=parsed.image_url,
            product_url=parsed.product_url,
            seen_at=seen_at,
        )
        return self.snapshots.create(
            product_id=product.id,
            source_id=source_id,
            category_id=category_id,
            run_id=run_id,
            price=parsed.price,
            discount_price=parsed.discount_price,
            discount_percent=parsed.discount_percent,
            is_available=parsed.is_available,
            raw_data=parsed.raw_data,
            collected_at=seen_at,
        )
