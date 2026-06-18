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

    def category_segments(self, source_id: int | None = None, limit: int = 6) -> dict:
        category_stmt = select(ParserCategory)
        if source_id is not None:
            category_stmt = category_stmt.where(ParserCategory.source_id == source_id)
        categories = list(self.db.execute(category_stmt).scalars().all())
        category_by_id = {category.id: category for category in categories}

        count_stmt = select(MarketProduct.category_id, func.count(MarketProduct.id)).group_by(
            MarketProduct.category_id
        )
        if source_id is not None:
            count_stmt = count_stmt.where(MarketProduct.source_id == source_id)

        counts: dict[tuple[int | None, str], int] = {}
        total = 0
        for category_id, count in self.db.execute(count_stmt).all():
            root = self._root_category(category_id, category_by_id)
            key = (root.id, root.name) if root is not None else (None, "Без категории")
            counts[key] = counts.get(key, 0) + int(count)
            total += int(count)

        rows = [
            {
                "category_id": category_id,
                "label": label,
                "count": count,
                "percent": self._segment_percent(count, total),
            }
            for (category_id, label), count in counts.items()
        ]
        rows.sort(key=lambda item: item["count"], reverse=True)
        top = rows[:limit]
        other_count = sum(item["count"] for item in rows[limit:])
        if other_count:
            top.append(
                {
                    "category_id": None,
                    "label": "Другие разделы",
                    "count": other_count,
                    "percent": self._segment_percent(other_count, total),
                }
            )
        return {"items": top, "total": total}

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

    def _root_category(
        self,
        category_id: int | None,
        category_by_id: dict[int, ParserCategory],
    ) -> ParserCategory | None:
        category = category_by_id.get(category_id) if category_id is not None else None
        if category is None:
            return None
        seen_ids = set()
        while category.parent_id and category.parent_id not in seen_ids:
            seen_ids.add(category.id)
            parent = category_by_id.get(category.parent_id)
            if parent is None:
                break
            category = parent
        return category

    def _segment_percent(self, count: int, total: int) -> int:
        if total <= 0 or count <= 0:
            return 0
        return max(1, round(count * 100 / total))

    def _category_scope_ids(self, category_id: int) -> list[int]:
        scope_ids = [category_id]
        pending_ids = [category_id]
        while pending_ids:
            child_ids = list(
                self.db.execute(
                    select(ParserCategory.id).where(ParserCategory.parent_id.in_(pending_ids))
                ).scalars().all()
            )
            pending_ids = [child_id for child_id in child_ids if child_id not in scope_ids]
            scope_ids.extend(pending_ids)
        return scope_ids

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
