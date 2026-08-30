import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.langgraph.graphs import echo_graph
from worker.langgraph.registry import (
    LANGGRAPH_AUTHORITY,
    AuthorityViolation,
    RuntimeContext,
    UnavailableCapabilityError,
    create_local_registry,
)
from worker.langgraph.subgraphs import SubgraphDefinition
from worker.langgraph.supervisors import SupervisorDefinition


def context(*, tenant_id: str = "tenant-a") -> RuntimeContext:
    return RuntimeContext(
        tenant_id=tenant_id,
        actor_id="actor-1",
        correlation_id="corr-1",
        idempotency_key="idem-1",
        lineage={"rootMessageId": "message-1", "source": "compatibility-test"},
    )


def test_local_registry_owns_graph_state_session_tool_rag_and_evaluation_orchestration():
    registry = create_local_registry()
    runtime_context = context()
    initial_state = registry.new_state(
        runtime_context,
        graph_id="deterministic.echo.v1",
        input_payload={"value": "hello"},
    )

    result = registry.invoke("deterministic.echo.v1", initial_state)

    assert registry.authority == "python-langgraph"
    assert registry.domains == (
        "graphs",
        "state",
        "sessions",
        "tools",
        "rag",
        "evaluations",
    )
    assert result["output"] == {"value": "hello"}
    assert result["context"]["tenantId"] == "tenant-a"
    assert registry.sessions.load(runtime_context, result["thread_id"]) == result


def test_registry_preserves_p31_context_and_isolates_state_by_tenant():
    registry = create_local_registry()
    tenant_a = context(tenant_id="tenant-a")
    tenant_b = context(tenant_id="tenant-b")
    state = registry.new_state(tenant_a, graph_id="deterministic.echo.v1", input_payload={"value": 1})

    registry.sessions.save(tenant_a, state["thread_id"], state)

    assert registry.sessions.load(tenant_a, state["thread_id"])["context"] == state["context"]
    with pytest.raises(KeyError, match="tenant"):
        registry.sessions.load(tenant_b, state["thread_id"])


@pytest.mark.parametrize("authority", ["typescript", "bedrock-agents", "bedrock-flows"])
def test_competing_orchestration_authorities_are_denied(authority: str):
    registry = create_local_registry()

    with pytest.raises(AuthorityViolation, match="LangGraph"):
        registry.assert_authority(authority)


def test_registered_graph_cannot_select_a_competing_authority():
    registry = create_local_registry()

    with pytest.raises(AuthorityViolation, match="bedrock-agents"):
        registry.register_graph(
            graph_id="forbidden",
            version="1",
            authority="bedrock-agents",
            handler=lambda state: state,
        )


def test_subgraphs_and_supervisors_cannot_register_a_competing_authority():
    registry = create_local_registry()

    with pytest.raises(AuthorityViolation, match="LangGraph"):
        registry.register_subgraph(
            SubgraphDefinition("forbidden", "1", "bedrock-flows", echo_graph)
        )
    with pytest.raises(AuthorityViolation, match="LangGraph"):
        registry.register_supervisor(
            SupervisorDefinition("forbidden", "1", "typescript", echo_graph)
        )


def test_registry_selects_a_newer_graph_version_without_changing_authority():
    registry = create_local_registry()
    registry.register_graph(
        graph_id="deterministic.echo.v1",
        version="2",
        authority=LANGGRAPH_AUTHORITY,
        handler=echo_graph,
    )

    state = registry.new_state(
        context(), graph_id="deterministic.echo.v1", input_payload={"value": "new"}
    )

    assert state["graph_version"] == "2"
    assert registry.invoke("deterministic.echo.v1", state)["output"] == {"value": "new"}


@pytest.mark.parametrize(
    ("field", "value"),
    [("tenant_id", ""), ("actor_id", ""), ("correlation_id", ""), ("idempotency_key", "")],
)
def test_runtime_context_rejects_missing_p31_identity(field: str, value: str):
    values = {
        "tenant_id": "tenant-a",
        "actor_id": "actor-1",
        "correlation_id": "corr-1",
        "idempotency_key": "idem-1",
        "lineage": {"rootMessageId": "message-1", "source": "test"},
    }
    values[field] = value

    with pytest.raises(ValueError, match="Runtime context"):
        RuntimeContext(**values)


def test_unavailable_rag_and_evaluation_adapters_are_explicit_and_provider_free():
    registry = create_local_registry()
    runtime_context = context()

    with pytest.raises(UnavailableCapabilityError, match="RAG"):
        registry.rag.retrieve(runtime_context, "hello")
    with pytest.raises(UnavailableCapabilityError, match="evaluation"):
        registry.evaluations.evaluate(runtime_context, {"answer": "hello"})


def test_deterministic_tool_execution_stays_inside_the_langgraph_registry():
    registry = create_local_registry()

    result = registry.invoke_tool(
        "deterministic.echo",
        context(),
        {"value": "tool-value"},
    )

    assert result == {"value": "tool-value"}
