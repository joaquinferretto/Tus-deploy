import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.checkpoint import (
    CheckpointService,
    CheckpointStatus,
    InMemoryCheckpointStore,
)
from worker.hitl import (
    ApprovalStatus,
    HITLApprovalService,
    InMemoryApprovalStore,
    UnavailableApprovalStore,
)
from worker.langgraph.registry import RuntimeContext, create_local_registry
from worker.memory import InMemoryThreadStateStore, UnavailableThreadStateStore
from worker.policy import (
    DenyByDefaultPolicy,
    PolicyDeniedError,
    PolicyEnforcedToolExecutor,
)
from worker.run_ledger import (
    IdempotencyConflictError,
    InMemoryRunLedger,
    RunStatus,
    UnavailableRunLedger,
)


def context(*, tenant_id: str = "tenant-a", actor_id: str = "actor-1") -> RuntimeContext:
    return RuntimeContext(
        tenant_id=tenant_id,
        actor_id=actor_id,
        correlation_id="corr-1",
        idempotency_key="idem-1",
        lineage={"rootMessageId": "message-1", "source": "p3.3-test"},
    )


def test_checkpoint_pause_resume_persists_versioned_thread_state_and_is_tenant_scoped():
    service = CheckpointService(InMemoryCheckpointStore())
    runtime_context = context()

    paused = service.save_checkpoint(
        runtime_context,
        thread_id="thread-1",
        state={"step": "approval", "value": 3},
        status=CheckpointStatus.PAUSED,
    )
    resumed = service.resume(runtime_context, "thread-1")

    assert paused.version == 1
    assert paused.status is CheckpointStatus.PAUSED
    assert resumed.status is CheckpointStatus.RUNNING
    assert resumed.state == {"step": "approval", "value": 3}
    assert resumed.context.actor_id == "actor-1"
    with pytest.raises(KeyError, match="tenant"):
        service.load(context(tenant_id="tenant-b"), "thread-1")


def test_checkpoint_versions_multiple_pauses_and_rejects_wrong_actor_context():
    service = CheckpointService(InMemoryCheckpointStore())
    runtime_context = context()

    service.save_checkpoint(runtime_context, "thread-1", {"step": "one"})
    second = service.save_checkpoint(runtime_context, "thread-1", {"step": "two"})

    assert second.version == 2
    assert service.load(runtime_context, "thread-1").state == {"step": "two"}
    with pytest.raises(KeyError, match="actor"):
        service.load(context(actor_id="actor-2"), "thread-1")


def test_checkpoint_same_tenant_actor_cannot_overwrite_existing_thread():
    service = CheckpointService(InMemoryCheckpointStore())
    owner = context(actor_id="actor-1")
    other_actor = context(actor_id="actor-2")

    service.save_checkpoint(owner, "thread-1", {"step": "owner"})

    with pytest.raises(KeyError, match="actor"):
        service.save_checkpoint(other_actor, "thread-1", {"step": "attacker"})

    assert service.load(owner, "thread-1").state == {"step": "owner"}
    assert service.save_checkpoint(other_actor, "thread-2", {"step": "other-owner"}).version == 1


def test_thread_state_store_copies_values_and_external_adapter_is_explicitly_unavailable():
    store = InMemoryThreadStateStore()
    runtime_context = context()
    original = {"nested": {"value": "before"}}

    store.save(runtime_context, "thread-1", original)
    original["nested"]["value"] = "after"

    assert store.load(runtime_context, "thread-1") == {"nested": {"value": "before"}}
    with pytest.raises(RuntimeError, match="unavailable"):
        UnavailableThreadStateStore("postgres checkpoint database").save(
            runtime_context, "thread-1", {"state": "x"}
        )


def test_thread_state_same_tenant_actor_cannot_overwrite_existing_thread():
    store = InMemoryThreadStateStore()
    owner = context(actor_id="actor-1")
    other_actor = context(actor_id="actor-2")

    store.save(owner, "thread-1", {"step": "owner"})

    with pytest.raises(KeyError, match="actor"):
        store.save(other_actor, "thread-1", {"step": "attacker"})

    assert store.load(owner, "thread-1") == {"step": "owner"}
    assert store.save(other_actor, "thread-2", {"step": "other-owner"}).version == 1


def test_hitl_requires_explicit_policy_and_approval_is_idempotent():
    policy = DenyByDefaultPolicy()
    approvals = HITLApprovalService(policy, InMemoryApprovalStore())
    requester = context(actor_id="requester")
    approver = context(actor_id="approver")

    with pytest.raises(PolicyDeniedError, match="denied"):
        approvals.request(requester, "thread-1", action="publish")

    policy.allow_hitl(requester.tenant_id, "publish", requester.actor_id)
    policy.allow_hitl(approver.tenant_id, "publish", approver.actor_id)
    request = approvals.request(requester, "thread-1", action="publish")
    approved = approvals.approve(approver, request.approval_id)
    repeated = approvals.approve(approver, request.approval_id)

    assert approved.status is ApprovalStatus.APPROVED
    assert repeated == approved
    assert approvals.get(requester, request.approval_id).status is ApprovalStatus.APPROVED


