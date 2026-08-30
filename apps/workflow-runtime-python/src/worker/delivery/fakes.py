"""Deterministic queue fake; it stores delivery metadata, never business state."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import replace

from worker.langgraph.registry import RuntimeContext

from .ports import (
    DeliveryClaim,
    DeliveryMessage,
    DeliveryReconciliation,
    DeliveryResult,
    DeliveryStatus,
    context_matches,
    retry_backoff_ms,
)


class InMemoryDeliveryTransport:
    def __init__(self, *, base_backoff_ms: int = 100, max_backoff_ms: int = 30_000) -> None:
        self._pending: dict[str, DeliveryMessage] = {}
        self._claims: dict[str, DeliveryClaim] = {}
        self._dead_letters: dict[str, DeliveryMessage] = {}
        self._base_backoff_ms = base_backoff_ms
        self._max_backoff_ms = max_backoff_ms

    def enqueue(self, message: DeliveryMessage | Mapping[str, object]) -> DeliveryMessage:
        normalized = message if isinstance(message, DeliveryMessage) else DeliveryMessage.from_mapping(message)
        existing = self._pending.get(normalized.message_id)
        if existing is None:
            existing_claim = next(
                (claim.message for claim in self._claims.values() if claim.message.message_id == normalized.message_id),
                None,
            )
            existing = existing_claim
        if existing is not None:
            return existing
        self._pending[normalized.message_id] = normalized
        return normalized

    def claim(self, context: RuntimeContext, worker_id: str, now: int, visibility_timeout_ms: int) -> DeliveryClaim | None:
        if not worker_id.strip() or visibility_timeout_ms <= 0:
            raise ValueError("worker and visibility timeout are required")
        candidate = next(
            (
                message
                for message in self._pending.values()
                if message.available_at <= now and context_matches(context, message)
            ),
            None,
        )
        if candidate is None:
            return None
        self._pending.pop(candidate.message_id)
        message = replace(candidate, delivery_count=candidate.delivery_count + 1)
        claim = DeliveryClaim(
            receipt_id=f"receipt-{message.message_id}-{message.delivery_count}",
            worker_id=worker_id,
            attempt=message.delivery_count,
            visibility_until=now + visibility_timeout_ms,
            message=message,
        )
        self._claims[claim.receipt_id] = claim
        return claim

    def ack(self, context: RuntimeContext, claim: DeliveryClaim | None, result: Mapping[str, object], now: int) -> DeliveryResult:
        if claim is None:
            return DeliveryResult(DeliveryStatus.EMPTY)
        current = self._claims.get(claim.receipt_id)
        if current is None:
            return DeliveryResult(DeliveryStatus.EMPTY)
        if not context_matches(context, current.message):
            return DeliveryResult(DeliveryStatus.FORBIDDEN)
        self._claims.pop(claim.receipt_id)
        return DeliveryResult(DeliveryStatus.ACKNOWLEDGED, current.message)

    def retry(
        self,
        context: RuntimeContext,
        claim: DeliveryClaim | None,
        error: str,
        now: int,
        delay_ms: int | None = None,
    ) -> DeliveryResult:
        if claim is None:
            return DeliveryResult(DeliveryStatus.EMPTY)
        current = self._claims.get(claim.receipt_id)
        if current is None:
            return DeliveryResult(DeliveryStatus.EMPTY)
        if not context_matches(context, current.message):
            return DeliveryResult(DeliveryStatus.FORBIDDEN)
        if not error.strip():
            raise ValueError("queue retry error is required")
        self._claims.pop(claim.receipt_id)
        message = replace(current.message, last_error=error)
        if message.delivery_count >= message.max_attempts:
            self._dead_letters[message.message_id] = message
            return DeliveryResult(DeliveryStatus.DEAD_LETTER, message, error=error)
        wait = delay_ms if delay_ms is not None else retry_backoff_ms(message.delivery_count, self._base_backoff_ms, self._max_backoff_ms)
        message = replace(message, available_at=now + wait)
        self._pending[message.message_id] = message
        return DeliveryResult(DeliveryStatus.RETRYABLE, message, available_at=message.available_at, error=error)

    def cancel(self, context: RuntimeContext, job_id: str, now: int, reason: str) -> DeliveryResult:
        if not reason.strip():
            raise ValueError("queue cancellation reason is required")
        pending = next(
            (message for message in self._pending.values() if message.job_id == job_id and message.tenant_id == context.tenant_id),
            None,
        )
        if pending is not None:
            self._pending.pop(pending.message_id)
            return DeliveryResult(DeliveryStatus.CANCELLED, replace(pending, last_error=f"cancelled: {reason}"))
        claimed = next(
            (
                (receipt_id, claim)
                for receipt_id, claim in self._claims.items()
                if claim.message.job_id == job_id and context_matches(context, claim.message)
            ),
            None,
        )
        if claimed is not None:
            self._claims.pop(claimed[0])
            return DeliveryResult(
                DeliveryStatus.CANCELLED,
                replace(claimed[1].message, last_error=f"cancelled: {reason}"),
            )
        return DeliveryResult(DeliveryStatus.EMPTY)

    def reconcile(self, context: RuntimeContext, now: int, known_run_ids: Collection[str]) -> DeliveryReconciliation:
        expired = 0
        recovered_run_ids: list[str] = []
        for receipt_id, claim in list(self._claims.items()):
            if claim.message.tenant_id != context.tenant_id or claim.visibility_until > now:
                continue
            self._claims.pop(receipt_id)
            self._pending[claim.message.message_id] = replace(claim.message, available_at=now)
            expired += 1
            recovered_run_ids.append(claim.message.run_id)
        pending = [message for message in self._pending.values() if message.tenant_id == context.tenant_id]
        orphaned = sum(message.run_id not in known_run_ids for message in pending)
        dead_letters = sum(message.tenant_id == context.tenant_id for message in self._dead_letters.values())
        status = "recovered" if expired else "attention" if orphaned else "clean"
        return DeliveryReconciliation(status, expired, orphaned, len(pending), dead_letters, tuple(recovered_run_ids))

    def dead_letters(self, tenant_id: str) -> list[DeliveryMessage]:
        return [message for message in self._dead_letters.values() if message.tenant_id == tenant_id]


class FakeDeliveryTransport(InMemoryDeliveryTransport):
    pass


__all__ = ["FakeDeliveryTransport", "InMemoryDeliveryTransport"]
