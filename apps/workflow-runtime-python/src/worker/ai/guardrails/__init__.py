"""Deterministic safety policy and human-review escalation for AI requests."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum

from worker.ai.privacy import redact_text
from worker.langgraph.registry import RuntimeContext


class SafetyDecision(StrEnum):
    ALLOW = "allow"
    DENY = "deny"
    ESCALATE = "escalate"


class HumanReviewDecision(StrEnum):
    APPROVE = "approve"
    REJECT = "reject"


@dataclass(frozen=True, slots=True)
class SafetyRequest:
    context: RuntimeContext
    content: str
    privileged_action: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("Runtime context is required")
        if not isinstance(self.content, str) or not self.content.strip():
            raise ValueError("Safety content is required")


@dataclass(frozen=True, slots=True)
class SafetyAudit:
    audit_id: str
    tenant_id: str
    actor_id: str
    correlation_id: str
    idempotency_key: str
    outcome: str
    category: str
    policy_version: str
    lineage: dict[str, str]


@dataclass(frozen=True, slots=True)
class SafetyOutcome:
    decision: SafetyDecision
    category: str
    reason: str
    redacted_content: str
    audit: SafetyAudit
    review_id: str | None = None


@dataclass(frozen=True, slots=True)
class HumanReview:
    review_id: str
    tenant_id: str
    requester_actor_id: str
    content: str
    category: str
    status: str
    audit: SafetyAudit


class InMemoryHumanReviewQueue:
    """Tenant-scoped review queue with deterministic IDs and no external I/O."""

    def __init__(self) -> None:
        self._reviews: dict[str, HumanReview] = {}
        self._sequence = 0

    def enqueue(self, outcome: SafetyOutcome, context: RuntimeContext) -> HumanReview:
        self._sequence += 1
        review_id = f"review-{self._sequence}"
        review = HumanReview(
            review_id=review_id,
            tenant_id=context.tenant_id,
            requester_actor_id=context.actor_id,
            content=outcome.redacted_content,
            category=outcome.category,
            status="pending",
            audit=outcome.audit,
        )
        self._reviews[review_id] = review
        return review

    def get(self, context: RuntimeContext, review_id: str) -> HumanReview:
        review = self._reviews.get(review_id)
        if review is None or review.tenant_id != context.tenant_id:
            raise KeyError("No tenant-scoped human review")
        return review

    def resolve(
        self,
        context: RuntimeContext,
        review_id: str,
        decision: HumanReviewDecision,
        *,
        reason: str,
    ) -> HumanReview:
        review = self.get(context, review_id)
        if review.status != "pending":
            raise ValueError("Human review is no longer pending")
        if not isinstance(decision, HumanReviewDecision):
            raise TypeError("Unsupported human review decision")
        if not reason.strip():
            raise ValueError("Human review reason is required")
        outcome = "approved" if decision is HumanReviewDecision.APPROVE else "rejected"
        audit = SafetyAudit(
            audit_id=_audit_id(context, review_id, outcome),
            tenant_id=review.tenant_id,
            actor_id=context.actor_id,
            correlation_id=context.correlation_id,
            idempotency_key=context.idempotency_key,
            outcome=outcome,
            category=review.category,
            policy_version="ai-safety.v1",
            lineage=dict(context.lineage),
        )
        resolved = HumanReview(
            review_id=review.review_id,
            tenant_id=review.tenant_id,
            requester_actor_id=review.requester_actor_id,
            content=review.content,
            category=review.category,
            status=outcome,
            audit=audit,
        )
        self._reviews[review_id] = resolved
        return resolved


class DeterministicGuardrail:
    """Provider-free policy evaluator; every outcome is redacted and auditable."""

    policy_version = "ai-safety.v1"

    def __init__(
        self,
        *,
        review_queue: InMemoryHumanReviewQueue | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        self._review_queue = review_queue
        self._clock = clock or (lambda: 0)
        self._audits: list[SafetyAudit] = []

    def evaluate(self, request: SafetyRequest) -> SafetyOutcome:
        content = redact_text(request.content)
        category, decision, reason = self._classify(request)
        audit_outcome = {
            SafetyDecision.ALLOW: "allowed",
            SafetyDecision.DENY: "denied",
            SafetyDecision.ESCALATE: "escalated",
        }[decision]
        audit = SafetyAudit(
            audit_id=_audit_id(request.context, request.context.idempotency_key, decision.value),
            tenant_id=request.context.tenant_id,
            actor_id=request.context.actor_id,
            correlation_id=request.context.correlation_id,
            idempotency_key=request.context.idempotency_key,
            outcome=audit_outcome,
            category=category,
            policy_version=self.policy_version,
            lineage=dict(request.context.lineage),
        )
        self._audits.append(audit)
        outcome = SafetyOutcome(decision, category, reason, content, audit)
        if decision is SafetyDecision.ESCALATE and self._review_queue is not None:
            review = self._review_queue.enqueue(outcome, request.context)
            return SafetyOutcome(decision, category, reason, content, audit, review.review_id)
        return outcome

    def audit_log(self, context: RuntimeContext) -> tuple[SafetyAudit, ...]:
        return tuple(audit for audit in self._audits if audit.tenant_id == context.tenant_id)

    @staticmethod
    def _classify(request: SafetyRequest) -> tuple[str, SafetyDecision, str]:
        normalized = request.content.casefold()
        if re.search(r"ignore\s+(?:all\s+)?previous instructions|jailbreak", normalized):
            return "prompt_injection", SafetyDecision.DENY, "prompt injection detected"
        if re.search(r"child sexual|sexual exploitation", normalized):
            return "prohibited_content", SafetyDecision.DENY, "prohibited content detected"
        if request.privileged_action or re.search(
            r"self[- ]harm|kill myself|high impact account change", normalized
        ):
            return "high_risk", SafetyDecision.ESCALATE, "human review required"
        return "safe", SafetyDecision.ALLOW, "policy allowed"


def _audit_id(context: RuntimeContext, resource_id: str, outcome: str) -> str:
    source = f"{context.tenant_id}:{context.idempotency_key}:{resource_id}:{outcome}"
    return hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]


__all__ = [
    "DeterministicGuardrail",
    "HumanReview",
    "HumanReviewDecision",
    "InMemoryHumanReviewQueue",
    "SafetyAudit",
    "SafetyDecision",
    "SafetyOutcome",
    "SafetyRequest",
]
