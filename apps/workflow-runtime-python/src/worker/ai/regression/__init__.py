"""Deterministic, provider-free regression evaluation for the AI catalog."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from worker.ai.evaluations import AI_CAPABILITIES, EvaluationCatalog


@dataclass(frozen=True, slots=True)
class RegressionFixture:
    """One deterministic input/output expectation for one catalog capability."""

    fixture_id: str
    capability: str
    input_payload: Mapping[str, object]
    expected_output: object
    expected_tenant_id: str = "tenant-a"
    returned_tenant_id: str = "tenant-a"
    quality: float = 1.0
    latency_ms: float = 17.0
    cost_units: float = 0.0
    provider: str = "deterministic-fake"
    live_provider_used: bool = False

    def __post_init__(self) -> None:
        for value, label in (
            (self.fixture_id, "fixture_id"),
            (self.capability, "capability"),
            (self.expected_tenant_id, "expected_tenant_id"),
            (self.returned_tenant_id, "returned_tenant_id"),
            (self.provider, "provider"),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{label} is required")
        if not isinstance(self.input_payload, Mapping):
            raise TypeError("input_payload must be a mapping")
        if self.expected_output is None:
            raise ValueError("expected_output is required")
        if self.quality < 0 or self.latency_ms < 0 or self.cost_units < 0:
            raise ValueError("evaluation metrics cannot be negative")


@dataclass(frozen=True, slots=True)
class RegressionRow:
    """Independent evidence for one evaluated AI capability."""

    evidence_id: str
    fixture_id: str
    capability: str
    passed: bool
    failures: tuple[str, ...]
    provider: str
    live_provider_used: bool
    quality: float
    latency_ms: float
    cost_units: float


@dataclass(frozen=True, slots=True)
class RegressionReport:
    """Stable report containing one independently verifiable row per capability."""

    passed: bool
    fixture_count: int
    rows: tuple[RegressionRow, ...]


class DeterministicRegressionEvaluator:
    """Evaluate catalog fixtures without providers, network, credentials, or storage."""

    def __init__(
        self,
        catalog: EvaluationCatalog,
        fixtures: Iterable[RegressionFixture],
    ) -> None:
        self.catalog = catalog
        self.fixtures = tuple(fixtures)
        self.catalog.assert_valid()
        self._validate_fixtures()

    def run(
        self,
        *,
        minimum_quality: float = 1.0,
        maximum_latency_ms: float = 100.0,
        maximum_cost_units: float = 0.0,
    ) -> RegressionReport:
        if minimum_quality < 0 or maximum_latency_ms < 0 or maximum_cost_units < 0:
            raise ValueError("evaluation thresholds cannot be negative")

        rows: list[RegressionRow] = []
        for fixture in self.fixtures:
            failures = self._evaluate_fixture(
                fixture,
                minimum_quality=minimum_quality,
                maximum_latency_ms=maximum_latency_ms,
                maximum_cost_units=maximum_cost_units,
            )
            rows.append(
                RegressionRow(
                    evidence_id=f"evidence-{fixture.fixture_id}",
                    fixture_id=fixture.fixture_id,
                    capability=fixture.capability,
                    passed=not failures,
                    failures=failures,
                    provider=fixture.provider,
                    live_provider_used=fixture.live_provider_used,
                    quality=fixture.quality,
                    latency_ms=fixture.latency_ms,
                    cost_units=fixture.cost_units,
                )
            )
        return RegressionReport(
            passed=all(row.passed for row in rows),
            fixture_count=len(rows),
            rows=tuple(rows),
        )

    def _validate_fixtures(self) -> None:
        known_capabilities = set(self.catalog.capabilities)
        fixture_ids: set[str] = set()
        capabilities: set[str] = set()
        for fixture in self.fixtures:
            if not isinstance(fixture, RegressionFixture):
                raise TypeError("regression fixtures must be RegressionFixture instances")
            if (
                fixture.capability not in AI_CAPABILITIES
                or fixture.capability not in known_capabilities
            ):
                raise ValueError(f"unsupported capability: {fixture.capability}")
            if fixture.fixture_id in fixture_ids:
                raise ValueError(f"duplicate fixture_id: {fixture.fixture_id}")
            if fixture.capability in capabilities:
                raise ValueError(f"duplicate regression row for capability: {fixture.capability}")
            fixture_ids.add(fixture.fixture_id)
            capabilities.add(fixture.capability)

        missing = sorted(known_capabilities - capabilities)
        if missing:
            raise ValueError(f"missing regression fixture for capability: {missing[0]}")

    @staticmethod
    def _evaluate_fixture(
        fixture: RegressionFixture,
        *,
        minimum_quality: float,
        maximum_latency_ms: float,
        maximum_cost_units: float,
    ) -> tuple[str, ...]:
        failures: list[str] = []
        actual_output = _fake_output(fixture.capability, fixture.input_payload)
        if _canonical_json(actual_output) != _canonical_json(fixture.expected_output):
            failures.append("expected_output")
        if fixture.expected_tenant_id != fixture.returned_tenant_id:
            failures.append("tenant_isolation")
        if fixture.quality < minimum_quality:
            failures.append("quality")
        if fixture.latency_ms > maximum_latency_ms:
            failures.append("latency")
        if fixture.cost_units > maximum_cost_units:
            failures.append("cost")
        if fixture.provider != "deterministic-fake" or fixture.live_provider_used:
            failures.append("live_provider")
        return tuple(failures)


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _fake_output(capability: str, input_payload: Mapping[str, object]) -> str:
    digest = hashlib.sha256(_canonical_json(input_payload).encode("utf-8")).hexdigest()[:16]
    return f"{capability}:deterministic:{digest}"


def _fixture(capability: str, payload: Mapping[str, object]) -> RegressionFixture:
    return RegressionFixture(
        fixture_id=f"fixture-{capability}",
        capability=capability,
        input_payload=payload,
        expected_output=_fake_output(capability, payload),
    )


DEFAULT_REGRESSION_FIXTURES = tuple(
    _fixture(capability, {"case": capability, "tenant_id": "tenant-a"})
    for capability in AI_CAPABILITIES
)


__all__ = [
    "DEFAULT_REGRESSION_FIXTURES",
    "DeterministicRegressionEvaluator",
    "RegressionFixture",
    "RegressionReport",
    "RegressionRow",
]
