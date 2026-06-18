from datetime import datetime, timezone
from decimal import Decimal

from app.modules.market_parser.models.entities import ParserCategory, ParserSource
from app.modules.market_parser.repositories.product_repo import ProductRepository
from app.modules.market_parser.services.globus_parser import ParsedProduct
from app.modules.market_parser.services.snapshot_service import SnapshotService
from app.modules.market_parser.services.stats_service import StatsService


def seed_source_category(db_session):
    source = ParserSource(name="Globus Online", code="globus", base_url="https://globus-online.kg/ru-kg")
    db_session.add(source)
    db_session.flush()
    category = ParserCategory(
        source_id=source.id,
        external_id="cat1",
        name="Конфеты",
        url="https://globus-online.kg/ru-kg/catalog/grocery/category/cat1",
    )
    db_session.add(category)
    db_session.flush()
    return source, category


def parsed_product(
    price="100.00",
    discount_price=None,
    external_sku="external-1",
    sku="sku-1",
    product_url="https://globus-online.kg/ru-kg/good/external-1",
):
    return ParsedProduct(
        source_code="globus",
        external_sku=external_sku,
        sku=sku,
        name="Шоколад тестовый",
        unit="шт.",
        category_name="Конфеты",
        category_url=None,
        price=Decimal(price),
        discount_price=Decimal(discount_price) if discount_price else None,
        discount_percent=Decimal("20.00") if discount_price else None,
        image_url="https://img",
        product_url=product_url,
        is_available=True,
        raw_data={"id": external_sku, "pigeonId": sku},
    )


def test_create_update_product_and_snapshot(db_session) -> None:
    source, category = seed_source_category(db_session)
    service = SnapshotService(db_session)

    service.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=None,
        parsed=parsed_product(price="100.00"),
        collected_at=datetime(2026, 5, 28, tzinfo=timezone.utc),
    )
    service.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=None,
        parsed=parsed_product(price="120.00", discount_price="90.00"),
        collected_at=datetime(2026, 5, 29, tzinfo=timezone.utc),
    )
    db_session.commit()

    products = ProductRepository(db_session).list()
    assert len(products) == 1
    assert products[0].external_sku == "external-1"
    assert products[0].sku == "sku-1"
    assert products[0].last_seen_at.date().isoformat() == "2026-05-29"
    assert len(products[0].snapshots) == 2
    assert ProductRepository(db_session).list(sku="sku-1")[0].id == products[0].id
    assert ProductRepository(db_session).list(sku="external-1")[0].id == products[0].id


def test_upsert_reuses_short_sku_product_by_url(db_session) -> None:
    source, category = seed_source_category(db_session)
    service = SnapshotService(db_session)
    service.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=None,
        parsed=parsed_product(external_sku="sku-1", sku="sku-1"),
        collected_at=datetime(2026, 5, 28, tzinfo=timezone.utc),
    )
    service.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=None,
        parsed=parsed_product(external_sku="external-1", sku=None),
        collected_at=datetime(2026, 5, 29, tzinfo=timezone.utc),
    )
    db_session.commit()

    products = ProductRepository(db_session).list()
    assert len(products) == 1
    assert products[0].external_sku == "external-1"
    assert products[0].sku == "sku-1"
    assert len(products[0].snapshots) == 2


def test_product_and_category_stats(db_session) -> None:
    source, category = seed_source_category(db_session)
    service = SnapshotService(db_session)
    service.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=None,
        parsed=parsed_product(price="100.00"),
        collected_at=datetime(2026, 5, 28, tzinfo=timezone.utc),
    )
    service.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=None,
        parsed=parsed_product(price="120.00", discount_price="90.00"),
        collected_at=datetime(2026, 5, 29, tzinfo=timezone.utc),
    )
    db_session.commit()
    product = ProductRepository(db_session).list()[0]

    product_stats = StatsService(db_session).product_stats(product.id)
    category_stats = StatsService(db_session).category_stats(category.id)

    assert product_stats.min_price == Decimal("90.00")
    assert product_stats.max_price == Decimal("100.00")
    assert product_stats.price_change_percent == Decimal("-10.00")
    assert product_stats.discount_days_count == 1
    assert category_stats.products_count == 1
    assert category_stats.discounted_products_count == 1
    assert category_stats.top_discounted_products[0].product_id == product.id


