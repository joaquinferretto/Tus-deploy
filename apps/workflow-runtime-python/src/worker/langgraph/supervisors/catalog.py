"""Bounded supervisor definitions owned by the LangGraph runtime."""

from __future__ import annotations

from dataclasses import dataclass

from worker.langgraph.registry.authority import assert_langgraph_authority
from worker.langgraph.registry.types import GraphHandler


@dataclass(frozen=True, slots=True)
class SupervisorDefinition:
    name: str
    version: str
    authority: str
    handler: GraphHandler


class SupervisorCatalog:
    def __init__(self) -> None:
        self._definitions: dict[tuple[str, str], SupervisorDefinition] = {}

    def register(self, definition: SupervisorDefinition) -> None:
        assert_langgraph_authority(definition.authority)
        key = (definition.name, definition.version)
        if key in self._definitions:
            raise ValueError(f"Supervisor {definition.name!r} version already registered")
        self._definitions[key] = definition

    def get(self, name: str, version: str | None = None) -> SupervisorDefinition:
        candidates = [
            definition
            for (registered_name, registered_version), definition in self._definitions.items()
            if registered_name == name and (version is None or registered_version == version)
        ]
        if not candidates:
            raise KeyError(f"Supervisor {name!r} is not registered")
        return max(candidates, key=lambda definition: definition.version)

    def names(self) -> tuple[str, ...]:
        return tuple(sorted({definition.name for definition in self._definitions.values()}))
