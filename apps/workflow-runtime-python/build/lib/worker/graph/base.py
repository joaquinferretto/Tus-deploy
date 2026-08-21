from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, TypedDict

from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode

from worker.core.config import get_settings
from worker.core.telemetry import traced_operation
from worker.memory.checkpointer import build_checkpointer


class WorkflowState(TypedDict, total=False):
    job: dict[str, Any]
    messages: list[dict[str, str]]
    current_step: str
    output: dict[str, Any]
    error: dict[str, Any]
    updated_at: str


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def summarize_asset(job: dict[str, Any]) -> str:
    payload = job.get("payload", {})
    return f"Asset {payload.get('assetId', 'unknown')} queued for {job.get('kind', 'unknown')}"


def llm_node(state: WorkflowState) -> WorkflowState:
    settings = get_settings()
    settings.require_llm_credentials()
    model = ChatOpenAI(model=settings.chat_model, api_key=settings.openai_api_key)
    prompt = summarize_asset(state["job"])
    response = model.invoke(prompt)
    state["messages"] = [{"role": "assistant", "content": response.content}]
    state["current_step"] = "tooling"
    state["updated_at"] = utc_now()
    return state


def finalize_node(state: WorkflowState) -> WorkflowState:
    state["output"] = {"accepted": True, "summary": state.get("messages", [{}])[-1].get("content", "")}
    state["current_step"] = "complete"
    state["updated_at"] = utc_now()
    return state


async def build_graph() -> Any:
    graph = StateGraph(WorkflowState)
    graph.add_node("plan", llm_node)
    graph.add_node("tooling", ToolNode(tools=[summarize_asset]))
    graph.add_node("finalize", finalize_node)
    graph.set_entry_point("plan")
    graph.add_edge("plan", "tooling")
    graph.add_edge("tooling", "finalize")
    graph.add_edge("finalize", END)

    checkpointer = await build_checkpointer()
    with traced_operation("workflow-graph.compile", {"service": get_settings().service_name}):
        return graph.compile(checkpointer=checkpointer, debug=False, name="workflow-runtime", store=None)
