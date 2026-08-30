import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.ai.agents import AgentDefinition, AgentRequest, AgentRuntime
from worker.ai.memory import InMemoryMemoryCatalog
from worker.ai.sessions import SessionStatus
from worker.ai.subgraphs import SubgraphDefinition
from worker.ai.supervisors import SupervisorDefinition
from worker.langgraph.registry import LANGGRAPH_AUTHORITY, RuntimeContext


def context(
    *,
    tenant_id: str = "tenant-a",
    actor_id: str = "actor-a",
    idempotency_key: str = "idem-a",
) -> RuntimeContext:
    return RuntimeContext(
        tenant_id=tenant_id,
        actor_id=actor_id,
        correlation_id="corr-a",
        idempotency_key=idempotency_key,
        lineage={"rootMessageId": "message-a", "source": "p4.2-test"},
    )


def complete_agent(state: dict[str, object]) -> dict[str, object]:
    state["output"] = {"answer": state["input"]["value"]}
    state["status"] = SessionStatus.COMPLETED.value
    return state


def pause_once_agent(state: dict[str, object]) -> dict[str, object]:
    if state.get("resume_count", 0) == 0:
        state["resume_count"] = 1
        state["status"] = SessionStatus.PAUSED.value
        state["checkpoint_reason"] = "approval"
        return state
    state["output"] = {"answer": state["input"]["value"], "resumed": True}
    state["status"] = SessionStatus.COMPLETED.value
    return state


def tampering_agent(state: dict[str, object]) -> dict[str, object]:
    state["session_id"] = "tenant-b:stolen"
    state["thread_id"] = "tenant-b:stolen"
    state["context"] = context(tenant_id="tenant-b").as_payload()
    state["status"] = SessionStatus.COMPLETED.value
    state["output"] = {"safe": True}
    return state


def test_agent_subgraph_and_supervisor_are_langgraph_owned_and_tenant_scoped():
    runtime = AgentRuntime()
    runtime.register_subgraph(
        SubgraphDefinition(
            name="answer",
            version="1",
            authority=LANGGRAPH_AUTHORITY,
            handler=complete_agent,
        )
    )
    runtime.register_supervisor(
        SupervisorDefinition(
            name="router",
            version="1",
            authority=LANGGRAPH_AUTHORITY,
            handler=lambda state: {**state, "selected_subgraph": "answer"},
        )
    )
    runtime.register_agent(
        AgentDefinition(
            name="assistant",
            version="1",
            authority=LANGGRAPH_AUTHORITY,
            handler=None,
            subgraphs=("answer",),
            supervisor="router",
        )
    )

    result = runtime.run(
        AgentRequest(
            agent="assistant",
            context=context(),
            input_payload={"value": "hello"},
        )
    )

    assert result.status is SessionStatus.COMPLETED
    assert result.state["output"] == {"answer": "hello"}
    assert result.state["context"]["tenantId"] == "tenant-a"
    with pytest.raises(KeyError, match="tenant"):
        runtime.sessions.load(context(tenant_id="tenant-b"), result.session_id)


def test_agent_resume_uses_latest_checkpoint_and_is_idempotent_per_session():
    runtime = AgentRuntime()
    runtime.register_agent(
        AgentDefinition(
            name="pausable",
            version="1",
            authority=LANGGRAPH_AUTHORITY,
            handler=pause_once_agent,
        )
    )
    runtime_context = context(idempotency_key="resume-1")

    paused = runtime.run(
        AgentRequest("pausable", runtime_context, {"value": "continue"})
    )
    resumed = runtime.resume(runtime_context, paused.session_id)
    repeated = runtime.resume(runtime_context, paused.session_id)

    assert paused.status is SessionStatus.PAUSED
    assert paused.checkpoint_version == 1
    assert resumed.status is SessionStatus.COMPLETED
    assert resumed.checkpoint_version == 2
    assert resumed.state["output"] == {"answer": "continue", "resumed": True}
    assert repeated == resumed


def test_same_tenant_different_actor_cannot_read_or_resume_agent_session():
    runtime = AgentRuntime()
    runtime.register_agent(
        AgentDefinition(
            name="pausable",
            version="1",
            authority=LANGGRAPH_AUTHORITY,
            handler=pause_once_agent,
        )
    )
    owner = context(actor_id="owner", idempotency_key="actor-scope")
    paused = runtime.run(AgentRequest("pausable", owner, {"value": "private"}))

    with pytest.raises(KeyError, match="actor"):
        runtime.resume(
            context(actor_id="intruder", idempotency_key="actor-scope"),
            paused.session_id,
        )


