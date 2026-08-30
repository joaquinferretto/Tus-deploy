"""Tenant-scoped durable run ledger and idempotent replay fake."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Protocol

from worker.langgraph.registry import RuntimeContext


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


class IdempotencyConflictError(ValueError):
    """Raised when a tenant reuses an idempotency key with a different request."""


class RunLedgerUnavailableError(RuntimeError):
    """Raised when the configured durable run-ledger adapter is unavailable."""


@dataclass(frozen=True, slots=True)
class RunRecord:
    run_id: str
    tenant_id: str
    actor_id: str
    idempotency_key: str
    request_hash: str
    input_payload: Mapping[str, object]
    status: RunStatus = RunStatus.QUEUED
    result: Mapping[str, object] | None = None
    error: str | None = None
    attempt: int = 0
    replay_count: int = 0
    claim_id: str | None = None
    run_type: str = "workflow"


@dataclass(frozen=True, slots=True)
class Submission:
    record: RunRecord
    created: bool


@dataclass(frozen=True, slots=True)
class RunClaim:
    run_id: str
    claim_id: str
    attempt: int


@dataclass(frozen=True, slots=True)
class TusCommitmentHandoff:
    """Outbox handoff metadata owned by the TUS commitment context."""

    tenant_id: str
    actor_id: str
    correlation_id: str
    commitment_id: str
    context: str
    idempotency_key: str
    request_hash: str
    payload: Mapping[str, object]

    def __post_init__(self) -> None:
        for field_name in (
            "tenant_id",
            "actor_id",
            "correlation_id",
            "commitment_id",
            "context",
            "idempotency_key",
            "request_hash",
        ):
            _require_text(getattr(self, field_name), field_name)
        if self.context not in {"product", "service"}:
            raise ValueError("commitment context is unsupported")


class RunLedger(Protocol):
    def submit(
        self,
        context: RuntimeContext,
        run_id: str,
        request_hash: str,
        input_payload: Mapping[str, object],
        *,
        run_type: str = "workflow",
    ) -> Submission: ...


class InMemoryRunLedger:
    def __init__(self) -> None:
        self._records_by_id: dict[tuple[str, str], RunRecord] = {}
        self._records_by_idempotency: dict[tuple[str, str], str] = {}

    def submit(
        self,
        context: RuntimeContext,
        run_id: str,
        request_hash: str,
        input_payload: Mapping[str, object],
        *,
        run_type: str = "workflow",
    ) -> Submission:
        _require_context(context)
        _require_text(run_id, "run_id")
        _require_text(request_hash, "request_hash")
        key = (context.tenant_id, context.idempotency_key)
        existing_id = self._records_by_idempotency.get(key)
        if existing_id is not None:
            existing = self._records_by_id[(context.tenant_id, existing_id)]
            if existing.actor_id != context.actor_id:
                raise KeyError(
                    f"Run actor context is not authorized for idempotency key {context.idempotency_key!r}"
                )
            if existing.request_hash != request_hash:
                raise IdempotencyConflictError(
                    f"idempotency key {context.idempotency_key!r} has a different request hash"
                )
            return Submission(_copy_record(existing), created=False)
        record = RunRecord(
            run_id=run_id,
            tenant_id=context.tenant_id,
            actor_id=context.actor_id,
            idempotency_key=context.idempotency_key,
            request_hash=request_hash,
            input_payload=deepcopy(dict(input_payload)),
            run_type=run_type,
        )
        self._records_by_id[(context.tenant_id, run_id)] = record
        self._records_by_idempotency[key] = run_id
        return Submission(_copy_record(record), created=True)

    def submit_commitment(
        self,
        context: RuntimeContext,
        handoff: TusCommitmentHandoff,
    ) -> Submission:
        _require_context(context)
        if context.tenant_id != handoff.tenant_id or context.actor_id != handoff.actor_id:
            raise KeyError("commitment handoff context is not authorized")
        if context.correlation_id != handoff.correlation_id:
            raise ValueError("commitment handoff correlation does not match runtime context")
        if context.idempotency_key != handoff.idempotency_key:
            raise ValueError("commitment handoff idempotency key does not match runtime context")
        return self.submit(
            context,
            run_id=f"tus-commitment-{handoff.context}-{handoff.commitment_id}",
            request_hash=handoff.request_hash,
            input_payload=handoff.payload,
            run_type=f"tus.commitment.{handoff.context}",
        )

    def get(self, context: RuntimeContext, run_id: str) -> RunRecord:
        record = self._record(context, run_id)
        return _copy_record(record)

    def claim(self, context: RuntimeContext, run_id: str) -> RunClaim:
        record = self._record(context, run_id)
        if record.status is RunStatus.RUNNING:
            raise RuntimeError(f"run {run_id!r} is already claimed")
        if record.status is RunStatus.COMPLETED:
            raise RuntimeError(f"completed run {run_id!r} cannot be claimed")
        attempt = record.attempt + 1
        claim_id = f"{run_id}:claim:{attempt}"
        self._replace(
            context,
            replace(record, status=RunStatus.RUNNING, attempt=attempt, claim_id=claim_id),
        )
        return RunClaim(run_id=run_id, claim_id=claim_id, attempt=attempt)

    def recover_crashed(self, context: RuntimeContext, run_id: str) -> RunRecord:
        record = self._record(context, run_id)
        if record.status is not RunStatus.RUNNING:
            return _copy_record(record)
        recovered = replace(
            record,
            status=RunStatus.QUEUED,
            claim_id=None,
            replay_count=record.replay_count + 1,
        )
        self._replace(context, recovered)
        return _copy_record(recovered)

    def replay(self, context: RuntimeContext, run_id: str) -> RunRecord:
        record = self._record(context, run_id)
        if record.status is RunStatus.COMPLETED:
            return _copy_record(record)
        replayed = replace(
            record,
            status=RunStatus.QUEUED,
            claim_id=None,
            replay_count=record.replay_count + 1,
        )
        self._replace(context, replayed)
        return _copy_record(replayed)

    def complete(
        self,
        context: RuntimeContext,
        run_id: str,
        claim_id: str,
        result: Mapping[str, object],
    ) -> RunRecord:
        record = self._record(context, run_id)
        self._require_claim(record, claim_id)
        completed = replace(
            record,
            status=RunStatus.COMPLETED,
            claim_id=None,
            result=deepcopy(dict(result)),
            error=None,
        )
        self._replace(context, completed)
        return _copy_record(completed)

    def fail(self, context: RuntimeContext, run_id: str, claim_id: str, error: str) -> RunRecord:
        record = self._record(context, run_id)
        self._require_claim(record, claim_id)
        failed = replace(record, status=RunStatus.FAILED, claim_id=None, error=error)
        self._replace(context, failed)
        return _copy_record(failed)

    def _record(self, context: RuntimeContext, run_id: str) -> RunRecord:
        _require_context(context)
        try:
            record = self._records_by_id[(context.tenant_id, run_id)]
        except KeyError as error:
            raise KeyError(f"No run for tenant {context.tenant_id!r} and run {run_id!r}") from error
        if record.actor_id != context.actor_id:
            raise KeyError(f"Run actor context is not authorized for {run_id!r}")
        return record

    def _replace(self, context: RuntimeContext, record: RunRecord) -> None:
        self._records_by_id[(context.tenant_id, record.run_id)] = record

    @staticmethod
    def _require_claim(record: RunRecord, claim_id: str) -> None:
        if record.status is not RunStatus.RUNNING or record.claim_id != claim_id:
            raise RuntimeError(f"stale claim for run {record.run_id!r}")


class UnavailableRunLedger:
    """Explicit no-live-claims adapter for PostgreSQL run-ledger persistence."""

    def __init__(self, backend: str) -> None:
        self.backend = backend

    def _raise(self) -> None:
        raise RunLedgerUnavailableError(
            f"run ledger backend {self.backend!r} is unavailable; use a deterministic fake"
        )

    def submit(
        self,
        context: RuntimeContext,
        run_id: str,
        request_hash: str,
        input_payload: Mapping[str, object],
    ) -> Submission:
        self._raise()
        raise AssertionError("unreachable")


def _copy_record(record: RunRecord) -> RunRecord:
    return replace(
        record,
        input_payload=deepcopy(dict(record.input_payload)),
        result=deepcopy(dict(record.result)) if record.result is not None else None,
    )


def _require_context(context: RuntimeContext) -> None:
    if not isinstance(context, RuntimeContext):
        raise TypeError("Runtime context is required")


def _require_text(value: str, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")


__all__ = [
    "IdempotencyConflictError",
    "InMemoryRunLedger",
    "RunClaim",
    "RunLedger",
    "RunLedgerUnavailableError",
    "RunRecord",
    "RunStatus",
    "Submission",
    "TusCommitmentHandoff",
    "UnavailableRunLedger",
]
