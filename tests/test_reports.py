from datetime import datetime, timezone
from decimal import Decimal

from app.modules.market_parser.models.entities import (
    ParserCategory,
    ParserRun,
    ParserRunCategory,
    ParserSource,
)
from app.modules.market_parser.services.globus_parser import ParsedProduct
from app.modules.market_parser.services.report_service import ReportService
from app.modules.market_parser.services.snapshot_service import SnapshotService


def test_run_comparison_reports_business_events(db_session) -> None:
    source, category, base_run, compare_run = seed_comparison(db_session)
    snapshots = SnapshotService(db_session)
    snapshots.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=base_run.id,
        parsed=product("same", "100", available=True),
        collected_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
    )
    snapshots.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=compare_run.id,
        parsed=product("same", "120", discount_price="90", available=False),
        collected_at=datetime(2026, 7, 20, tzinfo=timezone.utc),
    )
    snapshots.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=compare_run.id,
        parsed=product("new", "80", available=True),
        collected_at=datetime(2026, 7, 20, tzinfo=timezone.utc),
    )
    db_session.commit()

    report = ReportService(db_session).compare_runs(base_run.id, compare_run.id)

    assert report.summary.new_products == 1
    assert report.summary.price_increased == 1
    assert report.summary.promotions_started == 1
    assert report.summary.became_unavailable == 1
    changed = next(item for item in report.items if item.name == "Товар same")
    assert set(changed.event_types) == {"price_increased", "promotion_started", "became_unavailable"}
    assert changed.price_change_percent == Decimal("20.00")


def test_disappeared_product_requires_successful_category(db_session) -> None:
    source, category, base_run, compare_run = seed_comparison(db_session, compare_category_status="failed")
    SnapshotService(db_session).save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=base_run.id,
        parsed=product("missing", "100"),
        collected_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
    )
    db_session.commit()

    report = ReportService(db_session).compare_runs(base_run.id, compare_run.id)

    assert report.summary.disappeared_products == 0
    assert report.items == []


def test_quality_distinguishes_unknown_availability(db_session) -> None:
    source, category, _, compare_run = seed_comparison(db_session)
    SnapshotService(db_session).save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=compare_run.id,
        parsed=product("unknown", "100", available=None),
        collected_at=datetime(2026, 7, 20, tzinfo=timezone.utc),
    )
    db_session.commit()

    report = ReportService(db_session).quality(source.id)

    assert report.failed_categories == 0
    assert report.missing_price == 0
    assert report.missing_image == 1


def seed_comparison(db_session, compare_category_status: str = "success"):
    source = ParserSource(name="Globus", code="globus", base_url="https://example.test")
    db_session.add(source)
    db_session.flush()
    category = ParserCategory(
        source_id=source.id,
        external_id="drinks",
        name="Напитки",
        url="https://example.test/drinks",
    )
    db_session.add(category)
    db_session.flush()
    base_run = ParserRun(
        source_id=source.id,
        status="success",
        started_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
        finished_at=datetime(2026, 7, 15, 1, tzinfo=timezone.utc),
        total_categories=1,
        processed_categories=1,
    )
    compare_run = ParserRun(
        source_id=source.id,
        status="success" if compare_category_status == "success" else "partial",
        started_at=datetime(2026, 7, 20, tzinfo=timezone.utc),
        finished_at=datetime(2026, 7, 20, 1, tzinfo=timezone.utc),
        total_categories=1,
        processed_categories=1,
    )
    db_session.add_all([base_run, compare_run])
    db_session.flush()
    db_session.add_all([
        ParserRunCategory(run_id=base_run.id, category_id=category.id, status="success"),
        ParserRunCategory(run_id=compare_run.id, category_id=category.id, status=compare_category_status),
    ])
    db_session.flush()
    return source, category, base_run, compare_run


def product(external_sku: str, price: str, discount_price: str | None = None, available: bool | None = True):
    discount = Decimal("25.00") if discount_price else None
    return ParsedProduct(
        source_code="globus",
        external_sku=external_sku,
        sku=external_sku,
        name=f"Товар {external_sku}",
        unit="шт.",
        category_name="Напитки",
        category_url=None,
        price=Decimal(price),
        discount_price=Decimal(discount_price) if discount_price else None,
        discount_percent=discount,
        image_url=None,
        product_url=f"https://example.test/{external_sku}",
        is_available=available,
        raw_data={},
    )
