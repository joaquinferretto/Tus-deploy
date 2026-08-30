"""Worker delivery orchestration; the run ledger remains the business authority."""

from __future__ import annotations

from collections.abc import Callable, Mapping

from worker.langgraph.registry import RuntimeContext
from worker.run_ledger import InMemoryRunLedger

from .ports import DeliveryMessage, DeliveryResult, DeliveryStatus

DeliveryHandler = Callable[[DeliveryMessage, RuntimeContext], Mapping[str, object]]


class WorkflowDeliveryWorker:
    def __init__(self, transport, ledger: InMemoryRunLedger, *, visibility_timeout_ms: int = 30_000) -> None:
        self.transport = transport
        self.ledger = ledger
        self.visibility_timeout_ms = visibility_timeout_ms

    def deliver_once(self, context: RuntimeContext, worker_id: str, now: int, handler: DeliveryHandler) -> DeliveryResult:
        claim = self.transport.claim(context, worker_id, now, self.visibility_timeout_ms)
        if claim is None:
            return DeliveryResult(DeliveryStatus.EMPTY)
        try:
            ledger_claim = self.ledger.claim(context, claim.message.run_id)
            result = handler(claim.message, context)
            self.ledger.complete(context, claim.message.run_id, ledger_claim.claim_id, result)
            return self.transport.ack(context, claim, result, now)
        except Exception as error:  # noqa: BLE001 - handler failures are retryable delivery outcomes
            self.ledger.recover_crashed(context, claim.message.run_id)
            return self.transport.retry(context, claim, str(error), now)

    def reconcile(self, context: RuntimeContext, now: int, known_run_ids: set[str]):
        report = self.transport.reconcile(context, now, known_run_ids)
        for run_id in report.recovered_run_ids:
            self.ledger.recover_crashed(context, run_id)
        return report


__all__ = ["DeliveryHandler", "WorkflowDeliveryWorker"]
