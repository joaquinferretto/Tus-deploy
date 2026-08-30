"""Provider-neutral durable delivery ports for the authoritative worker."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from worker.langgraph.registry import RuntimeContext


class DeliveryStatus(StrEnum):
    QUEUED = "queued"
    CLAIMED = "claimed"
    ACKNOWLEDGED = "acknowledged"
    RETRYABLE = "retryable"
    DEAD_LETTER = "dead_letter"
    CANCELLED = "cancelled"
    EMPTY = "empty"
    FORBIDDEN = "forbidden"


@dataclass(frozen=True, slots=True)
class DeliveryMessage:
    message_id: str
    job_id: str
    run_id: str
    job_type: str
    tenant_id: str
    actor_id: str
    correlation_id: str
    idempotency_key: str
    lineage: Mapping[str, str]
    payload: Mapping[str, object]
    max_attempts: int
    created_at: int
    available_at: int
    delivery_count: int = 0
    last_error: str | None = None

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> DeliveryMessage:
        fields = (
            "message_id",
            "job_id",
            "run_id",
            "job_type",
            "tenant_id",
            "actor_id",
            "correlation_id",
            "idempotency_key",
        )
        for field in fields:
            if not isinstance(value.get(field), str) or not str(value[field]).strip():
                raise ValueError(f"delivery message {field} is required")
        lineage = value.get("lineage")
        payload = value.get("payload")
        if not isinstance(lineage, Mapping) or not str(lineage.get("rootMessageId", "")).strip() or not str(lineage.get("source", "")).strip():
            raise ValueError("delivery message lineage is required")
        if not isinstance(payload, Mapping):
            raise TypeError("delivery message payload is required")
        max_attempts = value.get("max_attempts")
        created_at = value.get("created_at")
        available_at = value.get("available_at", created_at)
        if not isinstance(max_attempts, int) or isinstance(max_attempts, bool) or max_attempts < 1:
            raise ValueError("delivery message max_attempts must be positive")
        if not isinstance(created_at, int) or isinstance(created_at, bool) or not isinstance(available_at, int):
            raise TypeError("delivery message time is required")
        return cls(
            message_id=str(value["message_id"]),
            job_id=str(value["job_id"]),
            run_id=str(value["run_id"]),
            job_type=str(value["job_type"]),
            tenant_id=str(value["tenant_id"]),
            actor_id=str(value["actor_id"]),
            correlation_id=str(value["correlation_id"]),
            idempotency_key=str(value["idempotency_key"]),
            lineage=dict(lineage),
            payload=dict(payload),
            max_attempts=max_attempts,
            created_at=created_at,
            available_at=available_at,
        )


@dataclass(frozen=True, slots=True)
class DeliveryClaim:
    receipt_id: str
    worker_id: str
    attempt: int
    visibility_until: int
    message: DeliveryMessage


@dataclass(frozen=True, slots=True)
class DeliveryResult:
    status: DeliveryStatus
    message: DeliveryMessage | None = None
    available_at: int | None = None
    error: str | None = None
    queue_owns_business_state: bool = False


@dataclass(frozen=True, slots=True)
class DeliveryReconciliation:
    status: str
    expired_claims: int
    orphaned_messages: int
    pending_messages: int
    dead_letter_messages: int
    recovered_run_ids: tuple[str, ...] = ()
    queue_owns_business_state: bool = False


class DeliveryTransportPort(Protocol):
    def enqueue(self, message: DeliveryMessage | Mapping[str, object]) -> DeliveryMessage: ...

    def claim(
        self, context: RuntimeContext, worker_id: str, now: int, visibility_timeout_ms: int
    ) -> DeliveryClaim | None: ...

    def ack(
        self, context: RuntimeContext, claim: DeliveryClaim | None, result: Mapping[str, object], now: int
    ) -> DeliveryResult: ...

    def retry(
        self, context: RuntimeContext, claim: DeliveryClaim | None, error: str, now: int, delay_ms: int | None = None
    ) -> DeliveryResult: ...

    def cancel(self, context: RuntimeContext, job_id: str, now: int, reason: str) -> DeliveryResult: ...

    def reconcile(self, context: RuntimeContext, now: int, known_run_ids: Collection[str]) -> DeliveryReconciliation: ...

    def dead_letters(self, tenant_id: str) -> list[DeliveryMessage]: ...


class QueueActivationError(RuntimeError):
    """Raised when an external queue has not passed its activation gate."""


class QueueProviderUnavailableError(RuntimeError):
    """Raised instead of silently claiming from unavailable infrastructure."""


def retry_backoff_ms(attempt: int, base_ms: int = 100, max_ms: int = 30_000) -> int:
    if attempt < 1 or base_ms < 0 or max_ms < base_ms:
        raise ValueError("invalid queue retry backoff")
    return min(max_ms, base_ms * 2 ** (attempt - 1))


def context_matches(context: RuntimeContext, message: DeliveryMessage) -> bool:
    return (
        context.tenant_id == message.tenant_id
        and context.actor_id == message.actor_id
        and context.correlation_id == message.correlation_id
        and context.idempotency_key == message.idempotency_key
        and context.lineage.get("rootMessageId") == message.lineage.get("rootMessageId")
        and context.lineage.get("source") == message.lineage.get("source")
    )


__all__ = [
    "DeliveryClaim",
    "DeliveryMessage",
    "DeliveryReconciliation",
    "DeliveryResult",
    "DeliveryStatus",
    "DeliveryTransportPort",
    "QueueActivationError",
    "QueueProviderUnavailableError",
    "context_matches",
    "retry_backoff_ms",
]