def test_memory_catalog_rows_are_deep_copied_and_isolated_by_tenant_and_actor():
    memory = InMemoryMemoryCatalog()
    owner = context()
    value = {"facts": ["one"]}

    row = memory.save(owner, "profile", value, session_id="session-a")
    value["facts"].append("mutated")
    loaded = memory.load(owner, "profile", session_id="session-a")

    assert row.tenant_id == "tenant-a"
    assert row.actor_id == "actor-a"
    assert loaded.value == {"facts": ["one"]}
    with pytest.raises(KeyError, match="tenant"):
        memory.load(context(tenant_id="tenant-b"), "profile", session_id="session-a")
    with pytest.raises(KeyError, match="actor"):
        memory.load(context(actor_id="actor-b"), "profile", session_id="session-a")


def test_completed_session_resume_is_idempotent_and_cross_tenant_session_is_not_disclosed():
    runtime = AgentRuntime()
    runtime.register_agent(
        AgentDefinition(
            name="complete",
            version="1",
            authority=LANGGRAPH_AUTHORITY,
            handler=complete_agent,
        )
    )
    owner = context(idempotency_key="complete-1")
    completed = runtime.run(AgentRequest("complete", owner, {"value": "done"}))

    assert runtime.resume(owner, completed.session_id) == completed
    with pytest.raises(KeyError, match="tenant"):
        runtime.sessions.load(context(tenant_id="tenant-b"), completed.session_id)


def test_agent_catalog_rejects_competing_authority_and_supervisor_cannot_escape_declared_subgraphs():
    runtime = AgentRuntime()
    with pytest.raises(ValueError, match="LangGraph authority"):
        runtime.register_agent(
            AgentDefinition("forbidden", "1", "bedrock-agents", complete_agent)
        )

    runtime.register_supervisor(
        SupervisorDefinition(
            "router",
            "1",
            LANGGRAPH_AUTHORITY,
            lambda state: {**state, "selected_subgraph": "not-declared"},
        )
    )
    runtime.register_agent(
        AgentDefinition(
            "guarded",
            "1",
            LANGGRAPH_AUTHORITY,
            None,
            subgraphs=("declared",),
            supervisor="router",
        )
    )
    with pytest.raises(ValueError, match="unregistered subgraph"):
        runtime.run(AgentRequest("guarded", context(), {"value": "blocked"}))


def test_memory_catalog_updates_versions_without_leaking_between_sessions():
    memory = InMemoryMemoryCatalog()
    owner = context()

    first = memory.save(owner, "summary", {"text": "one"}, session_id="session-a")
    second = memory.save(owner, "summary", {"text": "two"}, session_id="session-a")
    other_session = memory.save(
        owner, "summary", {"text": "other"}, session_id="session-b"
    )

    assert first.version == 1
    assert second.version == 2
    assert memory.load(owner, "summary", session_id="session-a").value == {
        "text": "two"
    }
    assert other_session.version == 1
    assert memory.list(owner, session_id="session-a")[0].value == {"text": "two"}


def test_resume_keeps_original_tenant_context_even_if_checkpoint_state_is_tampered():
    runtime = AgentRuntime()
    runtime.register_agent(
        AgentDefinition("pausable", "1", LANGGRAPH_AUTHORITY, pause_once_agent)
    )
    owner = context(idempotency_key="tamper")
    paused = runtime.run(AgentRequest("pausable", owner, {"value": "safe"}))
    checkpoint = runtime.checkpoints.load(owner, paused.session_id)
    tampered = dict(checkpoint.state)
    tampered["context"] = context(tenant_id="tenant-b").as_payload()
    runtime.checkpoints.save(
        owner,
        paused.session_id,
        tampered,
        status=checkpoint.status,
    )

    resumed = runtime.resume(owner, paused.session_id)

    assert resumed.state["context"]["tenantId"] == "tenant-a"


def test_agent_cannot_persist_handler_modified_session_identity():
    runtime = AgentRuntime()
    runtime.register_agent(
        AgentDefinition("guarded", "1", LANGGRAPH_AUTHORITY, tampering_agent)
    )
    owner = context(idempotency_key="identity")

    result = runtime.run(AgentRequest("guarded", owner, {"value": "safe"}))

    assert result.session_id == "tenant-a:guarded:identity"
    assert (
        runtime.sessions.load(owner, result.session_id).state["context"]["tenantId"]
        == "tenant-a"
    )
    with pytest.raises(KeyError, match="tenant"):
        runtime.sessions.load(context(tenant_id="tenant-b"), "tenant-b:stolen")
