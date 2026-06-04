from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass(slots=True)
class ParserRunControl:
    run_id: int
    stop_event: asyncio.Event = field(default_factory=asyncio.Event)


_controls: dict[int, ParserRunControl] = {}


def register_run_control(run_id: int) -> ParserRunControl:
    control = ParserRunControl(run_id=run_id)
    _controls[run_id] = control
    return control


def unregister_run_control(run_id: int) -> None:
    _controls.pop(run_id, None)


def request_run_stop(run_id: int) -> bool:
    control = _controls.get(run_id)
    if control is None:
        return False
    control.stop_event.set()
    return True
