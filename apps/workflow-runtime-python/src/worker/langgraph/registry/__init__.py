"""Central, provider-free LangGraph runtime registry."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy

from worker.langgraph.subgraphs import SubgraphCatalog, SubgraphDefinition
from worker.langgraph.supervisors import SupervisorCatalog, SupervisorDefinition

from .adapters import UnavailableAdapter, UnavailableCapabilityError
from .authority import (
    DENIED_COMPETING_AUTHORITIES,
    LANGGRAPH_AUTHORITY,
    AuthorityViolation,
    assert_langgraph_authority,
)
from .catalogs import CapabilityCatalog, GraphCatalog, TenantScopedStore, ToolCatalog
from .types import CONTRACT_VERSION, GraphDefinition, RuntimeContext, ToolDefinition


class LangGraphRuntimeRegistry:
    """Own all workflow orchestration registrations behind one authority."""

    authority = LANGGRAPH_AUTHORITY
    domains = (
        "graphs",
        "state",
        "sessions",
        "tools",
        "rag",
        "evaluations",
    )

    def __init__(self) -> None:
        self.graphs = GraphCatalog()
        self.subgraphs = SubgraphCatalog()
        self.supervisors = SupervisorCatalog()
        self.state = TenantScopedStore("state")
        self.sessions = TenantScopedStore("session")
        self.tools = ToolCatalog()
        self.rag = CapabilityCatalog("RAG")
        self.evaluations = CapabilityCatalog("evaluation")

    def assert_authority(self, authority: str) -> None:
        assert_langgraph_authority(authority)

    def register_graph(
        self,
        *,
        graph_id: str,
        version: str,
        authority: str,
        handler,
    ) -> None:
        self.graphs.register(GraphDefinition(graph_id, version, authority, handler))

    def register_subgraph(self, definition: SubgraphDefinition) -> None:
        self.subgraphs.register(definition)

    def register_supervisor(self, definition: SupervisorDefinition) -> None:
        self.supervisors.register(definition)

    def register_tool(self, definition: ToolDefinition) -> None:
        self.tools.register(definition)

    def new_state(
        self,
        context: RuntimeContext,
        *,
        graph_id: str,
        input_payload: Mapping[str, object],
        version: str | None = None,
    ) -> dict[str, object]:
        graph = self.graphs.get(graph_id, version)
        thread_id = f"{context.tenant_id}:{graph.graph_id}:{context.idempotency_key}"
        return {
            "contractVersion": context.contract_version,
            "graph_id": graph.graph_id,
            "graph_version": graph.version,
            "thread_id": thread_id,
            "session_id": thread_id,
            "context": context.as_payload(),
            "input": deepcopy(dict(input_payload)),
            "output": {},
            "status": "queued",
            "events": [],
        }

    def invoke(self, graph_id: str, state: Mapping[str, object]) -> dict[str, object]:
        mutable_state = deepcopy(dict(state))
        graph = self.graphs.get(graph_id, str(mutable_state.get("graph_version", "")) or None)
        context_payload = mutable_state.get("context")
        if not isinstance(context_payload, Mapping):
            raise TypeError("LangGraph state context is required")
        mutable_state["status"] = "running"
        tenant_id = str(context_payload.get("tenantId", ""))
        idempotency_key = str(context_payload.get("idempotencyKey", ""))
        runtime_context = RuntimeContext(
            tenant_id=tenant_id,
            actor_id=str(context_payload.get("actorId", "")),
            correlation_id=str(context_payload.get("correlationId", "")),
            idempotency_key=idempotency_key,
            lineage=dict(context_payload.get("lineage", {})),
            contract_version=str(context_payload.get("contractVersion", "")),
        )
        self.state.save(runtime_context, str(mutable_state["thread_id"]), mutable_state)
        result = dict(graph.handler(mutable_state))
        result["context"] = runtime_context.as_payload()
        result["contractVersion"] = CONTRACT_VERSION
        self.state.save(runtime_context, str(result["thread_id"]), result)
        self.sessions.save(runtime_context, str(result["session_id"]), result)
        return deepcopy(result)

    def invoke_tool(
        self,
        name: str,
        context: RuntimeContext,
        request: Mapping[str, object],
    ) -> dict[str, object]:
        return self.tools.invoke(name, context, request)


def create_local_registry() -> LangGraphRuntimeRegistry:
    """Build deterministic local catalogs without importing LangGraph or providers."""

    from worker.langgraph.graphs import echo_graph

    registry = LangGraphRuntimeRegistry()
    registry.register_graph(
        graph_id="deterministic.echo.v1",
        version="1",
        authority=LANGGRAPH_AUTHORITY,
        handler=echo_graph,
    )
    registry.register_subgraph(
        SubgraphDefinition(
            name="deterministic.echo",
            version="1",
            authority=LANGGRAPH_AUTHORITY,
            handler=echo_graph,
        )
    )
    registry.register_supervisor(
        SupervisorDefinition(
            name="deterministic.supervisor",
            version="1",
            authority=LANGGRAPH_AUTHORITY,
            handler=echo_graph,
        )
    )
    registry.register_tool(
        ToolDefinition(
            name="deterministic.echo",
            authority=LANGGRAPH_AUTHORITY,
            handler=lambda context, request: {"value": request.get("value")},
        )
    )
    registry.rag.register(
        "default",
        UnavailableAdapter("RAG", "local deterministic retrieval adapter is not enabled"),
    )
    registry.evaluations.register(
        "default",
        UnavailableAdapter(
            "evaluation",
            "local deterministic evaluation adapter is not enabled",
        ),
    )
    return registry


__all__ = [
    "CONTRACT_VERSION",
    "DENIED_COMPETING_AUTHORITIES",
    "LANGGRAPH_AUTHORITY",
    "AuthorityViolation",
    "LangGraphRuntimeRegistry",
    "RuntimeContext",
    "UnavailableAdapter",
    "UnavailableCapabilityError",
    "create_local_registry",
]
