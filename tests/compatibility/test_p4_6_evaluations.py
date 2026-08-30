import sys
from dataclasses import replace
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.ai.evaluations import (
    AI_CAPABILITIES,
    DEFAULT_EVALUATION_ROWS,
    EvaluationCatalog,
    EvaluationCatalogValidationError,
)
from worker.ai.regression import (
    DEFAULT_REGRESSION_FIXTURES,
    DeterministicRegressionEvaluator,
    RegressionFixture,
)

EXPECTED_CAPABILITIES = {
    "llm-chat",
    "structured-output",
    "tools",
    "agents",
    "memory",
    "registry",
    "routing",
    "cost",
    "guardrails",
    "streaming",
    "rag",
}


def test_default_catalog_has_one_independent_row_per_ai_capability():
    catalog = EvaluationCatalog(DEFAULT_EVALUATION_ROWS)

    assert set(AI_CAPABILITIES) == EXPECTED_CAPABILITIES
    assert catalog.capabilities == tuple(sorted(EXPECTED_CAPABILITIES))
    assert len(catalog.rows) == len(EXPECTED_CAPABILITIES)
    assert catalog.validate() == ()


def test_catalog_requires_contract_owner_fake_and_evaluation_evidence():
    incomplete = replace(
        DEFAULT_EVALUATION_ROWS[0],
        contract="",
        owner="",
        fake="",
        evaluation="",
    )
    catalog = EvaluationCatalog((incomplete, *DEFAULT_EVALUATION_ROWS[1:]))

    issues = catalog.validate()

    assert {(issue.row_id, issue.field) for issue in issues} >= {
        ("llm-chat", "contract"),
        ("llm-chat", "owner"),
        ("llm-chat", "fake"),
        ("llm-chat", "evaluation"),
    }
    with pytest.raises(EvaluationCatalogValidationError):
        catalog.assert_valid()


def test_catalog_requires_every_traceability_field_and_non_empty_evidence():
    incomplete = replace(
        DEFAULT_EVALUATION_ROWS[0],
        fixture="",
        neutral_use_case="",
        policy="",
        availability="",
        rollback_ref="",
        evidence=(),
    )

    issues = EvaluationCatalog((incomplete, *DEFAULT_EVALUATION_ROWS[1:])).validate()

    assert {(issue.row_id, issue.field) for issue in issues} >= {
        ("llm-chat", "fixture"),
        ("llm-chat", "neutral_use_case"),
        ("llm-chat", "policy"),
        ("llm-chat", "availability"),
        ("llm-chat", "rollback_ref"),
        ("llm-chat", "evidence"),
    }


def test_catalog_rejects_duplicate_and_unknown_rows():
    duplicate = replace(DEFAULT_EVALUATION_ROWS[0], row_id="duplicate")
    catalog = EvaluationCatalog(
        (DEFAULT_EVALUATION_ROWS[0], duplicate, *DEFAULT_EVALUATION_ROWS[1:])
    )

    issues = catalog.validate()

    assert any(
        issue.field == "capability" and "duplicate" in issue.message for issue in issues
    )


def test_catalog_reports_malformed_row_identity_without_crashing():
    malformed = replace(
        DEFAULT_EVALUATION_ROWS[0], row_id=[], capability=[], evidence="bad"
    )

    issues = EvaluationCatalog((malformed, *DEFAULT_EVALUATION_ROWS[1:])).validate()

    assert {(issue.field, issue.message) for issue in issues} >= {
        ("row_id", "is required"),
        ("capability", "is unsupported"),
        ("evidence", "needs a non-empty entry"),
    }


def test_default_fixtures_cover_every_catalog_row_without_live_dependencies():
    evaluator = DeterministicRegressionEvaluator(
        EvaluationCatalog(DEFAULT_EVALUATION_ROWS), DEFAULT_REGRESSION_FIXTURES
    )

    report = evaluator.run()

    assert report.passed is True
    assert report.fixture_count == 11
    assert {row.capability for row in report.rows} == EXPECTED_CAPABILITIES
    assert all(row.provider == "deterministic-fake" for row in report.rows)
    assert all(row.live_provider_used is False for row in report.rows)


def test_regression_report_is_repeatable_and_has_independent_evidence_rows():
    evaluator = DeterministicRegressionEvaluator(
        EvaluationCatalog(DEFAULT_EVALUATION_ROWS), DEFAULT_REGRESSION_FIXTURES
    )

    first = evaluator.run()
    second = evaluator.run()

    assert first == second
    assert len({row.evidence_id for row in first.rows}) == 11
    assert all(row.quality >= 1.0 for row in first.rows)
    assert all(row.latency_ms <= 100 for row in first.rows)
    assert all(row.cost_units == 0.0 for row in first.rows)


def test_regression_fixture_failure_is_reported_for_the_affected_row_only():
    altered = replace(
        DEFAULT_REGRESSION_FIXTURES[0],
        returned_tenant_id="tenant-b",
    )
    fixtures = (altered, *DEFAULT_REGRESSION_FIXTURES[1:])
    evaluator = DeterministicRegressionEvaluator(
        EvaluationCatalog(DEFAULT_EVALUATION_ROWS), fixtures
    )

    report = evaluator.run()

    assert report.passed is False
    failed = [row for row in report.rows if row.capability == "llm-chat"]
    assert len(failed) == 1
    assert failed[0].passed is False
    assert "tenant_isolation" in failed[0].failures
    assert all(row.passed for row in report.rows if row.capability != "llm-chat")


def test_regression_thresholds_and_live_provider_boundary_are_row_scoped():
    altered = replace(
        DEFAULT_REGRESSION_FIXTURES[1],
        quality=0.5,
        provider="live-provider",
        live_provider_used=True,
    )
    evaluator = DeterministicRegressionEvaluator(
        EvaluationCatalog(DEFAULT_EVALUATION_ROWS),
        (DEFAULT_REGRESSION_FIXTURES[0], altered, *DEFAULT_REGRESSION_FIXTURES[2:]),
    )

    report = evaluator.run(minimum_quality=1.0)

    failed = next(row for row in report.rows if row.capability == "structured-output")
    assert report.passed is False
    assert set(failed.failures) == {"quality", "live_provider"}
    assert all(
        row.passed for row in report.rows if row.capability != "structured-output"
    )


def test_custom_fixture_requires_a_known_capability_and_expected_output():
    unknown = RegressionFixture(
        fixture_id="unknown-fixture",
        capability="not-a-capability",
        input_payload={"prompt": "x"},
        expected_output="never-used",
    )

    with pytest.raises(ValueError, match="unsupported capability"):
        DeterministicRegressionEvaluator(
            EvaluationCatalog(DEFAULT_EVALUATION_ROWS), (unknown,)
        )


def test_catalog_documentation_lists_all_rows_and_local_only_boundary():
    documentation = (ROOT / "docs" / "ai" / "catalog-ledger.md").read_text(
        encoding="utf-8"
    )

    for capability in EXPECTED_CAPABILITIES:
        assert f"`{capability}`" in documentation
    assert "deterministic" in documentation.lower()
    assert "No production-readiness claim" in documentation
