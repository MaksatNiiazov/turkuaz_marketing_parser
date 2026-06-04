from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base


class CreatedUpdatedMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ParserSource(CreatedUpdatedMixin, Base):
    __tablename__ = "parser_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    type: Mapped[str] = mapped_column(String(30), nullable=False, default="html")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    categories: Mapped[list[ParserCategory]] = relationship(back_populates="source")


class ParserCategory(CreatedUpdatedMixin, Base):
    __tablename__ = "parser_categories"
    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_parser_categories_source_external"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("parser_sources.id"), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("parser_categories.id"), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    source: Mapped[ParserSource] = relationship(back_populates="categories")
    parent: Mapped[ParserCategory | None] = relationship(remote_side="ParserCategory.id")


class ParserRun(Base):
    __tablename__ = "parser_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("parser_sources.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_categories: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_categories: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_products: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    saved_products: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    source: Mapped[ParserSource] = relationship()
    categories: Mapped[list[ParserRunCategory]] = relationship(back_populates="run")


class ParserRunCategory(Base):
    __tablename__ = "parser_run_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("parser_runs.id"), nullable=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("parser_categories.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    products_found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    products_saved: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped[ParserRun] = relationship(back_populates="categories")
    category: Mapped[ParserCategory] = relationship()


class MarketProduct(CreatedUpdatedMixin, Base):
    __tablename__ = "market_products"
    __table_args__ = (
        UniqueConstraint("source_id", "external_sku", name="uq_market_products_source_sku"),
        Index("ix_market_products_source_short_sku", "source_id", "sku"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("parser_sources.id"), nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("parser_categories.id"), nullable=True)
    external_sku: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(80), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    product_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    source: Mapped[ParserSource] = relationship()
    category: Mapped[ParserCategory | None] = relationship()
    snapshots: Mapped[list[MarketProductSnapshot]] = relationship(back_populates="product")


class MarketProductSnapshot(Base):
    __tablename__ = "market_product_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("market_products.id"), nullable=False)
    source_id: Mapped[int] = mapped_column(ForeignKey("parser_sources.id"), nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("parser_categories.id"), nullable=True)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("parser_runs.id"), nullable=True)
    price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    discount_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    discount_percent: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)
    is_available: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    raw_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    product: Mapped[MarketProduct] = relationship(back_populates="snapshots")
    category: Mapped[ParserCategory | None] = relationship()


class MarketProductDailyStat(CreatedUpdatedMixin, Base):
    __tablename__ = "market_product_daily_stats"
    __table_args__ = (
        UniqueConstraint("product_id", "date", name="uq_market_product_daily_stats_product_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("market_products.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    min_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    max_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    avg_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    last_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    min_discount_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    max_discount_percent: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)
    was_discounted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    available_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    snapshots_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class MarketCategoryDailyStat(CreatedUpdatedMixin, Base):
    __tablename__ = "market_category_daily_stats"
    __table_args__ = (
        UniqueConstraint("category_id", "date", name="uq_market_category_daily_stats_category_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("parser_categories.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    products_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    avg_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    avg_discount_percent: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)
    discounted_products_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_products_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
