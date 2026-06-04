import asyncio
from datetime import datetime, timezone
from decimal import Decimal

import pytest
import httpx
from openpyxl import load_workbook

from app.modules.market_parser.models.entities import ParserCategory, ParserSource
from app.modules.market_parser.repositories.product_repo import ProductRepository
from app.modules.market_parser.schemas.run import RunCreate
from app.modules.market_parser.services.export_service import ExportService
from app.modules.market_parser.services.globus_parser import ParsedProduct
from app.modules.market_parser.services.parser_service import ParserService
from app.modules.market_parser.services.parser_service import summarize_parser_error
from app.modules.market_parser.services.run_control import request_run_stop
from app.modules.market_parser.services.snapshot_service import SnapshotService


class FakeParser:
    async def fetch_categories(self):
        return []

    async def fetch_products_by_category(self, category):
        if category.name == "Bad":
            raise RuntimeError("category failed")
        return [
            ParsedProduct(
                source_code="globus",
                external_sku=f"external-{category.id}",
                sku=f"sku-{category.id}",
                name=f"Product {category.id}",
                unit="шт.",
                category_name=category.name,
                category_url=category.url,
                price=Decimal("100.00"),
                discount_price=None,
                discount_percent=None,
                image_url=None,
                product_url=f"https://globus-online.kg/ru-kg/good/sku-{category.id}",
                is_available=True,
                raw_data={"id": category.id},
            )
        ]


class SlowParser:
    async def fetch_categories(self):
        return []

    async def fetch_products_by_category(self, category):
        await asyncio.sleep(30)
        return []


def seed_source_categories(db_session):
    source = ParserSource(name="Globus Online", code="globus", base_url="https://globus-online.kg/ru-kg")
    db_session.add(source)
    db_session.flush()
    good = ParserCategory(source_id=source.id, external_id="good", name="Good", url="https://example/good")
    bad = ParserCategory(source_id=source.id, external_id="bad", name="Bad", url="https://example/bad")
    db_session.add_all([good, bad])
    db_session.flush()
    db_session.commit()
    return source, good, bad


def test_summarize_globus_http_error() -> None:
    request = httpx.Request("GET", "https://globus-online.kg/ru-kg/catalog/grocery/category/missing")
    response = httpx.Response(404, request=request)
    error = httpx.HTTPStatusError("Client error", request=request, response=response)

    assert summarize_parser_error(error) == "Globus вернул 404: раздел не найден или больше недоступен"


@pytest.mark.asyncio
async def test_run_keeps_going_when_category_fails(db_session, monkeypatch) -> None:
    source, good, bad = seed_source_categories(db_session)
    monkeypatch.setattr(ParserService, "_parser_for_source", lambda self, code, base_url: FakeParser())

    run = await ParserService(db_session).run_parser(
        RunCreate(source_id=source.id, category_ids=[good.id, bad.id])
    )

    assert run.status == "partial"
    assert run.saved_products == 1
    assert "category failed" in (run.error_message or "")
    assert len(ProductRepository(db_session).list()) == 1


@pytest.mark.asyncio
async def test_run_can_be_stopped(db_session, monkeypatch) -> None:
    source, good, _ = seed_source_categories(db_session)
    monkeypatch.setattr(ParserService, "_parser_for_source", lambda self, code, base_url: SlowParser())
    payload = RunCreate(source_id=source.id, category_ids=[good.id])
    service = ParserService(db_session)
    run = service.create_parser_run(payload)

    task = asyncio.create_task(service.execute_parser_run(payload, run.id))
    for _ in range(10):
        if request_run_stop(run.id):
            break
        await asyncio.sleep(0)
    finished = await asyncio.wait_for(task, timeout=3)

    assert finished.status == "stopped"
    assert finished.processed_categories == 0
    assert "Остановлено пользователем" in (finished.error_message or "")


def test_export_xlsx(db_session) -> None:
    source, _, _ = seed_source_categories(db_session)
    parent = ParserCategory(
        source_id=source.id,
        external_id="home",
        name="Дом и Уют",
        url="https://example/home",
        is_enabled=False,
    )
    db_session.add(parent)
    db_session.flush()
    category = ParserCategory(
        source_id=source.id,
        external_id="kitchen",
        name="Для кухни",
        url="https://example/kitchen",
        parent_id=parent.id,
    )
    db_session.add(category)
    db_session.flush()
    SnapshotService(db_session).save_product_snapshot(
        source_id=source.id,
        category_id=category.id,
        run_id=None,
        parsed=ParsedProduct(
            source_code="globus",
            external_sku="external-1",
            sku="Ц0180022",
            name="Шоколад",
            unit="шт.",
            category_name=category.name,
            category_url=category.url,
            price=Decimal("100.00"),
            discount_price=Decimal("80.00"),
            discount_percent=Decimal("20.00"),
            image_url="https://img",
            product_url="https://globus-online.kg/ru-kg/good/external-1",
            is_available=True,
            raw_data={"id": "external-1", "pigeonId": "Ц0180022"},
        ),
        collected_at=datetime(2026, 5, 29, tzinfo=timezone.utc),
    )
    db_session.commit()

    output = ExportService(db_session).stats_xlsx(category_id=category.id)
    workbook = load_workbook(output)

    assert "Дом и Уют" in workbook.sheetnames
    assert workbook["Товары"]["A1"].value == "sku"
    assert workbook["Товары"]["B1"].value == "external_id"
    assert workbook["Товары"]["A2"].value == "Ц0180022"
    assert workbook["Товары"]["B2"].value == "external-1"
    assert workbook["Товары"]["E2"].value == "Дом и Уют"
    assert workbook["Товары"]["F2"].value == "Для кухни"
    assert workbook["Товары"]["J2"].value == "доступно"
    assert workbook["Скидки"]["D2"].value == "Шоколад"
    assert workbook["Скидки"]["H2"].value == "доступно"
