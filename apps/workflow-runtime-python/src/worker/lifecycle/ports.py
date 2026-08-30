from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol

CloseResource = Callable[[], None | Awaitable[None]]
WorkerStep = Callable[[], None | Awaitable[None]]


class LifecycleEventSink(Protocol):
    def __call__(self, event: str) -> None: ...
