"""Contract and evidence validation for the complete local AI catalog."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

AI_CAPABILITIES = (
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
)

_REQUIRED_FIELDS = (
    "contract",
    "implementation",
    "owner",
    "fake",
    "evaluation",
    "fixture",
    "neutral_use_case",
    "policy",
    "availability",
    "rollback_ref",
)


@dataclass(frozen=True, slots=True)
class EvaluationRow:
    """One independently reviewable AI capability evidence row."""

    row_id: str
    capability: str
    contract: str
    implementation: str
    owner: str
    fake: str
    evaluation: str
    fixture: str
    neutral_use_case: str
    policy: str
    availability: str
    evidence: tuple[str, ...]
    rollback_ref: str


@dataclass(frozen=True, slots=True)
class EvaluationIssue:
    row_id: str
    field: str
    message: str


class EvaluationCatalogValidationError(ValueError):
    """Raised when the AI catalog cannot provide complete traceability."""

    def __init__(self, issues: tuple[EvaluationIssue, ...]) -> None:
        self.issues = issues
        details = "; ".join(f"{issue.row_id} {issue.field}: {issue.message}" for issue in issues)
        super().__init__(f"AI evaluation catalog validation failed: {details}")


class EvaluationCatalog:
    """Immutable-shaped view over independently validated AI evidence rows."""

    def __init__(self, rows: Iterable[EvaluationRow]) -> None:
        self.rows = tuple(rows)

    @property
    def capabilities(self) -> tuple[str, ...]:
        return tuple(sorted(row.capability for row in self.rows))

    def get(self, capability: str) -> EvaluationRow:
        for row in self.rows:
            if row.capability == capability:
                return row
        raise KeyError(f"No AI evaluation row for {capability!r}")

    def validate(self) -> tuple[EvaluationIssue, ...]:
        issues: list[EvaluationIssue] = []
        row_ids: set[str] = set()
        capabilities: set[str] = set()

        for row in self.rows:
            row_id = (
                row.row_id
                if isinstance(row, EvaluationRow) and _non_empty(row.row_id)
                else "<unknown>"
            )
            if not isinstance(row, EvaluationRow):
                issues.append(EvaluationIssue(row_id, "row", "must be an EvaluationRow"))
                continue
            if not _non_empty(row.row_id):
                issues.append(EvaluationIssue(row_id, "row_id", "is required"))
            if isinstance(row.row_id, str):
                if row.row_id in row_ids:
                    issues.append(EvaluationIssue(row_id, "row_id", "must be unique"))
                row_ids.add(row.row_id)
            if not isinstance(row.capability, str) or row.capability not in AI_CAPABILITIES:
                issues.append(EvaluationIssue(row_id, "capability", "is unsupported"))
            elif row.capability in capabilities:
                issues.append(EvaluationIssue(row_id, "capability", "is duplicated"))
            else:
                capabilities.add(row.capability)

            for field_name in _REQUIRED_FIELDS:
                if not _non_empty(getattr(row, field_name)):
                    issues.append(EvaluationIssue(row_id, field_name, "is required"))
            if (
                not isinstance(row.evidence, (tuple, list))
                or not row.evidence
                or not all(_non_empty(item) for item in row.evidence)
            ):
                issues.append(EvaluationIssue(row_id, "evidence", "needs a non-empty entry"))

        for capability in AI_CAPABILITIES:
            if capability not in capabilities:
                issues.append(EvaluationIssue("<catalog>", "capability", f"missing {capability}"))
        return tuple(issues)

    def assert_valid(self) -> None:
        issues = self.validate()
        if issues:
            raise EvaluationCatalogValidationError(issues)


def _non_empty(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _row(
    capability: str,
    contract: str,
    implementation: str,
    fake: str,
    evaluation: str,
    fixture: str,
    evidence: tuple[str, ...],
) -> EvaluationRow:
    return EvaluationRow(
        row_id=capability,
        capability=capability,
        contract=contract,
        implementation=implementation,
        owner="AI Platform / Runtime",
        fake=fake,
        evaluation=evaluation,
        fixture=fixture,
        neutral_use_case=f"neutral {capability} workflow",
        policy="tenant isolation, quota, guardrails, redaction, and cost ownership",
        availability="local deterministic fake active; live provider activation gated",
        evidence=evidence,
        rollback_ref=f"revert P4.6 {capability} evaluation catalog row",
    )


DEFAULT_EVALUATION_ROWS = (
    _row(
        "llm-chat",
        "LLM/chat request and response ports",
        "DeterministicLLM and DeterministicChat",
        "DeterministicLLM/DeterministicChat",
        "repeatable response, lineage, usage, and cost",
        "fixture-llm-chat",
        ("response and lineage", "usage/cost"),
    ),
    _row(
        "structured-output",
        "bounded JSON Schema structured-output port",
        "StructuredOutputExecutor",
        "Scripted deterministic chat",
        "valid output, bounded retries, and validation errors",
        "fixture-structured-output",
        ("schema validation", "retry bound"),
    ),
    _row(
        "tools",
        "typed permissioned tool port",
        "PermissionedToolExecutor",
        "in-memory permissioned tool",
        "grant, deny-by-default, invalid input, and audit",
        "fixture-tools",
        ("tool denial", "tenant/actor audit"),
    ),
    _row(
        "agents",
        "LangGraph agent/subgraph/supervisor contract",
        "AgentRuntime",
        "in-memory agent and supervisor catalogs",
        "composition, authority, and resume behavior",
        "fixture-agents",
        ("authority boundary", "resume"),
    ),
    _row(
        "memory",
        "tenant/actor/session memory catalog",
        "InMemoryMemoryCatalog",
        "deep-copy in-memory memory catalog",
        "versioning, isolation, and mutation safety",
        "fixture-memory",
        ("cross-actor denial", "version/deep copy"),
    ),
    _row(
        "registry",
        "versioned prompt/model/rollout registry",
        "InMemoryAIRegistry",
        "DeterministicFakeEvaluator",
        "approval, availability, rollback, and redacted audit",
        "fixture-registry",
        ("fail-closed rollout", "evaluation audit"),
    ),
    _row(
        "routing",
        "provider route/retry/circuit contract",
        "ProviderRouter",
        "scripted provider routes",
        "bounded attempts, explicit fallback, and circuit state",
        "fixture-routing",
        ("timeout fallback", "circuit-open metadata"),
    ),
    _row(
        "cost",
        "usage, pricing, and hard-quota contract",
        "UsageMetadata and HardTenantQuota",
        "in-memory usage/quota ledger",
        "deterministic aggregation and tenant exhaustion",
        "fixture-cost",
        ("cost aggregation", "quota exhaustion"),
    ),
    _row(
        "guardrails",
        "safety, privacy, and HITL outcome contract",
        "DeterministicGuardrail and privacy stores",
        "local guardrail/HITL/redaction fakes",
        "deny, escalate, redact, consent, and deletion",
        "fixture-guardrails",
        ("unsafe denial", "HITL and redaction"),
    ),
    _row(
        "streaming",
        "versioned stream frame and cursor contract",
        "deterministic stream runtime",
        "in-memory stream fixture",
        "ordering, reconnect, backpressure, and cancellation",
        "fixture-streaming",
        ("ordered reconnect", "bounded backpressure"),
    ),
    _row(
        "rag",
        "tenant-filtered retrieval and citation contract",
        "RAG retrieval/evaluation runtime",
        "deterministic RAG fixtures",
        "recall, isolation, citations, latency, and cost",
        "fixture-rag",
        ("recall/citations", "tenant isolation"),
    ),
)


__all__ = [
    "AI_CAPABILITIES",
    "DEFAULT_EVALUATION_ROWS",
    "EvaluationCatalog",
    "EvaluationCatalogValidationError",
    "EvaluationIssue",
    "EvaluationRow",
]
