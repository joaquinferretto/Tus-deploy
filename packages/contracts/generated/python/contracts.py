"""Checked-in Python bindings for the canonical cross-runtime contracts."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover - dependency is supplied by the worker runtime
    Draft202012Validator = None

CONTRACT_VERSION = "1.0.0"


class ContractValidationError(ValueError):
    """Raised when ingress or egress violates the canonical contract."""


@dataclass(frozen=True, slots=True)
class TraceContext:
    traceId: str
    correlationId: str
    spanId: str | None = None
    causationId: str | None = None


def validate_workflow_job(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("contractVersion") != CONTRACT_VERSION:
        raise ContractValidationError("Invalid workflow-job contract version")
    required = ("jobId", "workflowId", "runId", "kind", "status", "priority", "createdAt", "trace", "payload")
    missing = [field for field in required if not payload.get(field)]
    if missing:
        raise ContractValidationError(f"Missing workflow-job fields: {', '.join(missing)}")
    if payload["trace"].get("correlationId") is None:
        raise ContractValidationError("Missing workflow-job correlationId")
    if Draft202012Validator is not None:
        schema_path = Path(__file__).resolve().parents[2] / "schemas" / "workflow-job.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        try:
            Draft202012Validator(schema).validate(payload)
        except Exception as error:
            raise ContractValidationError("Workflow job does not satisfy JSON Schema") from error
    return payload


def validate_durable_job(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate the canonical P2.10 durable-job producer/consumer contract."""
    return _validate_schema(payload, "jobs/durable-job.v1.schema.json")


def validate_run_event(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate the canonical P2.10 run-event producer/consumer contract."""
    return _validate_schema(payload, "jobs/run-event.v1.schema.json")


def _validate_schema(payload: dict[str, Any], schema_name: str) -> dict[str, Any]:
    if payload.get("contractVersion") != CONTRACT_VERSION:
        raise ContractValidationError(f"Invalid {schema_name} contract version")
    if Draft202012Validator is not None:
        schema_path = Path(__file__).resolve().parents[2] / "schemas" / schema_name
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        try:
            Draft202012Validator(schema).validate(payload)
        except Exception as error:
            raise ContractValidationError(f"Payload does not satisfy {schema_name}") from error
    return payload
