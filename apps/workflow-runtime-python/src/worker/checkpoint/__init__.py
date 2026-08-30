"""Tenant-scoped checkpoint and pause/resume ports for the workflow runtime."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from worker.langgraph.registry import RuntimeContext


class CheckpointStatus(StrEnum):
    PAUSED = "paused"
    RUNNING = "running"
    COMPLETED = "completed"


class CheckpointUnavailableError(RuntimeError):
    """Raised when a configured durable checkpoint backend is not available."""


class _CheckpointActorScopeError(KeyError):
    """Internal authorization signal that must not be treated as missing state."""


@dataclass(frozen=True, slots=True)
class CheckpointRecord:
    thread_id: str
    checkpoint_id: str
    version: int
    status: CheckpointStatus
    state: Mapping[str, object]
    context: RuntimeContext


class CheckpointStore(Protocol):
    def save(self, record: CheckpointRecord) -> CheckpointRecord: ...

    def load(self, context: RuntimeContext, thread_id: str) -> CheckpointRecord: ...


class InMemoryCheckpointStore:
    """Deterministic local substitute for a PostgreSQL/Redis checkpointer."""

    def __init__(self) -> None:
        self._records: dict[tuple[str, str], CheckpointRecord] = {}

    def save(self, record: CheckpointRecord) -> CheckpointRecord:
        key = (record.context.tenant_id, record.thread_id)
        existing = self._records.get(key)
        if existing is not None and existing.context.actor_id != record.context.actor_id:
            raise _CheckpointActorScopeError(
                f"Checkpoint actor context is not authorized for thread {record.thread_id!r}"
            )
        stored = _copy_record(record)
        self._records[key] = stored
        return _copy_record(stored)

    def load(self, context: RuntimeContext, thread_id: str) -> CheckpointRecord:
        _require_context(context)
        try:
            record = self._records[(context.tenant_id, thread_id)]
        except KeyError as error:
            raise KeyError(
                f"No checkpoint for tenant {context.tenant_id!r} and thread {thread_id!r}"
            ) from error
        if record.context.actor_id != context.actor_id:
            raise _CheckpointActorScopeError(
                f"Checkpoint actor context is not authorized for thread {thread_id!r}"
            )
        return _copy_record(record)


class UnavailableCheckpointStore:
    """Explicit adapter used until a configured database/cache is authorized."""

    def __init__(self, backend: str) -> None:
        self.backend = backend

    def _raise(self) -> None:
        raise CheckpointUnavailableError(
            f"checkpoint backend {self.backend!r} is unavailable; use a deterministic fake"
        )

    def save(self, record: CheckpointRecord) -> CheckpointRecord:
        self._raise()
        raise AssertionError("unreachable")

    def load(self, context: RuntimeContext, thread_id: str) -> CheckpointRecord:
        self._raise()
        raise AssertionError("unreachable")


class CheckpointService:
    def __init__(self, store: CheckpointStore) -> None:
        self.store = store

    def save_checkpoint(
        self,
        context: RuntimeContext,
        thread_id: str,
        state: Mapping[str, object],
        *,
        status: CheckpointStatus = CheckpointStatus.PAUSED,
    ) -> CheckpointRecord:
        _require_context(context)
        _require_text(thread_id, "thread_id")
        previous = self._try_load(context, thread_id)
        version = previous.version + 1 if previous else 1
        record = CheckpointRecord(
            thread_id=thread_id,
            checkpoint_id=f"{thread_id}:checkpoint:{version}",
            version=version,
            status=CheckpointStatus(status),
            state=deepcopy(dict(state)),
            context=context,
        )
        return self.store.save(record)

    def load(self, context: RuntimeContext, thread_id: str) -> CheckpointRecord:
        return self.store.load(context, thread_id)

    def resume(self, context: RuntimeContext, thread_id: str) -> CheckpointRecord:
        current = self.load(context, thread_id)
        if current.status is CheckpointStatus.COMPLETED:
            raise ValueError(f"Completed thread {thread_id!r} cannot be resumed")
        return self.save_checkpoint(
            context,
            thread_id,
            current.state,
            status=CheckpointStatus.RUNNING,
        )

    def _try_load(self, context: RuntimeContext, thread_id: str) -> CheckpointRecord | None:
        try:
            return self.store.load(context, thread_id)
        except _CheckpointActorScopeError:
            raise
        except KeyError:
            return None


def _copy_record(record: CheckpointRecord) -> CheckpointRecord:
    return CheckpointRecord(
        thread_id=record.thread_id,
        checkpoint_id=record.checkpoint_id,
        version=record.version,
        status=record.status,
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
    "CheckpointRecord",
    "CheckpointService",
    "CheckpointStatus",
    "CheckpointStore",
    "CheckpointUnavailableError",
    "InMemoryCheckpointStore",
    "UnavailableCheckpointStore",
]
