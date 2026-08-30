import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.ai.llm import (
    LLMRequest,
    LLMResponse,
    ProviderUnavailableError,
    UsageMetadata,
)
from worker.ai.quota import HardTenantQuota, QuotaExceededError, TenantQuota
from worker.ai.routing import (
    ProviderRoute,
    ProviderRouter,
    RoutingError,
    RoutingPolicy,
)
from worker.ai.usage import InMemoryUsageLedger
from worker.langgraph.registry import RuntimeContext


def context(tenant_id: str = "tenant-a") -> RuntimeContext:
    return RuntimeContext(
        tenant_id=tenant_id,
        actor_id="actor-a",
        correlation_id=f"corr-{tenant_id}",
        idempotency_key=f"idem-{tenant_id}",
        lineage={"rootMessageId": f"message-{tenant_id}", "source": "p4.4-test"},
    )


def request(tenant_id: str = "tenant-a") -> LLMRequest:
    return LLMRequest(
        prompt="Summarize the neutral platform",
        context=context(tenant_id),
        model="requested-model",
        max_tokens=12,
    )


@dataclass
class ScriptedProvider:
    provider: str
    model: str
    responses: list[str | BaseException]

    def __post_init__(self) -> None:
        self.calls = 0

    def complete(self, current: LLMRequest) -> LLMResponse:
        outcome = self.responses[min(self.calls, len(self.responses) - 1)]
        self.calls += 1
        if isinstance(outcome, BaseException):
            raise outcome
        return LLMResponse(
            text=outcome,
            provider=self.provider,
            model=self.model,
            usage=UsageMetadata(
                prompt_tokens=4,
                completion_tokens=3,
                total_tokens=7,
                estimated_cost_usd=0.002,
            ),
            lineage=current.context,
        )


def test_timeout_retries_are_bounded_and_fallback_is_explicit():
    timeout_provider = ScriptedProvider(
        "primary", "primary-v1", [TimeoutError("primary timed out")]
    )
    fallback_provider = ScriptedProvider("fallback", "fallback-v1", ["fallback answer"])
    router = ProviderRouter(
        routes=(
            ProviderRoute("primary", "primary-v1", timeout_provider),
            ProviderRoute("fallback", "fallback-v1", fallback_provider),
        ),
        policy=RoutingPolicy(
            tenant_routes={
                "tenant-a": (("primary", "primary-v1"), ("fallback", "fallback-v1"))
            },
            max_attempts=2,
            timeout_ms=50,
        ),
    )

    result = router.complete(request())

    assert result.response.provider == "fallback"
    assert result.metadata.fallback_used is True
    assert result.metadata.fallback_reason == "timeout"
    assert result.metadata.attempt_count == 3
    assert result.metadata.timeout_count == 2
    assert timeout_provider.calls == 2


def test_circuit_open_skips_primary_and_records_switch_without_silent_fallback():
    now = [1000]
    primary = ScriptedProvider(
        "primary", "primary-v1", [ProviderUnavailableError("down")]
    )
    fallback = ScriptedProvider("fallback", "fallback-v1", ["ok", "still ok"])
    router = ProviderRouter(
        routes=(
            ProviderRoute("primary", "primary-v1", primary, failure_threshold=1),
            ProviderRoute("fallback", "fallback-v1", fallback),
        ),
        policy=RoutingPolicy(
            tenant_routes={
                "tenant-a": (("primary", "primary-v1"), ("fallback", "fallback-v1"))
            },
            max_attempts=1,
            timeout_ms=50,
        ),
        clock=lambda: now[0],
    )

    first = router.complete(request())
    now[0] = 1001
    second = router.complete(request())

    assert first.metadata.fallback_used is True
    assert first.metadata.fallback_reason == "provider_error"
    assert second.metadata.fallback_used is True
    assert second.metadata.fallback_reason == "circuit_open"
    assert second.metadata.circuit_open_count == 1
    assert primary.calls == 1
    assert fallback.calls == 2


def test_provider_switch_is_not_silent_when_no_fallback_is_configured():
    primary = ScriptedProvider(
        "primary", "primary-v1", [ProviderUnavailableError("down")]
    )
    router = ProviderRouter(
        routes=(ProviderRoute("primary", "primary-v1", primary, failure_threshold=1),),
        policy=RoutingPolicy(
            tenant_routes={"tenant-a": (("primary", "primary-v1"),)},
            max_attempts=1,
            timeout_ms=50,
        ),
    )

    with pytest.raises(RoutingError) as error:
        router.complete(request())

    assert error.value.metadata.fallback_used is False
    assert error.value.metadata.selected_provider is None
    assert error.value.metadata.attempt_count == 1


def test_usage_cost_is_accounted_and_hard_quota_is_tenant_scoped():
    usage = InMemoryUsageLedger()
    quota = HardTenantQuota()
    quota.configure(
        "tenant-a", TenantQuota(max_requests=1, max_tokens=10, max_cost_usd=0.01)
    )
    quota.configure(
        "tenant-b", TenantQuota(max_requests=1, max_tokens=10, max_cost_usd=0.01)
    )
    provider = ScriptedProvider("fake", "fake-v1", ["answer"])
    router = ProviderRouter(
        routes=(ProviderRoute("fake", "fake-v1", provider),),
        policy=RoutingPolicy(
            tenant_routes={"tenant-a": (("fake", "fake-v1"),)},
            max_attempts=1,
            timeout_ms=50,
        ),
        quota=quota,
        usage=usage,
    )

    result = router.complete(request())

    assert result.metadata.cost_usd == 0.002
    assert usage.total_for("tenant-a").total_tokens == 7
    assert usage.total_for("tenant-a").cost_usd == 0.002
    assert quota.usage("tenant-a").requests == 1
    with pytest.raises(QuotaExceededError, match="requests"):
        router.complete(request())
    assert quota.usage("tenant-b").requests == 0


def test_tenant_route_allow_list_is_explicit_and_cross_tenant_is_denied():
    tenant_a = ScriptedProvider("provider-a", "model-a", ["a"])
    tenant_b = ScriptedProvider("provider-b", "model-b", ["b"])
    router = ProviderRouter(
        routes=(
            ProviderRoute("provider-a", "model-a", tenant_a),
            ProviderRoute("provider-b", "model-b", tenant_b),
        ),
        policy=RoutingPolicy(
            tenant_routes={
                "tenant-a": (("provider-a", "model-a"),),
                "tenant-b": (("provider-b", "model-b"),),
            },
            max_attempts=1,
            timeout_ms=50,
        ),
    )

    assert router.complete(request("tenant-a")).response.model == "model-a"
    assert router.complete(request("tenant-b")).response.model == "model-b"
    with pytest.raises(RoutingError, match="tenant route"):
        router.complete(request("tenant-c"))
