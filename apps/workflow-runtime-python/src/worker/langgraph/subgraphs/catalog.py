"""Composable subgraph definitions; orchestration remains LangGraph-owned."""

from __future__ import annotations

from dataclasses import dataclass

from worker.langgraph.registry.authority import assert_langgraph_authority
from worker.langgraph.registry.types import GraphHandler


@dataclass(frozen=True, slots=True)
class SubgraphDefinition:
    name: str
    version: str
    authority: str
    handler: GraphHandler


class SubgraphCatalog:
    def __init__(self) -> None:
        self._definitions: dict[tuple[str, str], SubgraphDefinition] = {}

    def register(self, definition: SubgraphDefinition) -> None:
        assert_langgraph_authority(definition.authority)
        key = (definition.name, definition.version)
        if key in self._definitions:
            raise ValueError(f"Subgraph {definition.name!r} version already registered")
        self._definitions[key] = definition

    def get(self, name: str, version: str | None = None) -> SubgraphDefinition:
        candidates = [
            definition
            for (registered_name, registered_version), definition in self._definitions.items()
            if registered_name == name and (version is None or registered_version == version)
        ]
        if not candidates:
            raise KeyError(f"Subgraph {name!r} is not registered")
        return max(candidates, key=lambda definition: definition.version)

    def names(self) -> tuple[str, ...]:
        return tuple(sorted({definition.name for definition in self._definitions.values()}))
