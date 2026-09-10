"""Workflow runtime entrypoint backed by shared JSON Schemas.

The module is intentionally dependency-light at import time so the scaffold can
run even before LangGraph is installed. Once installed, the same entrypoint can
be upgraded into a real graph executor without changing its contract-loading
behavior.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import os
from pathlib import Path
import signal
from typing import Any

from jsonschema import Draft202012Validator
from worker.core.config import get_settings

try:
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover - graceful scaffold fallback
    END = "__end__"
    StateGraph = None


ROOT_DIR = Path(__file__).resolve().parents[4]
SCHEMAS_DIR = ROOT_DIR / "packages" / "contracts" / "schemas"


def load_contract_schema(schema_name: str) -> dict[str, Any]:
    schema_path = SCHEMAS_DIR / schema_name
    return json.loads(schema_path.read_text(encoding="utf-8"))


WORKFLOW_JOB_SCHEMA = load_contract_schema("workflow-job.schema.json")
WORKFLOW_STATE_SCHEMA = load_contract_schema("workflow-state.schema.json")
ASSET_METADATA_SCHEMA = load_contract_schema("asset-metadata.schema.json")


@dataclass(slots=True)
class ContractBundle:
    workflow_job: dict[str, Any]
    workflow_state: dict[str, Any]
    asset_metadata: dict[str, Any]


CONTRACTS = ContractBundle(
    workflow_job=WORKFLOW_JOB_SCHEMA,
    workflow_state=WORKFLOW_STATE_SCHEMA,
    asset_metadata=ASSET_METADATA_SCHEMA,
)


def validate_payload(payload: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    Draft202012Validator(schema).validate(payload)
    return payload


def build_initial_state(job: dict[str, Any]) -> dict[str, Any]:
    validate_payload(job, CONTRACTS.workflow_job)
    return {
        "contractVersion": "1.0.0",
        "workflowId": job["workflowId"],
        "runId": job["runId"],
        "status": "running",
        "updatedAt": job["createdAt"],
        "currentStep": "validate-input",
        "steps": [
            {
                "name": "validate-input",
                "status": "running",
                "updatedAt": job["createdAt"],
                "message": "Workflow accepted by Python runtime",
            }
        ],
        "input": job["payload"],
        "output": {},
        "trace": job["trace"],
    }


def validate_input_node(state: dict[str, Any]) -> dict[str, Any]:
    payload = state.get("input", {})
    if isinstance(payload, dict) and "assetMetadata" in payload:
        validate_payload(payload["assetMetadata"], CONTRACTS.asset_metadata)

    state["steps"][0]["status"] = "succeeded"
    state["steps"][0]["updatedAt"] = state["updatedAt"]
    state["status"] = "succeeded"
    state["currentStep"] = "complete"
    state["output"] = {
        "accepted": True,
        "validatedSchemas": [
            CONTRACTS.workflow_job["$id"],
            CONTRACTS.workflow_state["$id"],
            CONTRACTS.asset_metadata["$id"],
        ],
    }
    validate_payload(state, CONTRACTS.workflow_state)
    return state


def build_workflow_graph() -> Any:
    if StateGraph is None:
        return None

    graph = StateGraph(dict)
    graph.add_node("validate-input", validate_input_node)
    graph.set_entry_point("validate-input")
    graph.add_edge("validate-input", END)
    return graph.compile()


def example_job_payload() -> dict[str, Any]:
    return {
        "contractVersion": "1.0.0",
        "jobId": "job_ingest_001",
        "workflowId": "wf_media_pipeline",
        "runId": "run_001",
        "kind": "ingest",
        "status": "pending",
        "priority": 50,
        "createdAt": "2026-01-01T00:00:00Z",
        "trace": {
            "traceId": "0123456789abcdef0123456789abcdef",
            "correlationId": "corr-001"
        },
        "payload": {
            "assetId": "asset_001",
            "inputUri": "s3://raw-bucket/video.mp4",
            "assetMetadata": {
                "contractVersion": "1.0.0",
                "assetId": "asset_001",
                "mimeType": "video/mp4",
                "sourceUri": "s3://raw-bucket/video.mp4",
                "checksum": {
                    "algorithm": "sha256",
                    "value": "8f434346648f6b96df89dda901c5176b10a6d83961b4f4b4f2ddf5b9fddb30f9"
                },
                "sizeBytes": 1048576,
                "capturedAt": "2026-01-01T00:00:00Z",
                "ownership": {
                    "tenantId": "tenant_001",
                    "workspaceId": "workspace_001"
                }
            }
        }
    }


def run_once(job: dict[str, Any]) -> dict[str, Any]:
    initial_state = build_initial_state(job)
    graph = build_workflow_graph()
    if graph is None:
        return validate_input_node(initial_state)
    return graph.invoke(initial_state)


def worker_activation_status(environment: dict[str, str] | None = None) -> str:
    values = environment or {}
    if values.get("WORKER_DEPLOYMENT_STATUS", "external-blocked-placeholder") != "active":
        return "external-blocked-placeholder"
    if values.get("WORKER_ENABLE_CONSUMER", "false").lower() != "true":
        return "disabled"
    if not values.get("DATABASE_URL", "").strip():
        return "missing-database-url"
    if not values.get("REDIS_URL", "").strip():
        return "missing-redis-url"
    if not values.get("QUEUE_REF", "").strip():
        return "missing-queue-ref"
    if values.get("WORKER_QUEUE_OWNERSHIP", "external-blocked-placeholder") != "active":
        return "queue-ownership-unverified"
    return "active"


async def run_consumer() -> None:
    """Run the owned queue consumer until the process receives a stop signal."""
    from worker.queue.consumer import WorkflowQueueConsumer

    consumer = WorkflowQueueConsumer()
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for stop_signal in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(stop_signal, stop_event.set)
        except (NotImplementedError, RuntimeError):
            # Windows and embedded interpreters may not support asyncio signal
            # handlers; the platform still owns process termination there.
            pass

    try:
        await consumer.consume_forever(stop_event)
    finally:
        await consumer.close()


def main() -> None:
    status = worker_activation_status(dict(os.environ))
    if status != "active":
        print(json.dumps({"status": status, "providerCalls": 0, "jobsClaimed": 0}))
        return
    if not get_settings().consumer_ready:
        print(json.dumps({"status": "external-blocked", "providerCalls": 0, "jobsClaimed": 0}))
        return
    asyncio.run(run_consumer())


if __name__ == "__main__":
    main()
