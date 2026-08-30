from __future__ import annotations

import asyncio
import inspect
from enum import StrEnum

from .ports import CloseResource, LifecycleEventSink, WorkerStep


class LifecycleState(StrEnum):
    CREATED = "created"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"


class WorkerShutdownError(RuntimeError):
    """Raised when registered worker resources do not close before the deadline."""


class WorkerLifecycle:
    def __init__(self, shutdown_timeout: float, on_event: LifecycleEventSink | None = None) -> None:
        if shutdown_timeout <= 0:
            raise ValueError("shutdown_timeout must be positive")
        self._shutdown_timeout = shutdown_timeout
        self._on_event = on_event
        self._state = LifecycleState.CREATED
        self._resources: list[tuple[str, CloseResource]] = []
        self._stop_event = asyncio.Event()
        self._stop_reason: str | None = None

    @property
    def state(self) -> LifecycleState:
        return self._state

    @property
    def stop_reason(self) -> str | None:
        return self._stop_reason

    def start(self) -> None:
        if self._state is not LifecycleState.CREATED:
            raise RuntimeError(f"cannot start worker from {self._state.value}")
        self._state = LifecycleState.RUNNING
        self._emit("started")

    def register(self, name: str, close: CloseResource) -> None:
        if self._state in {LifecycleState.STOPPING, LifecycleState.STOPPED}:
            raise RuntimeError("cannot register a resource after shutdown begins")
        self._resources.append((name, close))

    def request_stop(self, reason: str = "requested") -> None:
        self._stop_reason = reason
        self._stop_event.set()

    async def run(self, step: WorkerStep) -> None:
        if self._state is not LifecycleState.RUNNING:
            raise RuntimeError(f"cannot run worker from {self._state.value}")
        while not self._stop_event.is_set():
            result = step()
            if inspect.isawaitable(result):
                await result

    async def shutdown(self, reason: str = "signal") -> None:
        if self._state in {LifecycleState.STOPPING, LifecycleState.STOPPED}:
            return
        self._state = LifecycleState.STOPPING
        self._stop_reason = reason
        self._stop_event.set()
        self._emit(f"stopping:{reason}")
        try:
            await asyncio.wait_for(self._close_resources(), timeout=self._shutdown_timeout)
        except TimeoutError as error:
            self._state = LifecycleState.STOPPED
            self._emit("shutdown-failed")
            raise WorkerShutdownError("shutdown timeout") from error
        self._state = LifecycleState.STOPPED
        self._emit("stopped")

    async def _close_resources(self) -> None:
        for name, close in reversed(self._resources):
            result = close()
            if inspect.isawaitable(result):
                await result
            self._emit(f"closed:{name}")

    def _emit(self, event: str) -> None:
        if self._on_event is not None:
            self._on_event(event)
