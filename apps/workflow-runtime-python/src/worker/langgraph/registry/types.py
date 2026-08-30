"""Dependency-light types shared by local LangGraph registries."""

from __future__ import annotations

from collections.abc import Callable, Mapping, MutableMapping
from dataclasses import dataclass
from typing import Protocol

from .authority import LANGGRAPH_AUTHORITY

CONTRACT_VERSION = "1.0.0"
GraphState = MutableMapping[str, object]
GraphHandler = Callable[[GraphState], GraphState]
ToolHandler = Callable[["RuntimeContext", Mapping[str, object]], Mapping[str, object]]


@dataclass(frozen=True, slots=True)
class RuntimeContext:
    """P3.1 identity and lineage context carried through every local graph call."""

    tenant_id: str
    actor_id: str
    correlation_id: str
    idempotency_key: str
    lineage: Mapping[str, str]
    contract_version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        for field_name in (
            "tenant_id",
            "actor_id",
            "correlation_id",
            "idempotency_key",
        ):
            if not getattr(self, field_name).strip():
                raise ValueError(f"Runtime context {field_name} is required")
        if self.contract_version != CONTRACT_VERSION:
            raise ValueError("Runtime context contract version is unsupported")
        for field_name in ("rootMessageId", "source"):
            if not self.lineage.get(field_name, "").strip():
                raise ValueError(f"Runtime context lineage {field_name} is required")

    def as_payload(self) -> dict[str, object]:
        return {
            "contractVersion": self.contract_version,
            "tenantId": self.tenant_id,
            "actorId": self.actor_id,
            "correlationId": self.correlation_id,
            "idempotencyKey": self.idempotency_key,
            "lineage": dict(self.lineage),
        }


@dataclass(frozen=True, slots=True)
class GraphDefinition:
    graph_id: str
    version: str
    authority: str
    handler: GraphHandler

    def __post_init__(self) -> None:
        if self.authority == LANGGRAPH_AUTHORITY:
            return
        if not self.authority.strip():
            raise ValueError("Graph authority is required")


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    name: str
    authority: str
    handler: ToolHandler


class CapabilityAdapter(Protocol):
    def invoke(
        self,
        context: RuntimeContext,
        request: Mapping[str, object],
    ) -> Mapping[str, object]: ...
