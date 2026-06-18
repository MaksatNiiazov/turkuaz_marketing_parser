from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.modules.market_parser.models.entities import MarketProduct, ParserCategory


class ProductRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(
        self,
        source_id: int | None = None,
        category_id: int | None = None,
        name: str | None = None,
        sku: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[MarketProduct]:
        stmt = self._filtered_stmt(source_id=source_id, category_id=category_id, name=name, sku=sku)
        if offset is not None:
            stmt = stmt.offset(offset)
        if limit is not None:
            stmt = stmt.limit(limit)
        result = self.db.execute(stmt)
        return list(result.scalars().all())

    def count(
        self,
        source_id: int | None = None,
        category_id: int | None = None,
        name: str | None = None,
        sku: str | None = None,
    ) -> int:
        stmt = select(func.count(MarketProduct.id))
        if source_id is not None:
            stmt = stmt.where(MarketProduct.source_id == source_id)
        if category_id is not None:
            stmt = stmt.where(MarketProduct.category_id.in_(self._category_scope_ids(category_id)))
        if name:
            stmt = stmt.where(MarketProduct.name.ilike(f"%{name}%"))
        if sku:
            stmt = stmt.where(
                or_(
                    MarketProduct.sku.ilike(f"%{sku}%"),
                    MarketProduct.external_sku.ilike(f"%{sku}%"),
                )
            )
        return int(self.db.execute(stmt).scalar_one())

    def _filtered_stmt(
        self,
        source_id: int | None = None,
        category_id: int | None = None,
        name: str | None = None,
        sku: str | None = None,
    ):
        stmt = (
            select(MarketProduct)
            .options(
                selectinload(MarketProduct.source),
                selectinload(MarketProduct.category).selectinload(ParserCategory.parent),
            )
            .order_by(MarketProduct.name)
        )
        if source_id is not None:
            stmt = stmt.where(MarketProduct.source_id == source_id)
        if category_id is not None:
            stmt = stmt.where(MarketProduct.category_id.in_(self._category_scope_ids(category_id)))
        if name:
            stmt = stmt.where(MarketProduct.name.ilike(f"%{name}%"))
        if sku:
            stmt = stmt.where(
                or_(
                    MarketProduct.sku.ilike(f"%{sku}%"),
                    MarketProduct.external_sku.ilike(f"%{sku}%"),
                )
            )
        return stmt

    def _category_scope_ids(self, category_id: int) -> list[int]:
        child_ids = list(
            self.db.execute(
                select(ParserCategory.id).where(ParserCategory.parent_id == category_id)
            ).scalars().all()
        )
        return [category_id, *child_ids]

    def get(self, product_id: int) -> MarketProduct | None:
        return self.db.get(MarketProduct, product_id)

    def get_by_external_sku(self, source_id: int, external_sku: str) -> MarketProduct | None:
        result = self.db.execute(
            select(MarketProduct).where(
                and_(MarketProduct.source_id == source_id, MarketProduct.external_sku == external_sku)
            )
        )
        return result.scalar_one_or_none()

    def get_by_product_url(self, source_id: int, product_url: str) -> MarketProduct | None:
        result = self.db.execute(
            select(MarketProduct)
            .where(and_(MarketProduct.source_id == source_id, MarketProduct.product_url == product_url))
            .order_by(MarketProduct.id)
            .limit(1)
        )
        return result.scalar_one_or_none()

    def upsert(
        self,
        source_id: int,
        category_id: int | None,
        external_sku: str,
        sku: str | None,
        name: str,
        unit: str | None,
        image_url: str | None,
        product_url: str | None,
        seen_at: datetime,
    ) -> MarketProduct:
        product = self.get_by_external_sku(source_id, external_sku)
        if product is None and product_url:
            product = self.get_by_product_url(source_id, product_url)
            if product is not None:
                product.external_sku = external_sku
        if product is None:
            product = MarketProduct(
                source_id=source_id,
                category_id=category_id,
                external_sku=external_sku,
                sku=sku,
                name=name,
                unit=unit,
                image_url=image_url,
                product_url=product_url,
                first_seen_at=seen_at,
                last_seen_at=seen_at,
            )
            self.db.add(product)
        else:
            product.category_id = category_id
            product.sku = sku or product.sku
            product.name = name
            product.unit = unit
            product.image_url = image_url
            product.product_url = product_url
            product.last_seen_at = seen_at
            product.is_active = True
        self.db.flush()
        return product
