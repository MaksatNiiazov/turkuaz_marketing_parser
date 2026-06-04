from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.modules.market_parser.models.entities import ParserCategory, ParserRun, ParserSource
from app.modules.market_parser.services.auto_run_scheduler import build_auto_run_decision


def seed_scheduler_source(db_session):
    source = ParserSource(
        name="Globus Online",
        code="globus",
        base_url="https://globus-online.kg/ru-kg",
        is_active=True,
    )
    db_session.add(source)
    db_session.flush()
    category = ParserCategory(
        source_id=source.id,
        external_id="cat1",
        name="Конфеты",
        url="https://globus-online.kg/ru-kg/catalog/grocery/category/cat1",
        is_enabled=True,
    )
    db_session.add(category)
    db_session.commit()
    return source


def test_auto_run_decision_uses_five_day_interval(db_session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "parser_auto_run_source_code", "globus")
    monkeypatch.setattr(settings, "parser_auto_run_interval_days", 5)
    source = seed_scheduler_source(db_session)
    now = datetime(2026, 6, 4, 10, 0, tzinfo=timezone.utc)

    decision = build_auto_run_decision(db_session, now=now)

    assert decision.should_run is True
    assert decision.reason == "due"
    assert decision.payload is not None
    assert decision.payload.parse_all_enabled is True
    assert decision.payload.created_by == "scheduler"

    run = ParserRun(
        source_id=source.id,
        status="success",
        started_at=now - timedelta(days=4, hours=23),
        finished_at=now - timedelta(days=4, hours=22),
        total_categories=1,
        processed_categories=1,
    )
    db_session.add(run)
    db_session.commit()

    decision = build_auto_run_decision(db_session, now=now)

    assert decision.should_run is False
    assert decision.reason == "interval_not_elapsed"

    run.started_at = now - timedelta(days=5, minutes=1)
    run.finished_at = now - timedelta(days=5)
    db_session.commit()

    decision = build_auto_run_decision(db_session, now=now)

    assert decision.should_run is True
    assert decision.reason == "due"


def test_auto_run_decision_skips_when_run_is_active(db_session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "parser_auto_run_source_code", "globus")
    monkeypatch.setattr(settings, "parser_auto_run_interval_days", 5)
    source = seed_scheduler_source(db_session)
    now = datetime(2026, 6, 4, 10, 0, tzinfo=timezone.utc)
    db_session.add(
        ParserRun(
            source_id=source.id,
            status="running",
            started_at=now - timedelta(days=6),
            total_categories=1,
        )
    )
    db_session.commit()

    decision = build_auto_run_decision(db_session, now=now)

    assert decision.should_run is False
    assert decision.reason == "active_run_exists"
