import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "workflow-runtime-python" / "src"))

from worker.langgraph.registry import RuntimeContext
from worker.run_ledger import InMemoryRunLedger, TusCommitmentHandoff


def context(*, tenant_id: str = "tenant-a", actor_id: str = "actor-a", idempotency_key: str = "commitment-key") -> RuntimeContext:
    return RuntimeContext(
        tenant_id=tenant_id,
        actor_id=actor_id,
        correlation_id="corr-commitment",
        idempotency_key=idempotency_key,
        lineage={"rootMessageId": "commitment-message", "source": "tus-commitment"},
    )


def test_commitment_handoff_uses_the_same_tenant_scoped_run_ledger_and_replays_safely():
    ledger = InMemoryRunLedger()
    handoff = TusCommitmentHandoff(
        tenant_id="tenant-a",
        actor_id="actor-a",
        correlation_id="corr-commitment",
        commitment_id="cart-1-product",
        context="product",
        idempotency_key="commitment-key",
        request_hash="commitment-hash",
        payload={"status": "pending"},
    )

    first = ledger.submit_commitment(context(), handoff)
    replay = ledger.submit_commitment(context(), handoff)

    assert first.created is True
    assert replay.created is False
    assert replay.record.run_type == "tus.commitment.product"
    assert replay.record.run_id == first.record.run_id
    assert replay.record.input_payload == {"status": "pending"}


def test_commitment_handoff_rejects_context_or_fingerprint_conflicts_without_mutation():
    ledger = InMemoryRunLedger()
    handoff = TusCommitmentHandoff(
        tenant_id="tenant-a",
        actor_id="actor-a",
        correlation_id="corr-commitment",
        commitment_id="cart-1-service",
        context="service",
        idempotency_key="service-key",
        request_hash="service-hash",
        payload={"status": "pending"},
    )

    ledger.submit_commitment(context(idempotency_key="service-key"), handoff)

    try:
        ledger.submit_commitment(context(idempotency_key="service-key"), replace(handoff, request_hash="other-hash"))
    except ValueError as error:
        assert "request hash" in str(error)
    else:
        raise AssertionError("fingerprint conflict was not rejected")

    assert ledger.get(context(idempotency_key="service-key"), "tus-commitment-service-cart-1-service").input_payload == {"status": "pending"}
