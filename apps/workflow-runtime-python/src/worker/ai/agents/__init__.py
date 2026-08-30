"""Tenant-isolated, deterministic LangGraph-style agent execution."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass

from worker.ai.memory import InMemoryMemoryCatalog, MemoryCatalog
from worker.ai.sessions import (
    InMemoryCheckpointCatalog,
    InMemorySessionCatalog,
    SessionCatalogRow,
    SessionStatus,
)
from worker.ai.subgraphs import SubgraphCatalog, SubgraphDefinition
from worker.ai.supervisors import SupervisorCatalog, SupervisorDefinition
from worker.langgraph.registry import LANGGRAPH_AUTHORITY, RuntimeContext

AgentHandler = Callable[[dict[str, object]], dict[str, object]]


@dataclass(frozen=True, slots=True)
class AgentDefinition:
    name: str
    version: str
    authority: str
    handler: AgentHandler | None
    subgraphs: tuple[str, ...] = ()
    supervisor: str | None = None

    def __post_init__(self) -> None:
        if not self.name.strip() or not self.version.strip():
            raise ValueError("Agent name and version are required")
        if self.authority != LANGGRAPH_AUTHORITY:
            raise ValueError("Agents must use the Python LangGraph authority")
        if self.handler is None and not self.subgraphs:
            raise ValueError("An agent needs a handler or at least one subgraph")


@dataclass(frozen=True, slots=True)
class AgentRequest:
    agent: str
    context: RuntimeContext
    input_payload: Mapping[str, object]
    session_id: str | None = None


@dataclass(frozen=True, slots=True)
class AgentRunResult:
    session_id: str
    status: SessionStatus
    state: Mapping[str, object]
    checkpoint_version: int


class AgentCatalog:
    def __init__(self) -> None:
        self._definitions: dict[tuple[str, str], AgentDefinition] = {}

    def register(self, definition: AgentDefinition) -> None:
        key = (definition.name, definition.version)
        if key in self._definitions:
            raise ValueError(f"Agent {definition.name!r} version already registered")
        self._definitions[key] = definition

    def get(self, name: str, version: str | None = None) -> AgentDefinition:
        candidates = [
            definition
            for (registered_name, registered_version), definition in self._definitions.items()
            if registered_name == name and (version is None or registered_version == version)
        ]
        if not candidates:
            raise KeyError(f"Agent {name!r} is not registered")
        return max(candidates, key=lambda definition: definition.version)

    def names(self) -> tuple[str, ...]:
        return tuple(sorted({definition.name for definition in self._definitions.values()}))


class AgentRuntime:
    """One authority for agent, subgraph, supervisor, memory, and session work."""

    authority = LANGGRAPH_AUTHORITY

    def __init__(
        self,
        *,
        memory: MemoryCatalog | None = None,
        sessions: InMemorySessionCatalog | None = None,
        checkpoints: InMemoryCheckpointCatalog | None = None,
    ) -> None:
        self.agents = AgentCatalog()
        self.subgraphs = SubgraphCatalog()
        self.supervisors = SupervisorCatalog()
        self.memory = memory or InMemoryMemoryCatalog()
        self.sessions = sessions or InMemorySessionCatalog()
        self.checkpoints = checkpoints or InMemoryCheckpointCatalog()

    def register_agent(self, definition: AgentDefinition) -> None:
        self.agents.register(definition)

    def register_subgraph(self, definition: SubgraphDefinition) -> None:
        self.subgraphs.register(definition)

    def register_supervisor(self, definition: SupervisorDefinition) -> None:
        self.supervisors.register(definition)

    def run(self, request: AgentRequest) -> AgentRunResult:
        _require_context(request.context)
        agent = self.agents.get(request.agent)
        session_id = request.session_id or _session_id(request.context, agent.name)
        existing = self._try_load_session(request.context, session_id)
        if existing is not None:
            return _result_from_session(existing)

        state: dict[str, object] = {
            "contractVersion": request.context.contract_version,
            "agent": agent.name,
            "agent_version": agent.version,
            "session_id": session_id,
            "thread_id": session_id,
            "context": request.context.as_payload(),
            "input": deepcopy(dict(request.input_payload)),
            "output": {},
            "status": SessionStatus.RUNNING.value,
            "events": [],
            "resume_count": 0,
        }
        return self._execute(request.context, agent, state)

    def resume(self, context: RuntimeContext, session_id: str) -> AgentRunResult:
        _require_context(context)
        session = self.sessions.load(context, session_id)
        if session.status is SessionStatus.COMPLETED:
            return _result_from_session(session)
        checkpoint = self.checkpoints.load(context, session.thread_id)
        state = dict(checkpoint.state)
        state["resume_count"] = int(state.get("resume_count", 0)) + 1
        agent = self.agents.get(session.agent)
        return self._execute(context, agent, state)

    def _execute(
        self,
        context: RuntimeContext,
        agent: AgentDefinition,
        state: dict[str, object],
    ) -> AgentRunResult:
        state["context"] = context.as_payload()
        self.sessions.save(
            context,
            str(state["session_id"]),
            agent.name,
            state,
            status=SessionStatus.RUNNING,
        )
        if agent.handler is not None:
            next_state = agent.handler(deepcopy(state))
        else:
            next_state = self._run_composed_agent(agent, state)
        if not isinstance(next_state, dict):
            raise TypeError("Agent handler must return a state mapping")
        next_state = deepcopy(next_state)
        next_state["session_id"] = state["session_id"]
        next_state["thread_id"] = state["thread_id"]
        next_state["agent"] = agent.name
        next_state["agent_version"] = agent.version
        next_state["context"] = context.as_payload()
        status = SessionStatus(str(next_state.get("status", SessionStatus.COMPLETED.value)))
        checkpoint = None
        if status in {SessionStatus.PAUSED, SessionStatus.COMPLETED}:
            checkpoint = self.checkpoints.save(
                context,
                str(next_state["thread_id"]),
                next_state,
                status=status,
            )
        row = self.sessions.save(
            context,
            str(next_state["session_id"]),
            agent.name,
            next_state,
            status=status,
            checkpoint=checkpoint,
        )
        return _result_from_session(row)

    def _run_composed_agent(
        self,
        agent: AgentDefinition,
        state: dict[str, object],
    ) -> dict[str, object]:
        if agent.supervisor is not None:
            supervisor = self.supervisors.get(agent.supervisor)
            state = deepcopy(supervisor.handler(state))
            selected = state.get("selected_subgraph")
        else:
            selected = agent.subgraphs[0]
        if not isinstance(selected, str) or selected not in agent.subgraphs:
            raise ValueError(
                f"Supervisor selected an unregistered subgraph for agent {agent.name!r}"
            )
        subgraph = self.subgraphs.get(selected)
        return dict(subgraph.handler(state))

    def _try_load_session(
        self,
        context: RuntimeContext,
        session_id: str,
    ) -> SessionCatalogRow | None:
        try:
            return self.sessions.load(context, session_id)
        except KeyError:
            return None


def _session_id(context: RuntimeContext, agent: str) -> str:
    return f"{context.tenant_id}:{agent}:{context.idempotency_key}"


def _result_from_session(row: SessionCatalogRow) -> AgentRunResult:
    return AgentRunResult(
        session_id=row.session_id,
        status=row.status,
        state=deepcopy(dict(row.state)),
        checkpoint_version=row.checkpoint_version,
    )


def _require_context(context: RuntimeContext) -> None:
    if not isinstance(context, RuntimeContext):
        raise TypeError("Runtime context is required")


__all__ = [
    "AgentCatalog",
    "AgentDefinition",
    "AgentHandler",
    "AgentRequest",
    "AgentRunResult",
    "AgentRuntime",
]
