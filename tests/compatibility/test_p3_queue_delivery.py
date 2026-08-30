import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.delivery import (  # noqa: E402
    DeliveryStatus,
    InMemoryDeliveryTransport,
    QueueActivationError,
    SqsDlqDeliveryTransport,
    WorkflowDeliveryWorker,
)
from worker.langgraph.registry import RuntimeContext  # noqa: E402
from worker.run_ledger import InMemoryRunLedger  # noqa: E402


def context(*, tenant_id: str = "tenant-a", actor_id: str = "actor-1", idempotency_key: str = "idempotency-1") -> RuntimeContext:
    return RuntimeContext(
        tenant_id=tenant_id,
        actor_id=actor_id,
        correlation_id="correlation-1",
        idempotency_key=idempotency_key,
        lineage={"rootMessageId": "message-1", "source": "p3.4-test"},
    )


def queued_message(**overrides: object) -> dict[str, object]:
    return {
        "message_id": "message-1",
        "job_id": "job-1",
        "run_id": "run-1",
        "job_type": "workflow.execute",
        "tenant_id": "tenant-a",
        "actor_id": "actor-1",
        "correlation_id": "correlation-1",
        "idempotency_key": "idempotency-1",
        "lineage": {"rootMessageId": "message-1", "source": "p3.4-test"},
        "payload": {"input": {"value": 1}},
        "max_attempts": 2,
        "created_at": 100,
        **overrides,
    }


def test_delivery_claim_ack_and_context_propagation_are_tenant_and_actor_scoped():
    transport = InMemoryDeliveryTransport()
    message = transport.enqueue(queued_message())

    assert message.tenant_id == "tenant-a"
    assert message.actor_id == "actor-1"
    assert message.idempotency_key == "idempotency-1"
    assert transport.claim(context(tenant_id="tenant-b"), "worker-a", 100, 50) is None

    claim = transport.claim(context(), "worker-a", 100, 50)
    acknowledged = transport.ack(context(), claim, {"ok": True}, 101)

    assert claim.message.run_id == "run-1"
    assert acknowledged.status is DeliveryStatus.ACKNOWLEDGED
    assert transport.ack(context(), claim, {"ok": True}, 102).status is DeliveryStatus.EMPTY


def test_delivery_retry_backoff_and_dlq_are_deterministic():
    transport = InMemoryDeliveryTransport(base_backoff_ms=100, max_backoff_ms=250)
    transport.enqueue(queued_message())
    first = transport.claim(context(), "worker-a", 100, 50)
    retry = transport.retry(context(), first, "temporary", 101)
    assert retry.status is DeliveryStatus.RETRYABLE
    assert retry.available_at == 201
    assert transport.claim(context(), "worker-b", 200, 50) is None

    second = transport.claim(context(), "worker-b", 201, 50)
    dead_letter = transport.retry(context(), second, "poison", 202)
    assert dead_letter.status is DeliveryStatus.DEAD_LETTER
    assert dead_letter.error == "poison"
    assert len(transport.dead_letters("tenant-a")) == 1


def test_worker_completes_ledger_before_ack_and_retries_failed_handler():
    transport = InMemoryDeliveryTransport()
    ledger = InMemoryRunLedger()
    runtime_context = context()
    ledger.submit(runtime_context, "run-1", "hash-a", {"value": 1})
    transport.enqueue(queued_message())
    worker = WorkflowDeliveryWorker(transport, ledger)

    succeeded = worker.deliver_once(runtime_context, "worker-a", 100, lambda message, ctx: {"value": message.payload["input"]["value"], "tenant": ctx.tenant_id})
    assert succeeded.status is DeliveryStatus.ACKNOWLEDGED
    assert ledger.get(runtime_context, "run-1").result == {"value": 1, "tenant": "tenant-a"}

    failed_context = context(idempotency_key="idempotency-2")
    ledger.submit(failed_context, "run-2", "hash-b", {"value": 2})
    transport.enqueue(queued_message(message_id="message-2", job_id="job-2", run_id="run-2", idempotency_key="idempotency-2"))
    failed = worker.deliver_once(failed_context, "worker-b", 200, lambda _message, _ctx: (_ for _ in ()).throw(RuntimeError("temporary")))
    assert failed.status is DeliveryStatus.RETRYABLE
    assert ledger.get(failed_context, "run-2").replay_count == 1


def test_reconcile_requeues_expired_claims_and_sqs_is_activation_gated():
    transport = InMemoryDeliveryTransport()
    transport.enqueue(queued_message())
    claim = transport.claim(context(), "worker-a", 100, 10)
    report = transport.reconcile(context(), 111, {"run-1"})
    redelivery = transport.claim(context(), "worker-b", 111, 10)

    assert claim.message.job_id == "job-1"
    assert report.expired_claims == 1
    assert report.orphaned_messages == 0
    assert redelivery.message.job_id == "job-1"

    gated = SqsDlqDeliveryTransport("queue-ref", "dlq-ref")
    with pytest.raises(QueueActivationError):
        gated.enqueue(queued_message())
    with pytest.raises(QueueActivationError):
        gated.dead_letters("tenant-a")
    gated.activate()
    assert gated.enqueue(queued_message()).job_id == "job-1"


def test_worker_reconcile_returns_expired_claims_to_the_run_ledger_queue():
    transport = InMemoryDeliveryTransport()
    ledger = InMemoryRunLedger()
    runtime_context = context()
    ledger.submit(runtime_context, "run-1", "hash-a", {"value": 1})
    transport.enqueue(queued_message())
    ledger.claim(runtime_context, "run-1")
    transport.claim(runtime_context, "worker-a", 100, 10)
    worker = WorkflowDeliveryWorker(transport, ledger)

    report = worker.reconcile(runtime_context, 111, {"run-1"})

    assert report.expired_claims == 1
    assert ledger.get(runtime_context, "run-1").status.value == "queued"


def test_delivery_cancellation_removes_a_claim_without_mutating_business_state():
    transport = InMemoryDeliveryTransport()
    runtime_context = context()
    transport.enqueue(queued_message())
    claim = transport.claim(runtime_context, "worker-a", 100, 50)

    cancelled = transport.cancel(runtime_context, "job-1", 101, "operator requested")

    assert claim.message.job_id == "job-1"
    assert cancelled.status is DeliveryStatus.CANCELLED
    assert cancelled.queue_owns_business_state is False
