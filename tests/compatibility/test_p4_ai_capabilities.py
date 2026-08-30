import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.ai.chat import ChatMessage, ChatRequest, DeterministicChat
from worker.ai.llm import (
    DeterministicLLM,
    GroqLLM,
    LLMRequest,
    ProviderUnavailableError,
    UsageMetadata,
)
from worker.ai.structured import (
    StructuredOutputExecutor,
    StructuredOutputRequest,
    StructuredOutputStatus,
)
from worker.ai.tools import (
    PermissionedTool,
    PermissionedToolExecutor,
    ToolRequest,
    ToolStatus,
)
from worker.langgraph.registry import RuntimeContext


def context(
    *, tenant_id: str = "tenant-a", actor_id: str = "actor-a"
) -> RuntimeContext:
    return RuntimeContext(
        tenant_id=tenant_id,
        actor_id=actor_id,
        correlation_id="corr-a",
        idempotency_key="idem-a",
        lineage={"rootMessageId": "message-a", "source": "p4.1-test"},
    )


def test_p4_schemas_are_versioned_strict_and_lineage_aware():
    schema_paths = sorted(
        (ROOT / "packages" / "ai-contracts" / "schemas").rglob("*.schema.json")
    )

    assert len(schema_paths) >= 8
    schemas = [json.loads(path.read_text(encoding="utf-8")) for path in schema_paths]
    assert all(schema["type"] == "object" for schema in schemas)
    assert all(schema["additionalProperties"] is False for schema in schemas)
    assert all(
        schema["properties"]["contractVersion"]["const"] == "1.0.0"
        for schema in schemas
    )
    assert all("tenantId" in schema["required"] for schema in schemas)
    assert all("actorId" in schema["required"] for schema in schemas)


def test_deterministic_llm_is_repeatable_and_records_usage_cost_and_lineage():
    request = LLMRequest(
        prompt="Summarize the neutral platform",
        context=context(),
        model="fake-model.v1",
        max_tokens=20,
    )
    llm = DeterministicLLM()

    first = llm.complete(request)
    second = llm.complete(request)

    assert first == second
    assert first.provider == "fake"
    assert first.text == "fake response: Summarize the neutral platform"
    assert first.usage.total_tokens == (
        first.usage.prompt_tokens + first.usage.completion_tokens
    )
    assert first.usage.estimated_cost_usd == 0.0
    assert first.lineage.tenant_id == "tenant-a"
    assert first.lineage.actor_id == "actor-a"


def test_groq_active_uses_injected_transport_without_network_and_gated_fails_closed():
    request = LLMRequest(
        prompt="hello", context=context(), model="llama-3.1-8b-instant"
    )
    active = GroqLLM(
        transport=lambda _: "groq-local-response",
        active=True,
    )

    response = active.complete(request)

    assert response.provider == "groq"
    assert response.text == "groq-local-response"
    assert response.usage.estimated_cost_usd > 0
    assert response.lineage.correlation_id == "corr-a"

    with pytest.raises(ProviderUnavailableError, match="gated"):
        GroqLLM(active=False).complete(request)


def test_chat_preserves_order_and_context_for_deterministic_fake():
    chat = DeterministicChat(DeterministicLLM())
    response = chat.complete(
        ChatRequest(
            messages=(
                ChatMessage("system", "You are concise"),
                ChatMessage("user", "Say hello"),
            ),
            context=context(),
            model="fake-chat.v1",
        )
    )

    assert response.text == "fake response: system: You are concise\nuser: Say hello"
    assert response.lineage.tenant_id == "tenant-a"


class ScriptedChat:
    def __init__(self, responses: list[str]):
        self.responses = responses
        self.calls = 0

    def complete(self, request: ChatRequest):
        from worker.ai.chat import ChatResponse

        text = self.responses[min(self.calls, len(self.responses) - 1)]
        self.calls += 1
        prompt = "\n".join(message.content for message in request.messages)
        return ChatResponse(
            text=text,
            provider="fake-scripted",
            model=request.model,
            usage=UsageMetadata.from_text(prompt, text, cost_per_1k_tokens=0.0),
            lineage=request.context,
        )


def test_structured_output_validates_and_retries_only_within_bound():
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["answer"],
        "properties": {"answer": {"type": "string"}},
    }
    executor = StructuredOutputExecutor(ScriptedChat(["not-json", '{"answer":"ok"}']))

    result = executor.complete(
        StructuredOutputRequest(
            prompt="Return an answer",
            schema=schema,
            context=context(),
            max_attempts=2,
        )
    )

    assert result.status is StructuredOutputStatus.SUCCEEDED
    assert result.output == {"answer": "ok"}
    assert result.attempts == 2
    assert result.errors == ("invalid JSON",)


def test_structured_output_failure_is_bounded_and_reports_validation_reason():
    schema = {"type": "object", "required": ["answer"]}
    executor = StructuredOutputExecutor(ScriptedChat(['{"wrong":true}']))

    result = executor.complete(
        StructuredOutputRequest(
            prompt="Return an answer",
            schema=schema,
            context=context(),
            max_attempts=99,
        )
    )

    assert result.status is StructuredOutputStatus.FAILED
    assert result.output is None
    assert result.attempts == 3
    assert len(result.errors) == 3
    assert all("answer" in error for error in result.errors)


def test_permissioned_tools_return_explicit_denial_audit_without_running_handler():
    calls: list[dict[str, object]] = []
    executor = PermissionedToolExecutor()
    executor.register(
        PermissionedTool(
            name="catalog.lookup",
            input_schema={"type": "object", "required": ["sku"]},
            permission="catalog:read",
            handler=lambda arguments, _: calls.append(dict(arguments)) or {"price": 10},
        )
    )
    request = ToolRequest("catalog.lookup", {"sku": "sku-1"}, context())

    denied = executor.invoke(request)

    assert denied.status is ToolStatus.DENIED
    assert denied.output is None
    assert denied.audit.decision == "denied"
    assert denied.audit.reason == "deny by default"
    assert denied.audit.tenant_id == "tenant-a"
    assert denied.audit.actor_id == "actor-a"
    assert denied.audit.lineage["rootMessageId"] == "message-a"
    assert calls == []


def test_permissioned_tools_execute_only_after_tenant_actor_grant_and_validate_input():
    executor = PermissionedToolExecutor()
    executor.register(
        PermissionedTool(
            name="catalog.lookup",
            input_schema={"type": "object", "required": ["sku"]},
            permission="catalog:read",
            handler=lambda arguments, _: {"sku": arguments["sku"]},
        )
    )
    executor.grant("catalog.lookup", context())

    allowed = executor.invoke(
        ToolRequest("catalog.lookup", {"sku": "sku-1"}, context())
    )
    cross_tenant = executor.invoke(
        ToolRequest("catalog.lookup", {"sku": "sku-1"}, context(tenant_id="tenant-b"))
    )
    invalid = executor.invoke(ToolRequest("catalog.lookup", {}, context()))

    assert allowed.status is ToolStatus.SUCCEEDED
    assert allowed.output == {"sku": "sku-1"}
    assert allowed.audit.decision == "allowed"
    assert cross_tenant.status is ToolStatus.DENIED
    assert cross_tenant.audit.reason == "deny by default"
    assert invalid.status is ToolStatus.INVALID
    assert invalid.audit.decision == "invalid"
