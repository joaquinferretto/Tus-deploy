"""Cross-runtime workflow message contracts owned by the Python worker."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Any, Mapping

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover - deterministic validation remains available
    Draft202012Validator = None


CONTRACT_VERSION = "1.0.0"
WORKFLOW_MESSAGE_TYPES = {
    "workflow.request": "workflow-request.v1.schema.json",
    "workflow.progress": "workflow-progress.v1.schema.json",
    "workflow.result": "workflow-result.v1.schema.json",
}
CANONICAL_ISO_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
)


class ContractValidationError(ValueError):
    """Raised when a workflow message violates the canonical contract."""


def validate_workflow_message(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Validate one versioned workflow message without invoking infrastructure."""

    if not isinstance(payload, Mapping):
        raise ContractValidationError("Invalid workflow message: payload must be an object")
    if payload.get("contractVersion") != CONTRACT_VERSION:
        raise ContractValidationError("Invalid workflow message contractVersion")

    message_type = payload.get("messageType")
    if message_type not in WORKFLOW_MESSAGE_TYPES:
        raise ContractValidationError("Invalid workflow message messageType")

    for field in (
        "messageId",
        "workflowId",
        "runId",
        "tenantId",
        "actorId",
        "correlationId",
        "idempotencyKey",
    ):
        _require_non_empty_string(payload, field)

    occurred_at = payload.get("occurredAt")
    if not is_canonical_iso_timestamp(occurred_at):
        raise ContractValidationError("Invalid workflow message occurredAt")

    lineage = payload.get("lineage")
    if not isinstance(lineage, Mapping):
        raise ContractValidationError("Invalid workflow message lineage")
    _require_non_empty_string(lineage, "rootMessageId", field_prefix="lineage")
    _require_non_empty_string(lineage, "source", field_prefix="lineage")
    if "parentMessageId" in lineage:
        _require_non_empty_string(lineage, "parentMessageId", field_prefix="lineage")

    message_payload = payload.get("payload")
    if not isinstance(message_payload, Mapping):
        raise ContractValidationError("Invalid workflow message payload")
    _validate_payload(message_type, message_payload)

    schema_path = _schema_path(WORKFLOW_MESSAGE_TYPES[message_type])
    if Draft202012Validator is not None:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        try:
            Draft202012Validator(schema).validate(dict(payload))
        except Exception as error:
            raise ContractValidationError("Invalid workflow message JSON Schema") from error

    return dict(payload)


def is_canonical_iso_timestamp(value: object) -> bool:
    """Return true only for UTC timestamps normalized to millisecond precision."""

    if not isinstance(value, str) or CANONICAL_ISO_TIMESTAMP.fullmatch(value) is None:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z") == value


def _validate_payload(message_type: str, payload: Mapping[str, Any]) -> None:
    if message_type == "workflow.request":
        if not isinstance(payload.get("input"), Mapping):
            raise ContractValidationError("Invalid workflow request payload.input")
        return

    if message_type == "workflow.progress":
        if payload.get("status") not in {"queued", "running", "paused", "completed", "failed", "cancelled"}:
            raise ContractValidationError("Invalid workflow progress payload.status")
        _require_non_empty_string(payload, "step", field_prefix="payload")
        progress = payload.get("progress")
        if isinstance(progress, bool) or not isinstance(progress, int) or not 0 <= progress <= 100:
            raise ContractValidationError("Invalid workflow progress payload.progress")
        return

    if payload.get("status") not in {"succeeded", "failed", "cancelled"}:
        raise ContractValidationError("Invalid workflow result payload.status")
    if "output" in payload and not isinstance(payload["output"], Mapping):
        raise ContractValidationError("Invalid workflow result payload.output")
    if "error" in payload:
        error = payload["error"]
        if not isinstance(error, Mapping):
            raise ContractValidationError("Invalid workflow result payload.error")
        _require_non_empty_string(error, "code", field_prefix="payload.error")
        _require_non_empty_string(error, "message", field_prefix="payload.error")


def _require_non_empty_string(
    value: Mapping[str, Any], field: str, *, field_prefix: str = "workflow message"
) -> None:
    field_value = value.get(field)
    if not isinstance(field_value, str) or not field_value.strip():
        raise ContractValidationError(f"Invalid {field_prefix} {field}")


def _schema_path(schema_name: str) -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "packages" / "contracts" / "schemas" / "workflows" / schema_name
        if candidate.is_file():
            return candidate
    raise ContractValidationError("Workflow schema root is unavailable")
