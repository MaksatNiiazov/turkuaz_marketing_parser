from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.market_parser.repositories.run_repo import RunRepository, append_error_message

logger = logging.getLogger(__name__)


def recover_interrupted_runs(db: Session | None = None) -> int:
    if db is not None:
        return recover_interrupted_runs_in_session(db)

    with SessionLocal() as session:
        recovered = recover_interrupted_runs_in_session(session)
        if recovered:
            session.commit()
    return recovered


def recover_interrupted_runs_in_session(db: Session) -> int:
    message = "Остановлено после перезапуска сервера"
    recovered = 0
    runs = RunRepository(db)
    for run in runs.list_active():
        runs.finish_unfinished_categories(run.id, status="stopped", error_message=message)
        runs.finish_run(
            run,
            status="stopped",
            processed_categories=run.processed_categories,
            total_products=run.total_products,
            saved_products=run.saved_products,
            error_message=append_error_message(run.error_message, message),
        )
        recovered += 1
    if recovered:
        logger.warning("recovered interrupted parser runs", extra={"count": recovered})
    return recovered
