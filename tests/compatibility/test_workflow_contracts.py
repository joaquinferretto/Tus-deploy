import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "workflow-runtime-python" / "src"))

from worker.contracts import ContractValidationError, validate_workflow_message


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "packages" / "contracts" / "fixtures" / "workflows"


def workflow_fixtures() -> list[dict[str, object]]:
    return [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(FIXTURES.glob("*.json"))
    ]


def test_python_accepts_all_checked_in_workflow_fixtures():
    fixtures = workflow_fixtures()

    assert [fixture["messageType"] for fixture in fixtures] == [
        "workflow.progress",
        "workflow.request",
        "workflow.result",
    ]
    assert [validate_workflow_message(fixture)["contractVersion"] for fixture in fixtures] == [
        "1.0.0",
        "1.0.0",
        "1.0.0",
    ]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tenantId", ""),
        ("actorId", ""),
        ("correlationId", ""),
        ("idempotencyKey", ""),
        ("contractVersion", "2.0.0"),
        ("occurredAt", "2026-01-01T00:00:00Z"),
    ],
)
def test_python_rejects_metadata_drift(field: str, value: str):
    candidate = dict(workflow_fixtures()[0])
    candidate[field] = value

    with pytest.raises(ContractValidationError, match="workflow"):
        validate_workflow_message(candidate)


def test_python_rejects_lineage_without_root_or_source():
    candidate = dict(workflow_fixtures()[0])
    candidate["lineage"] = {"parentMessageId": "parent-1"}

    with pytest.raises(ContractValidationError, match="lineage"):
        validate_workflow_message(candidate)