def test_unavailable_hitl_store_is_explicit_instead_of_silent_memory_fallback():
    with pytest.raises(RuntimeError, match="unavailable"):
        UnavailableApprovalStore("postgres approvals").get(context(), "approval-1")


def test_tool_policy_denies_by_default_and_protected_executor_cannot_bypass_tenant_scope():
    registry = create_local_registry()
    policy = DenyByDefaultPolicy()
    executor = PolicyEnforcedToolExecutor(registry.tools, policy)
    runtime_context = context()

    with pytest.raises(PolicyDeniedError, match="denied"):
        executor.invoke("deterministic.echo", runtime_context, {"value": "blocked"})

    policy.allow_tool(runtime_context.tenant_id, "deterministic.echo", runtime_context.actor_id)
    assert executor.invoke("deterministic.echo", runtime_context, {"value": "allowed"}) == {
        "value": "allowed"
    }
    with pytest.raises(PolicyDeniedError, match="denied"):
        executor.invoke(
            "deterministic.echo",
            context(tenant_id="tenant-b"),
            {"value": "cross-tenant"},
        )


def test_run_ledger_replays_same_request_without_duplicate_effect_and_fences_conflicts():
    ledger = InMemoryRunLedger()
    runtime_context = context()

    first = ledger.submit(
        runtime_context,
        run_id="run-1",
        request_hash="hash-a",
        input_payload={"value": 1},
    )
    replay = ledger.submit(
        runtime_context,
        run_id="run-2",
        request_hash="hash-a",
        input_payload={"value": 1},
    )
    with pytest.raises(IdempotencyConflictError, match="request hash"):
        ledger.submit(
            runtime_context,
            run_id="run-3",
            request_hash="hash-b",
            input_payload={"value": 2},
        )

    claim = ledger.claim(runtime_context, first.record.run_id)
    ledger.recover_crashed(runtime_context, first.record.run_id)
    redelivery = ledger.claim(runtime_context, first.record.run_id)
    ledger.complete(runtime_context, first.record.run_id, redelivery.claim_id, {"ok": True})

    assert first.created is True
    assert replay.created is False
    assert replay.record.run_id == "run-1"
    assert ledger.get(runtime_context, "run-1").replay_count == 1
    assert ledger.get(runtime_context, "run-1").result == {"ok": True}
    with pytest.raises(RuntimeError, match="stale claim"):
        ledger.complete(runtime_context, first.record.run_id, claim.claim_id, {"ok": False})


def test_run_ledger_rejects_cross_tenant_replay_and_external_ledger_is_unavailable():
    ledger = InMemoryRunLedger()
    ledger.submit(
        context(tenant_id="tenant-a"),
        run_id="run-1",
        request_hash="hash-a",
        input_payload={"value": 1},
    )

    with pytest.raises(KeyError, match="tenant"):
        ledger.get(context(tenant_id="tenant-b"), "run-1")
    with pytest.raises(RuntimeError, match="unavailable"):
        UnavailableRunLedger("postgres run ledger").submit(
            context(), "run-2", "hash-b", {"value": 2}
        )


def test_run_ledger_same_tenant_actor_cannot_take_idempotency_record():
    ledger = InMemoryRunLedger()
    owner = context(actor_id="actor-1")
    other_actor = context(actor_id="actor-2")

    first = ledger.submit(owner, "run-1", "hash-a", {"value": 1})

    with pytest.raises(KeyError, match="actor"):
        ledger.submit(other_actor, "run-2", "hash-a", {"value": 1})
    with pytest.raises(KeyError, match="actor"):
        ledger.submit(other_actor, "run-3", "hash-b", {"value": 2})

    replay = ledger.submit(owner, "run-4", "hash-a", {"value": 1})
    assert first.created is True
    assert replay.created is False
    assert replay.record.run_id == "run-1"


def test_failed_run_can_be_explicitly_replayed_with_a_new_claim():
    ledger = InMemoryRunLedger()
    runtime_context = context()
    submission = ledger.submit(runtime_context, "run-1", "hash-a", {"value": 1})
    claim = ledger.claim(runtime_context, submission.record.run_id)
    ledger.fail(runtime_context, submission.record.run_id, claim.claim_id, "temporary failure")

    replayed = ledger.replay(runtime_context, submission.record.run_id)
    next_claim = ledger.claim(runtime_context, submission.record.run_id)

    assert replayed.status is RunStatus.QUEUED
    assert replayed.replay_count == 1
    assert next_claim.attempt == 2
