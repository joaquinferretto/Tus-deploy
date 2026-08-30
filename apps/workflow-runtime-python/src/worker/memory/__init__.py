"""Durable thread-state ports with deterministic local behavior."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import Protocol

from worker.langgraph.registry import RuntimeContext


class ThreadStateUnavailableError(RuntimeError):
    """Raised when a configured durable thread-state adapter is unavailable."""


@dataclass(frozen=True, slots=True)
class ThreadStateRecord:
    thread_id: str
    version: int
    state: Mapping[str, object]
    context: RuntimeContext


class ThreadStateStore(Protocol):
    def save(
        self, context: RuntimeContext, thread_id: str, state: Mapping[str, object]
    ) -> ThreadStateRecord: ...

    def load(self, context: RuntimeContext, thread_id: str) -> dict[str, object]: ...


class InMemoryThreadStateStore:
    """Tenant and actor scoped thread state used by deterministic local tests."""

    def __init__(self) -> None:
        self._records: dict[tuple[str, str], ThreadStateRecord] = {}

    def save(
        self, context: RuntimeContext, thread_id: str, state: Mapping[str, object]
    ) -> ThreadStateRecord:
        _require_context(context)
        _require_text(thread_id, "thread_id")
        key = (context.tenant_id, thread_id)
        previous = self._records.get(key)
        if previous is not None and previous.context.actor_id != context.actor_id:
            raise KeyError(f"Thread state actor context is not authorized for {thread_id!r}")
        record = ThreadStateRecord(
            thread_id=thread_id,
            version=previous.version + 1 if previous else 1,
            state=deepcopy(dict(state)),
            context=context,
        )
        self._records[key] = record
        return _copy_record(record)

    def load(self, context: RuntimeContext, thread_id: str) -> dict[str, object]:
        record = self.record(context, thread_id)
        return deepcopy(dict(record.state))

    def record(self, context: RuntimeContext, thread_id: str) -> ThreadStateRecord:
        _require_context(context)
        try:
            record = self._records[(context.tenant_id, thread_id)]
        except KeyError as error:
            raise KeyError(f"No thread state for tenant {context.tenant_id!r}") from error
        if record.context.actor_id != context.actor_id:
            raise KeyError(f"Thread state actor context is not authorized for {thread_id!r}")
        return _copy_record(record)


class UnavailableThreadStateStore:
    """Explicit no-live-claims adapter for PostgreSQL/Redis thread persistence."""

    def __init__(self, backend: str) -> None:
        self.backend = backend

    def _raise(self) -> None:
        raise ThreadStateUnavailableError(
            f"thread state backend {self.backend!r} is unavailable; use a deterministic fake"
        )

    def save(
        self, context: RuntimeContext, thread_id: str, state: Mapping[str, object]
    ) -> ThreadStateRecord:
        self._raise()
        raise AssertionError("unreachable")

    def load(self, context: RuntimeContext, thread_id: str) -> dict[str, object]:
        self._raise()
        raise AssertionError("unreachable")

    def record(self, context: RuntimeContext, thread_id: str) -> ThreadStateRecord:
        self._raise()
        raise AssertionError("unreachable")


def _copy_record(record: ThreadStateRecord) -> ThreadStateRecord:
    return ThreadStateRecord(
        thread_id=record.thread_id,
        version=record.version,
        state=deepcopy(dict(record.state)),
        context=record.context,
    )


def _require_context(context: RuntimeContext) -> None:
    if not isinstance(context, RuntimeContext):
        raise TypeError("Runtime context is required")


def _require_text(value: str, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")


__all__ = [
    "InMemoryThreadStateStore",
    "ThreadStateRecord",
    "ThreadStateStore",
    "ThreadStateUnavailableError",
    "UnavailableThreadStateStore",
]
