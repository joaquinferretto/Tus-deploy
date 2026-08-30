"""Tenant-isolated session and checkpoint catalog rows for AI agents."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from enum import StrEnum

from worker.checkpoint import (
    CheckpointRecord,
    CheckpointService,
    CheckpointStatus,
    InMemoryCheckpointStore,
)
from worker.langgraph.registry import RuntimeContext


class SessionStatus(StrEnum):
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class SessionCatalogRow:
    session_id: str
    thread_id: str
    agent: str
    version: int
    status: SessionStatus
    state: Mapping[str, object]
    context: RuntimeContext
    checkpoint_id: str | None = None
    checkpoint_version: int = 0


class InMemorySessionCatalog:
    """Deterministic session catalog with tenant and actor authorization."""

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str], SessionCatalogRow] = {}

    def save(
        self,
        context: RuntimeContext,
        session_id: str,
        agent: str,
        state: Mapping[str, object],
        *,
        status: SessionStatus,
        checkpoint: CheckpointRecord | None = None,
    ) -> SessionCatalogRow:
        _require_context(context)
        _require_text(session_id, "session_id")
        _require_text(agent, "agent")
        key = (context.tenant_id, session_id)
        previous = self._rows.get(key)
        if previous is not None and previous.context.actor_id != context.actor_id:
            raise KeyError(f"Session actor context is not authorized for {session_id!r}")
        row = SessionCatalogRow(
            session_id=session_id,
            thread_id=session_id,
            agent=agent,
            version=previous.version + 1 if previous else 1,
            status=SessionStatus(status),
            state=deepcopy(dict(state)),
            context=context,
            checkpoint_id=checkpoint.checkpoint_id if checkpoint else None,
            checkpoint_version=checkpoint.version if checkpoint else 0,
        )
        self._rows[key] = row
        return _copy_row(row)

    def load(self, context: RuntimeContext, session_id: str) -> SessionCatalogRow:
        _require_context(context)
        try:
            row = self._rows[(context.tenant_id, session_id)]
        except KeyError as error:
            raise KeyError(f"No session for tenant {context.tenant_id!r}") from error
        if row.context.actor_id != context.actor_id:
            raise KeyError(f"Session actor context is not authorized for {session_id!r}")
        return _copy_row(row)


class InMemoryCheckpointCatalog:
    """Catalog facade over the P3.3 versioned checkpoint fake."""

    def __init__(self) -> None:
        self._service = CheckpointService(InMemoryCheckpointStore())

    def save(
        self,
        context: RuntimeContext,
        thread_id: str,
        state: Mapping[str, object],
        *,
        status: SessionStatus,
    ) -> CheckpointRecord:
        checkpoint_status = CheckpointStatus(status.value)
        return self._service.save_checkpoint(context, thread_id, state, status=checkpoint_status)

    def load(self, context: RuntimeContext, thread_id: str) -> CheckpointRecord:
        return self._service.load(context, thread_id)


def _copy_row(row: SessionCatalogRow) -> SessionCatalogRow:
    return SessionCatalogRow(
        session_id=row.session_id,
        thread_id=row.thread_id,
        agent=row.agent,
        version=row.version,
        status=row.status,
        state=deepcopy(dict(row.state)),
        context=row.context,
        checkpoint_id=row.checkpoint_id,
        checkpoint_version=row.checkpoint_version,
    )


def _require_context(context: RuntimeContext) -> None:
    if not isinstance(context, RuntimeContext):
        raise TypeError("Runtime context is required")


def _require_text(value: str, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")


SessionRecord = SessionCatalogRow
SessionCatalog = InMemorySessionCatalog
CheckpointCatalog = InMemoryCheckpointCatalog

__all__ = [
    "CheckpointCatalog",
    "InMemoryCheckpointCatalog",
    "InMemorySessionCatalog",
    "SessionCatalog",
    "SessionCatalogRow",
    "SessionRecord",
    "SessionStatus",
]
