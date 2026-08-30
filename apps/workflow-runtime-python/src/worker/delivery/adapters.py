"""Explicit local and activation-gated queue adapters."""

from __future__ import annotations

from collections.abc import Collection, Mapping

from worker.langgraph.registry import RuntimeContext

from .fakes import InMemoryDeliveryTransport
from .ports import (
    DeliveryClaim,
    DeliveryMessage,
    DeliveryReconciliation,
    DeliveryResult,
    QueueActivationError,
    QueueProviderUnavailableError,
)


class RedisLocalDeliveryTransport(InMemoryDeliveryTransport):
    """Redis-local delivery semantics with deterministic in-process persistence."""


class SqsDlqDeliveryTransport(InMemoryDeliveryTransport):
    def __init__(self, queue_url_ref: str, dlq_url_ref: str) -> None:
        super().__init__()
        if not queue_url_ref.strip() or not dlq_url_ref.strip():
            raise ValueError("SQS queue references are required")
        self.queue_url_ref = queue_url_ref
        self.dlq_url_ref = dlq_url_ref
        self.activation = "disabled"

    def activate(self) -> None:
        self.activation = "enabled"

    def deactivate(self) -> None:
        self.activation = "disabled"

    def _assert_enabled(self) -> None:
        if self.activation != "enabled":
            raise QueueActivationError("SQS + DLQ is disabled until its activation gate is satisfied")

    def enqueue(self, message: DeliveryMessage | Mapping[str, object]) -> DeliveryMessage:
        self._assert_enabled()
        return super().enqueue(message)

    def claim(self, context: RuntimeContext, worker_id: str, now: int, visibility_timeout_ms: int) -> DeliveryClaim | None:
        self._assert_enabled()
        return super().claim(context, worker_id, now, visibility_timeout_ms)

    def ack(self, context: RuntimeContext, claim: DeliveryClaim | None, result: Mapping[str, object], now: int) -> DeliveryResult:
        self._assert_enabled()
        return super().ack(context, claim, result, now)

    def retry(self, context: RuntimeContext, claim: DeliveryClaim | None, error: str, now: int, delay_ms: int | None = None) -> DeliveryResult:
        self._assert_enabled()
        return super().retry(context, claim, error, now, delay_ms)

    def cancel(self, context: RuntimeContext, job_id: str, now: int, reason: str) -> DeliveryResult:
        self._assert_enabled()
        return super().cancel(context, job_id, now, reason)

    def reconcile(self, context: RuntimeContext, now: int, known_run_ids: Collection[str]) -> DeliveryReconciliation:
        self._assert_enabled()
        return super().reconcile(context, now, known_run_ids)

    def dead_letters(self, tenant_id: str) -> list[DeliveryMessage]:
        self._assert_enabled()
        return super().dead_letters(tenant_id)


class UnavailableDeliveryTransport:
    def __init__(self, provider: str) -> None:
        self.provider = provider

    def _raise(self) -> None:
        raise QueueProviderUnavailableError(self.provider)

    def enqueue(self, message: DeliveryMessage | Mapping[str, object]) -> DeliveryMessage:
        self._raise()
        raise AssertionError("unreachable")

    def claim(self, context: RuntimeContext, worker_id: str, now: int, visibility_timeout_ms: int) -> DeliveryClaim | None:
        self._raise()
        raise AssertionError("unreachable")


__all__ = ["RedisLocalDeliveryTransport", "SqsDlqDeliveryTransport", "UnavailableDeliveryTransport"]
