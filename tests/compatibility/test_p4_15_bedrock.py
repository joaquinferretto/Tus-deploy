import hashlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.ai.bedrock import (
    BedrockActivationGate,
    BedrockActivationRequirements,
    BedrockAdapter,
    BedrockRequest,
    DeterministicBedrock,
    ProviderUnavailableError,
)
from worker.langgraph.registry import RuntimeContext


def context() -> RuntimeContext:
    return RuntimeContext(
        tenant_id="tenant-a",
        actor_id="actor-a",
        correlation_id="corr-a",
        idempotency_key="idem-a",
        lineage={"rootMessageId": "message-a", "source": "p4.15-test"},
    )


def request(payload: dict[str, object] | None = None) -> BedrockRequest:
    return BedrockRequest(
        service="bedrock",
        operation="converse",
        payload=payload or {"prompt": "safe fixture"},
        context=context(),
    )


def requirements(**overrides: bool) -> BedrockActivationRequirements:
    values = {
        "credits": True,
        "credentials": True,
        "region": True,
        "quota": True,
        "owner_approval": True,
        "live_conformance": True,
    }
    values.update(overrides)
    return BedrockActivationRequirements(**values)


def test_activation_requires_every_paid_live_gate_without_exposing_values():
    for missing in (
        "credits",
        "credentials",
        "region",
        "quota",
        "owner_approval",
        "live_conformance",
    ):
        gate = BedrockActivationGate(
            requirements=requirements(**{missing: False}),
            region="us-east-1",
            config_ref="secret-store:bedrock",
        )
        assert gate.active is False
        assert missing in gate.missing_requirements
        with pytest.raises(ProviderUnavailableError, match="activation"):
            gate.assert_active()


def test_no_region_is_gated_even_when_other_requirements_are_true():
    gate = BedrockActivationGate(
        requirements=requirements(), region="", config_ref="secret-store:bedrock"
    )
    assert gate.active is False
    assert "region" in gate.missing_requirements


def test_deterministic_bedrock_is_repeatable_and_never_calls_a_provider():
    fake = DeterministicBedrock()
    first = fake.invoke(request())
    second = fake.invoke(request())

    assert first == second
    assert first.provider == "fake"
    expected_digest = hashlib.sha256(b'{"prompt":"safe fixture"}').hexdigest()[:16]
    assert first.output == f"fake-bedrock-{expected_digest}"
    assert first.lineage.tenant_id == "tenant-a"
    assert first.usage.estimated_cost_usd == 0.0


def test_injected_bedrock_transport_requires_all_gates_and_sanitizes_failures():
    calls: list[BedrockRequest] = []

    def transport(item: BedrockRequest) -> str:
        calls.append(item)
        return "provider-result"

    adapter = BedrockAdapter(
        transport,
        requirements=requirements(),
        region="us-east-1",
        config_ref="secret-store:bedrock",
    )
    response = adapter.invoke(request())
    assert response.output == "provider-result"
    assert response.provider == "bedrock"
    assert len(calls) == 1

    failing = BedrockAdapter(
        lambda _: (_ for _ in ()).throw(RuntimeError("token=hidden prompt=private")),
        requirements=requirements(),
        region="us-east-1",
        config_ref="secret-store:bedrock",
    )
    with pytest.raises(RuntimeError, match="request failed") as error:
        failing.invoke(request())
    assert "hidden" not in str(error.value)
    assert "private" not in str(error.value)
