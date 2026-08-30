"""Tenant and actor scoped memory catalog fakes for AI agent sessions."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import Protocol

from worker.langgraph.registry import RuntimeContext


class MemoryUnavailableError(RuntimeError):
    """Raised when an external memory backend is configured but unavailable."""


@dataclass(frozen=True, slots=True)
class MemoryCatalogRow:
    memory_id: str
    key: str
    value: Mapping[str, object]
    session_id: str | None
    version: int
    tenant_id: str
    actor_id: str
    context: RuntimeContext


class MemoryCatalog(Protocol):
    def save(
        self,
        context: RuntimeContext,
        key: str,
        value: Mapping[str, object],
        *,
        session_id: str | None = None,
    ) -> MemoryCatalogRow: ...

    def load(
        self,
        context: RuntimeContext,
        key: str,
        *,
        session_id: str | None = None,
    ) -> MemoryCatalogRow: ...


class InMemoryMemoryCatalog:
    """Deterministic catalog that never shares memory across tenant/actor scopes."""

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str, str | None, str], MemoryCatalogRow] = {}

    def save(
        self,
        context: RuntimeContext,
        key: str,
        value: Mapping[str, object],
        *,
        session_id: str | None = None,
    ) -> MemoryCatalogRow:
        _require_context(context)
        _require_text(key, "memory key")
        if session_id is not None:
            _require_text(session_id, "session_id")
        lookup = (context.tenant_id, context.actor_id, session_id, key)
        previous = self._rows.get(lookup)
        row = MemoryCatalogRow(
            memory_id=f"{context.tenant_id}:{context.actor_id}:{session_id or 'global'}:{key}",
            key=key,
            value=deepcopy(dict(value)),
            session_id=session_id,
            version=previous.version + 1 if previous else 1,
            tenant_id=context.tenant_id,
            actor_id=context.actor_id,
            context=context,
        )
        self._rows[lookup] = row
        return _copy_row(row)

    def load(
        self,
        context: RuntimeContext,
        key: str,
        *,
        session_id: str | None = None,
    ) -> MemoryCatalogRow:
        _require_context(context)
        _require_text(key, "memory key")
        lookup = (context.tenant_id, context.actor_id, session_id, key)
        row = self._rows.get(lookup)
        if row is not None:
            return _copy_row(row)

        same_tenant = any(
            row.tenant_id == context.tenant_id and row.session_id == session_id and row.key == key
            for row in self._rows.values()
        )
        if same_tenant:
            raise KeyError(f"Memory actor context is not authorized for {key!r}")
        raise KeyError(f"No memory for tenant {context.tenant_id!r} and key {key!r}")

    def list(
        self,
        context: RuntimeContext,
        *,
        session_id: str | None = None,
    ) -> tuple[MemoryCatalogRow, ...]:
        _require_context(context)
        rows = [
            row
            for row in self._rows.values()
            if row.tenant_id == context.tenant_id
            and row.actor_id == context.actor_id
            and row.session_id == session_id
        ]
        return tuple(_copy_row(row) for row in sorted(rows, key=lambda item: item.key))


class UnavailableMemoryCatalog:
    """Explicit adapter for a future database/vector memory backend."""

    def __init__(self, backend: str) -> None:
        self.backend = backend

    def _raise(self) -> None:
        raise MemoryUnavailableError(
            f"memory backend {self.backend!r} is unavailable; use a deterministic fake"
        )

    def save(
        self,
        context: RuntimeContext,
        key: str,
        value: Mapping[str, object],
        *,
        session_id: str | None = None,
    ) -> MemoryCatalogRow:
        self._raise()
        raise AssertionError("unreachable")

    def load(
        self,
        context: RuntimeContext,
        key: str,
        *,
        session_id: str | None = None,
    ) -> MemoryCatalogRow:
        self._raise()
        raise AssertionError("unreachable")


def _copy_row(row: MemoryCatalogRow) -> MemoryCatalogRow:
    return MemoryCatalogRow(
        memory_id=row.memory_id,
        key=row.key,
        value=deepcopy(dict(row.value)),
        session_id=row.session_id,
        version=row.version,
        tenant_id=row.tenant_id,
        actor_id=row.actor_id,
        context=row.context,
    )


def _require_context(context: RuntimeContext) -> None:
    if not isinstance(context, RuntimeContext):
        raise TypeError("Runtime context is required")


def _require_text(value: str, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")


MemoryEntry = MemoryCatalogRow
InMemoryMemoryStore = InMemoryMemoryCatalog

__all__ = [
    "InMemoryMemoryCatalog",
    "InMemoryMemoryStore",
    "MemoryCatalog",
    "MemoryCatalogRow",
    "MemoryEntry",
    "MemoryUnavailableError",
    "UnavailableMemoryCatalog",
]
