"""Provider-free, deterministic RAG quality and operations evaluations."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean


@dataclass(frozen=True, slots=True)
class RagEvaluationFixture:
    name: str
    expected_chunk_ids: tuple[str, ...]
    returned_chunk_ids: tuple[str, ...]
    expected_tenant_id: str
    returned_tenant_ids: tuple[str, ...]
    citations_correct: bool
    quality: float
    latency_ms: float
    cost_units: float


@dataclass(frozen=True, slots=True)
class RagEvaluationResult:
    passed: bool
    metrics: dict[str, float]
    fixture_count: int
    failures: tuple[str, ...] = ()


DEFAULT_RAG_EVALUATION_FIXTURES = (
    RagEvaluationFixture(
        name="tenant-a-policy",
        expected_chunk_ids=("a-1",),
        returned_chunk_ids=("a-1",),
        expected_tenant_id="tenant-a",
        returned_tenant_ids=("tenant-a",),
        citations_correct=True,
        quality=1.0,
        latency_ms=42.0,
        cost_units=3.0,
    ),
)


class DeterministicRagEvaluator:
    def __init__(
        self, fixtures: tuple[RagEvaluationFixture, ...] | list[RagEvaluationFixture]
    ) -> None:
        self.fixtures = tuple(fixtures)
        if not self.fixtures:
            raise ValueError("at least one RAG evaluation fixture is required")

    def run(
        self,
        *,
        minimum_recall: float = 1.0,
        minimum_isolation: float = 1.0,
        minimum_citation_correctness: float = 1.0,
        minimum_quality: float = 1.0,
        maximum_latency_ms: float = 100.0,
        maximum_cost_units: float = 10.0,
    ) -> RagEvaluationResult:
        recalls = [self._recall(fixture) for fixture in self.fixtures]
        isolation = [
            float(
                all(tenant == fixture.expected_tenant_id for tenant in fixture.returned_tenant_ids)
            )
            for fixture in self.fixtures
        ]
        citations = [float(fixture.citations_correct) for fixture in self.fixtures]
        metrics = {
            "recall_at_k": mean(recalls),
            "tenant_isolation": mean(isolation),
            "citation_correctness": mean(citations),
            "quality": mean(fixture.quality for fixture in self.fixtures),
            "latency_ms": mean(fixture.latency_ms for fixture in self.fixtures),
            "cost_units": mean(fixture.cost_units for fixture in self.fixtures),
        }
        failures = tuple(
            name
            for name, passed in {
                "recall": metrics["recall_at_k"] >= minimum_recall,
                "tenant_isolation": metrics["tenant_isolation"] >= minimum_isolation,
                "citation_correctness": metrics["citation_correctness"]
                >= minimum_citation_correctness,
                "quality": metrics["quality"] >= minimum_quality,
                "latency": metrics["latency_ms"] <= maximum_latency_ms,
                "cost": metrics["cost_units"] <= maximum_cost_units,
            }.items()
            if not passed
        )
        return RagEvaluationResult(not failures, metrics, len(self.fixtures), failures)

    @staticmethod
    def _recall(fixture: RagEvaluationFixture) -> float:
        if not fixture.expected_chunk_ids:
            return 1.0
        expected = set(fixture.expected_chunk_ids)
        return len(expected & set(fixture.returned_chunk_ids)) / len(expected)


__all__ = [
    "DEFAULT_RAG_EVALUATION_FIXTURES",
    "DeterministicRagEvaluator",
    "RagEvaluationFixture",
    "RagEvaluationResult",
]
