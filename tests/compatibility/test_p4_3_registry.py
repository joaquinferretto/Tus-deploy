import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.ai.registry import (
    ApprovalStatus,
    InMemoryAIRegistry,
    ModelAvailabilityStatus,
    RegistryContext,
    RegistryStateError,
    RolloutState,
)


def context(tenant_id: str = "tenant-a", actor_id: str = "owner") -> RegistryContext:
    return RegistryContext(
        tenant_id=tenant_id,
        actor_id=actor_id,
        correlation_id=f"corr-{tenant_id}-{actor_id}",
    )


def approved_prompt_and_model(registry: InMemoryAIRegistry):
    prompt = registry.register_prompt(context(), "welcome", "team-a")
    first = registry.create_prompt_version(
        context(), prompt.id, "Hello {{name}}", version=1
    )
    approval = registry.request_approval(context(), "prompt_version", first.id)
    registry.approve(context(actor_id="reviewer"), approval.id)
    model = registry.register_model(
        context(), "local-fake", "fake", "deterministic-v1", "team-a"
    )
    registry.set_model_availability(
        context(),
        model.id,
        ModelAvailabilityStatus.AVAILABLE,
        "local fake is deterministic",
    )
    return prompt, first, model


def test_registry_versions_are_immutable_and_tenant_scoped():
    registry = InMemoryAIRegistry(clock=lambda: 100)
    prompt = registry.register_prompt(context(), "welcome", "team-a")
    version = registry.create_prompt_version(
        context(), prompt.id, "Hello {{name}}", version=1
    )

    assert version.version == 1
    assert registry.get_prompt_version(context(), version.id).checksum
    with pytest.raises(RegistryStateError, match="immutable"):
        registry.create_prompt_version(context(), prompt.id, "Changed", version=1)
    with pytest.raises(KeyError, match="tenant"):
        registry.get_prompt_version(context("tenant-b"), version.id)


def test_approval_and_availability_are_required_before_rollout_activation():
    registry = InMemoryAIRegistry(clock=lambda: 100)
    prompt, version, model = approved_prompt_and_model(registry)
    approval = next(
        item
        for item in registry.list_approvals(context())
        if item.resource_id == version.id
    )
    assert approval.status is ApprovalStatus.APPROVED

    rollout = registry.create_rollout(
        context(), prompt.id, version.version, model.id, 100
    )
    rollout_approval = registry.request_approval(context(), "rollout", rollout.id)
    registry.approve(context(actor_id="reviewer"), rollout_approval.id)
    assert rollout.state is RolloutState.DRAFT
    activated = registry.activate_rollout(context(), rollout.id)
    assert activated.state is RolloutState.ACTIVE

    registry.set_model_availability(
        context(), model.id, ModelAvailabilityStatus.UNAVAILABLE, "outage"
    )
    with pytest.raises(RegistryStateError, match="available"):
        registry.create_rollout(context(), prompt.id, version.version, model.id, 10)


def test_rollout_approval_is_required_and_runtime_validation_fails_closed():
    registry = InMemoryAIRegistry(clock=lambda: 100)
    prompt, version, model = approved_prompt_and_model(registry)
    rollout = registry.create_rollout(
        context(), prompt.id, version.version, model.id, 100
    )
    approval = registry.request_approval(context(), "rollout", rollout.id)

    with pytest.raises(RegistryStateError, match="approval"):
        registry.activate_rollout(context(), rollout.id)

    registry.approve(context(actor_id="reviewer"), approval.id)
    assert registry.activate_rollout(context(), rollout.id).state is RolloutState.ACTIVE
    with pytest.raises(RegistryStateError, match="payload"):
        registry.evaluate(context(), rollout.id, None)  # type: ignore[arg-type]


def test_deprecation_provider_failure_and_explicit_rollback_fail_closed():
    registry = InMemoryAIRegistry(clock=lambda: 100)
    prompt, first, model = approved_prompt_and_model(registry)
    second = registry.create_prompt_version(
        context(), prompt.id, "Hi {{name}}", version=2
    )
    approval = registry.request_approval(context(), "prompt_version", second.id)
    registry.approve(context(actor_id="reviewer"), approval.id)
    pending_rollout = registry.create_rollout(
        context(), prompt.id, second.version, model.id, 100
    )
    rollout_approval = registry.request_approval(
        context(), "rollout", pending_rollout.id
    )
    registry.approve(context(actor_id="reviewer"), rollout_approval.id)
    rollout = registry.activate_rollout(context(), pending_rollout.id)

    registry.deprecate_prompt_version(context(), prompt.id, second.version, "bad copy")
    with pytest.raises(RegistryStateError, match="deprecated"):
        registry.evaluate(context(), rollout.id, {"name": "Ada"})

    registry.rollback_rollout(
        context(), rollout.id, first.version, "restore passing prompt"
    )
    restored = registry.get_active_rollout(context(), prompt.id)
    assert restored.prompt_version == first.version
    assert restored.state is RolloutState.ACTIVE

    registry.record_provider_failure(context(), model.id, "fake timeout")
    failed = registry.get_rollout(context(), restored.id)
    assert failed.state is RolloutState.PAUSED
    with pytest.raises(RegistryStateError, match="unavailable"):
        registry.evaluate(context(), restored.id, {"name": "Ada"})


def test_deterministic_evaluator_is_repeatable_and_audit_is_redacted():
    registry = InMemoryAIRegistry(clock=lambda: 100)
    prompt, version, model = approved_prompt_and_model(registry)
    pending_rollout = registry.create_rollout(
        context(), prompt.id, version.version, model.id, 100
    )
    rollout_approval = registry.request_approval(
        context(), "rollout", pending_rollout.id
    )
    registry.approve(context(actor_id="reviewer"), rollout_approval.id)
    rollout = registry.activate_rollout(context(), pending_rollout.id)

    first = registry.evaluate(
        context(), rollout.id, {"name": "Ada", "secret": "do-not-log"}
    )
    second = registry.evaluate(
        context(), rollout.id, {"name": "Ada", "secret": "do-not-log"}
    )
    assert first == second
    assert first.quality == 1.0
    assert first.latency_ms == 17
    assert all(
        "secret" not in str(event.metadata) for event in registry.audit_log(context())
    )
    assert registry.audit_log(context("tenant-b")) == ()


def test_deterministic_evaluator_canonicalizes_nested_input_order():
    registry = InMemoryAIRegistry(clock=lambda: 100)
    prompt, version, model = approved_prompt_and_model(registry)
    pending_rollout = registry.create_rollout(
        context(), prompt.id, version.version, model.id, 100
    )
    rollout_approval = registry.request_approval(
        context(), "rollout", pending_rollout.id
    )
    registry.approve(context(actor_id="reviewer"), rollout_approval.id)
    rollout = registry.activate_rollout(context(), pending_rollout.id)

    first = registry.evaluate(context(), rollout.id, {"nested": {"a": 1, "b": 2}})
    second = registry.evaluate(context(), rollout.id, {"nested": {"b": 2, "a": 1}})
    assert first.output == second.output
