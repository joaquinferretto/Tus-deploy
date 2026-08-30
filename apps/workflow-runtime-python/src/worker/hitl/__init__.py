"""Approval requests and decisions for resumable human-in-the-loop runs."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Protocol

from worker.langgraph.registry import RuntimeContext
from worker.policy import DenyByDefaultPolicy


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


@dataclass(frozen=True, slots=True)
class ApprovalRecord:
    approval_id: str
    thread_id: str
    action: str
    reason: str
    status: ApprovalStatus
    requester: RuntimeContext
    approver_actor_id: str | None = None
    metadata: Mapping[str, object] = ()


class ApprovalStore(Protocol):
    def save(self, record: ApprovalRecord) -> ApprovalRecord: ...

    def get(self, context: RuntimeContext, approval_id: str) -> ApprovalRecord: ...


class InMemoryApprovalStore:
    def __init__(self) -> None:
        self._records: dict[tuple[str, str], ApprovalRecord] = {}

    def save(self, record: ApprovalRecord) -> ApprovalRecord:
        stored = _copy_record(record)
        self._records[(record.requester.tenant_id, record.approval_id)] = stored
        return _copy_record(stored)

    def get(self, context: RuntimeContext, approval_id: str) -> ApprovalRecord:
        try:
            record = self._records[(context.tenant_id, approval_id)]
        except KeyError as error:
            raise KeyError(f"No approval for tenant {context.tenant_id!r}") from error
        return _copy_record(record)


class UnavailableApprovalStore:
    """Explicit no-live-claims adapter for durable approval persistence."""

    def __init__(self, backend: str) -> None:
        self.backend = backend

    def _raise(self) -> None:
        raise RuntimeError(
            f"approval backend {self.backend!r} is unavailable; use a deterministic fake"
        )

    def save(self, record: ApprovalRecord) -> ApprovalRecord:
        self._raise()
        raise AssertionError("unreachable")

    def get(self, context: RuntimeContext, approval_id: str) -> ApprovalRecord:
        self._raise()
        raise AssertionError("unreachable")


class HITLApprovalService:
    def __init__(self, policy: DenyByDefaultPolicy, store: ApprovalStore) -> None:
        self.policy = policy
        self.store = store

    def request(
        self,
        context: RuntimeContext,
        thread_id: str,
        *,
        action: str,
        reason: str = "",
        metadata: Mapping[str, object] | None = None,
    ) -> ApprovalRecord:
        self.policy.require_hitl(context, action)
        _require_text(thread_id, "thread_id")
        _require_text(action, "action")
        approval_id = f"{context.tenant_id}:{thread_id}:{action}:{context.idempotency_key}"
        try:
            return self.store.get(context, approval_id)
        except KeyError:
            return self.store.save(
                ApprovalRecord(
                    approval_id=approval_id,
                    thread_id=thread_id,
                    action=action,
                    reason=reason,
                    status=ApprovalStatus.PENDING,
                    requester=context,
                    metadata=deepcopy(dict(metadata or {})),
                )
            )

    def get(self, context: RuntimeContext, approval_id: str) -> ApprovalRecord:
        return self.store.get(context, approval_id)

    def approve(self, context: RuntimeContext, approval_id: str) -> ApprovalRecord:
        record = self.store.get(context, approval_id)
        if record.status is not ApprovalStatus.PENDING:
            return record
        self.policy.require_hitl(context, record.action)
        if context.actor_id == record.requester.actor_id:
            raise PermissionError("requester cannot approve its own HITL request")
        return self.store.save(
            replace(record, status=ApprovalStatus.APPROVED, approver_actor_id=context.actor_id)
        )

    def deny(self, context: RuntimeContext, approval_id: str) -> ApprovalRecord:
        record = self.store.get(context, approval_id)
        if record.status is not ApprovalStatus.PENDING:
            return record
        self.policy.require_hitl(context, record.action)
        if context.actor_id == record.requester.actor_id:
            raise PermissionError("requester cannot deny its own HITL request")
        return self.store.save(
            replace(record, status=ApprovalStatus.DENIED, approver_actor_id=context.actor_id)
        )


def _copy_record(record: ApprovalRecord) -> ApprovalRecord:
    return replace(record, metadata=deepcopy(dict(record.metadata)))


def _require_text(value: str, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")


__all__ = [
    "ApprovalRecord",
    "ApprovalStatus",
    "ApprovalStore",
    "HITLApprovalService",
    "InMemoryApprovalStore",
    "UnavailableApprovalStore",
]