def test_price_changes_use_base_price_only(db_session) -> None:
    source, category = seed_source_category(db_session)
    service = SnapshotService(db_session)
    service.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=None,
        parsed=parsed_product(price="100.00"),
        collected_at=datetime(2026, 5, 28, tzinfo=timezone.utc),
    )
    service.save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=None,
        parsed=parsed_product(price="100.00", discount_price="80.00"),
        collected_at=datetime(2026, 5, 29, tzinfo=timezone.utc),
    )
    db_session.commit()

    changes = StatsService(db_session).price_changes(category_id=category.id)

    assert changes[0].first_price == Decimal("100.00")
    assert changes[0].last_price == Decimal("100.00")
    assert changes[0].change_percent == Decimal("0.00")


def test_discount_page_returns_total_and_slice(db_session) -> None:
    source, category = seed_source_category(db_session)
    service = SnapshotService(db_session)
    for index in range(5):
        service.save_product_snapshot(
            source_id=source.id,
            category_id=category.id,
            run_id=None,
            parsed=parsed_product(
                price="100.00",
                discount_price=str(90 - index),
                external_sku=f"external-{index}",
                sku=f"sku-{index}",
                product_url=f"https://globus-online.kg/ru-kg/good/external-{index}",
            ),
            collected_at=datetime(2026, 5, 28, tzinfo=timezone.utc),
        )
    db_session.commit()

    page = StatsService(db_session).discount_page(category_id=category.id, limit=2, offset=2)

    assert page.total == 5
    assert page.limit == 2
    assert page.offset == 2
    assert len(page.items) == 2


def test_category_stats_include_nested_categories(db_session) -> None:
    source, parent = seed_source_category(db_session)
    child = ParserCategory(
        source_id=source.id,
        external_id="child-cat",
        name="Мясная лавка",
        url="https://globus-online.kg/ru-kg/catalog/meat",
        parent_id=parent.id,
    )
    db_session.add(child)
    db_session.flush()

    SnapshotService(db_session).save_product_snapshot(
        source_id=source.id,
        category_id=child.id,
        run_id=None,
        parsed=parsed_product(price="499.00"),
        collected_at=datetime(2026, 5, 28, tzinfo=timezone.utc),
    )
    db_session.commit()

    stats = StatsService(db_session).category_stats(parent.id)

    assert stats.products_count == 1
    assert stats.avg_price == Decimal("499.00")


def test_category_segments_count_all_products_by_root_category(db_session) -> None:
    source, parent = seed_source_category(db_session)
    child = ParserCategory(
        source_id=source.id,
        external_id="child-cat",
        name="Вино",
        url="https://globus-online.kg/ru-kg/catalog/wine",
        parent_id=parent.id,
    )
    db_session.add(child)
    db_session.flush()
    service = SnapshotService(db_session)
    for index in range(3):
        service.save_product_snapshot(
            source_id=source.id,
            category_id=child.id,
            run_id=None,
            parsed=parsed_product(
                price="100.00",
                external_sku=f"segment-{index}",
                sku=f"segment-{index}",
                product_url=f"https://globus-online.kg/ru-kg/good/segment-{index}",
            ),
            collected_at=datetime(2026, 5, 28, tzinfo=timezone.utc),
        )
    db_session.commit()

    segments = ProductRepository(db_session).category_segments(source_id=source.id)

    assert segments["total"] == 3
    assert segments["items"][0]["category_id"] == parent.id
    assert segments["items"][0]["label"] == parent.name
    assert segments["items"][0]["count"] == 3
