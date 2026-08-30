"""Deterministic graph handlers for local contract and registry tests."""

from __future__ import annotations

from copy import deepcopy

from worker.langgraph.registry.types import GraphState


def echo_graph(state: GraphState) -> GraphState:
    """Return the input as output without providers, persistence, or side effects."""

    state["current_step"] = "complete"
    state["status"] = "completed"
    state["output"] = deepcopy(state.get("input", {}))
    return state
