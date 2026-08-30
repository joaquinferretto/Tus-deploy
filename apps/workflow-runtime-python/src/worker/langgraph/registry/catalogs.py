"""Small deterministic catalogs owned by the LangGraph runtime registry."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy

from .adapters import UnavailableAdapter
from .authority import assert_langgraph_authority
from .types import CapabilityAdapter, GraphDefinition, RuntimeContext, ToolDefinition


class GraphCatalog:
    def __init__(self) -> None:
        self._definitions: dict[tuple[str, str], GraphDefinition] = {}

    def register(self, definition: GraphDefinition) -> None:
        assert_langgraph_authority(definition.authority)
        key = (definition.graph_id, definition.version)
        if key in self._definitions:
            raise ValueError(f"Graph {definition.graph_id!r} version already registered")
        self._definitions[key] = definition

    def get(self, graph_id: str, version: str | None = None) -> GraphDefinition:
        candidates = [
            definition
            for (registered_id, registered_version), definition in self._definitions.items()
            if registered_id == graph_id and (version is None or registered_version == version)
        ]
        if not candidates:
            raise KeyError(f"Graph {graph_id!r} is not registered")
        return max(candidates, key=lambda definition: definition.version)

    def names(self) -> tuple[str, ...]:
        return tuple(sorted({definition.graph_id for definition in self._definitions.values()}))


class TenantScopedStore:
    def __init__(self, label: str) -> None:
        self._label = label
        self._records: dict[tuple[str, str], dict[str, object]] = {}

    def save(self, context: RuntimeContext, key: str, value: Mapping[str, object]) -> None:
        self._records[(context.tenant_id, key)] = deepcopy(dict(value))

    def load(self, context: RuntimeContext, key: str) -> dict[str, object]:
        record = self._records.get((context.tenant_id, key))
        if record is None:
            raise KeyError(f"No tenant-scoped {self._label} record for {key!r}")
        return deepcopy(record)


class ToolCatalog:
    def __init__(self) -> None:
        self._definitions: dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition) -> None:
        assert_langgraph_authority(definition.authority)
        if definition.name in self._definitions:
            raise ValueError(f"Tool {definition.name!r} already registered")
        self._definitions[definition.name] = definition

    def invoke(
        self,
        name: str,
        context: RuntimeContext,
        request: Mapping[str, object],
    ) -> dict[str, object]:
        try:
            definition = self._definitions[name]
        except KeyError as error:
            raise KeyError(f"Tool {name!r} is not registered") from error
        return dict(definition.handler(context, request))


class CapabilityCatalog:
    def __init__(self, label: str) -> None:
        self._label = label
        self._adapters: dict[str, CapabilityAdapter] = {}

    def register(self, name: str, adapter: CapabilityAdapter) -> None:
        if name in self._adapters:
            raise ValueError(f"{self._label} adapter {name!r} already registered")
        self._adapters[name] = adapter

    def invoke(
        self,
        context: RuntimeContext,
        request: Mapping[str, object],
        *,
        adapter: str = "default",
    ) -> dict[str, object]:
        try:
            selected = self._adapters[adapter]
        except KeyError as error:
            raise KeyError(f"{self._label} adapter {adapter!r} is not registered") from error
        return dict(selected.invoke(context, request))

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._adapters))

    def retrieve(
        self,
        context: RuntimeContext,
        query: str,
        *,
        adapter: str = "default",
    ) -> dict[str, object]:
        """RAG-shaped entrypoint kept behind the central LangGraph catalog."""

        return self.invoke(context, {"query": query}, adapter=adapter)

    def evaluate(
        self,
        context: RuntimeContext,
        result: Mapping[str, object],
        *,
        adapter: str = "default",
    ) -> dict[str, object]:
        """Evaluation-shaped entrypoint kept behind the central LangGraph catalog."""

        return self.invoke(context, result, adapter=adapter)


def unavailable_capability(label: str, reason: str) -> UnavailableAdapter:
    return UnavailableAdapter(capability=label, reason=reason)
