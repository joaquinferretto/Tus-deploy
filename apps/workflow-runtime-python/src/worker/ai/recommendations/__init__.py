"""Neutral, tenant-safe recommendation ports with deterministic local ranking."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from worker.ai.guardrails import DeterministicGuardrail, SafetyAudit, SafetyDecision, SafetyRequest
from worker.ai.llm import LineageMetadata, ProviderUnavailableError
from worker.ai.quota import HardTenantQuota, QuotaReservation
from worker.langgraph.registry import RuntimeContext
from worker.telemetry.ports import TelemetryContext, TelemetryPort

RECOMMENDATION_OWNER = "AI Platform / Runtime"
NEUTRAL_USE_CASE = "tenant-authorized discovery of candidate resources across products"
RECOMMENDATION_TOKEN = re.compile(r"[\w-]+", re.UNICODE)


class RecommendationContractError(ValueError):
    """Raised when recommendation input or output violates the neutral contract."""


class RecommendationLatencyError(RecommendationContractError):
    """Raised when deterministic work exceeds its configured latency budget."""


class RecommendationProviderError(RuntimeError):
    """Raised after an injected recommendation provider failure is sanitized."""


class AvailabilityStatus(StrEnum):
    ACTIVE = "active"
    ALTERNATIVE = "alternative"
    GATED = "gated"
    UNAVAILABLE = "unavailable"
    DEFERRED = "deferred"


@dataclass(frozen=True, slots=True)
class AvailabilityDisposition:
    status: AvailabilityStatus
    reason: str
    alternative: str | None = None


@dataclass(frozen=True, slots=True)
class RecommendationRetentionPolicy:
    retention_seconds: int = 86_400
    encryption_key_ref: str = "deterministic-local-recommendation-key"
    algorithm: str = "deterministic-local-envelope.v1"

    def __post_init__(self) -> None:
        if self.retention_seconds < 0:
            raise ValueError("retention_seconds must be non-negative")
        if not self.encryption_key_ref.strip() or not self.algorithm.strip():
            raise ValueError("recommendation retention metadata is incomplete")


@dataclass(frozen=True, slots=True)
class RecommendationRetentionMetadata:
    expires_at: int
    encrypted: bool
    key_ref: str
    algorithm: str


@dataclass(frozen=True, slots=True)
class RecommendationCandidate:
    candidate_id: str
    title: str
    tags: tuple[str, ...] = ()
    tenant_id: str | None = None

    def __post_init__(self) -> None:
        if not self.candidate_id.strip() or not self.title.strip():
            raise RecommendationContractError("recommendation candidate id and title are required")
        if len(self.candidate_id) > 200 or len(self.title) > 500:
            raise RecommendationContractError("recommendation candidate exceeds configured size")
        if any(_has_unsafe_control(value) for value in (self.candidate_id, self.title, *self.tags)):
            raise RecommendationContractError(
                "recommendation candidate contains unsafe control content"
            )
        if len(self.tags) > 32 or any(
            not isinstance(tag, str) or not tag.strip() for tag in self.tags
        ):
            raise RecommendationContractError("recommendation candidate tags are invalid")
        if self.tenant_id is not None and not self.tenant_id.strip():
            raise RecommendationContractError("recommendation candidate tenant is invalid")


@dataclass(frozen=True, slots=True)
class RecommendationRequest:
    query: str
    candidates: tuple[RecommendationCandidate, ...]
    context: RuntimeContext
    limit: int = 10
    model: str = "recommendation-model.v1"

    def __post_init__(self) -> None:
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")
        if not isinstance(self.query, str) or not self.query.strip():
            raise RecommendationContractError("recommendation query is required")
        if not self.model.strip():
            raise RecommendationContractError("recommendation model is required")
        if self.limit < 1 or self.limit > 20:
            raise RecommendationContractError("recommendation limit must be between 1 and 20")
        candidates = tuple(self.candidates)
        if not candidates:
            raise RecommendationContractError("recommendation candidates are required")
        if any(not isinstance(item, RecommendationCandidate) for item in candidates):
            raise TypeError("recommendation candidates must use the neutral candidate contract")
        if len({item.candidate_id for item in candidates}) != len(candidates):
            raise RecommendationContractError("recommendation candidate ids must be unique")
        object.__setattr__(self, "query", self.query.strip())
        object.__setattr__(self, "candidates", candidates)


@dataclass(frozen=True, slots=True)
class RecommendationItem:
    candidate_id: str
    rank: int
    score: float
    reason_code: str

    def __post_init__(self) -> None:
        if not self.candidate_id.strip() or self.rank < 1 or not 0 <= self.score <= 1:
            raise RecommendationContractError("recommendation result is invalid")
        if not self.reason_code.strip():
            raise RecommendationContractError("recommendation reason code is required")


@dataclass(frozen=True, slots=True)
class RecommendationUsageMetadata:
    input_characters: int
    candidate_count: int
    returned_count: int
    estimated_cost_usd: float
    currency: str = "USD"

    def __post_init__(self) -> None:
        if min(self.input_characters, self.candidate_count, self.returned_count) < 0:
            raise ValueError("recommendation usage counts cannot be negative")
        if self.returned_count > self.candidate_count or self.estimated_cost_usd < 0:
            raise ValueError("recommendation usage metadata is invalid")
        if self.currency != "USD":
            raise ValueError("recommendation usage currency must be USD")


@dataclass(frozen=True, slots=True)
class RecommendationSafetyMetadata:
    decision: SafetyDecision
    category: str
    reason: str
    policy_version: str
    review_id: str | None = None


@dataclass(frozen=True, slots=True)
class RecommendationLatencyMetadata:
    latency_ms: int
    budget_ms: int
    within_budget: bool

    def __post_init__(self) -> None:
        if self.latency_ms < 0 or self.budget_ms < 1:
            raise ValueError("recommendation latency metadata is invalid")


@dataclass(frozen=True, slots=True)
class RecommendationResponse:
    recommendations: tuple[RecommendationItem, ...]
    provider: str
    model: str
    usage: RecommendationUsageMetadata
    safety: RecommendationSafetyMetadata
    latency: RecommendationLatencyMetadata
    audit: SafetyAudit
    availability: AvailabilityDisposition
    lineage: LineageMetadata
    retention: RecommendationRetentionMetadata


class RecommendationClient(Protocol):
    def recommend(self, request: RecommendationRequest) -> RecommendationResponse: ...


RecommendationTransport = Callable[
    [RecommendationRequest], Iterable[RecommendationItem | tuple[str, float]]
]


class _BaseRecommendations:
    provider = "fake"

    def __init__(
        self,
        *,
        model: str,
        max_query_chars: int,
        max_candidates: int,
        max_latency_ms: int,
        quota: HardTenantQuota | None,
        telemetry: TelemetryPort | None,
        safety: DeterministicGuardrail | None,
        retention: RecommendationRetentionPolicy,
        clock: Callable[[], int],
    ) -> None:
        if not model.strip() or max_query_chars < 1 or max_candidates < 1 or max_latency_ms < 1:
            raise ValueError("recommendation model and positive bounds are required")
        self._model = model
        self._max_query_chars = max_query_chars
        self._max_candidates = max_candidates
        self._max_latency_ms = max_latency_ms
        self._quota = quota
        self._telemetry = telemetry
        self._safety = safety or DeterministicGuardrail()
        self._retention = retention
        self._clock = clock
        self._audits: list[SafetyAudit] = []

    def recommend(self, request: RecommendationRequest) -> RecommendationResponse:
        latency = self._validate(request)
        outcome = self._evaluate_safety(request)
        self._audits.append(outcome.audit)
        safety = RecommendationSafetyMetadata(
            decision=outcome.decision,
            category=outcome.category,
            reason=outcome.reason,
            policy_version=outcome.audit.policy_version,
            review_id=outcome.review_id,
        )
        if outcome.decision is not SafetyDecision.ALLOW:
            response = self._response(request, (), safety, outcome.audit, latency, 0.0)
            self._log("recommendations.safety", request, response)
            return response

        cost_usd = self._cost(request)
        reservation = self._reserve(request, cost_usd)
        try:
            recommendations = self._recommendations(request)
            response = self._response(
                request,
                recommendations,
                safety,
                outcome.audit,
                latency,
                cost_usd,
            )
            self._finish(reservation, response)
            reservation = None
            self._log("recommendations.completed", request, response)
            return response
        finally:
            self._release(reservation)

    def audit_log(self, context: RuntimeContext) -> tuple[SafetyAudit, ...]:
        return tuple(audit for audit in self._audits if audit.tenant_id == context.tenant_id)

    def _validate(self, request: RecommendationRequest) -> RecommendationLatencyMetadata:
        if len(request.query) > self._max_query_chars:
            raise RecommendationContractError(
                "recommendation query exceeds maximum configured size"
            )
        if len(request.candidates) > self._max_candidates:
            raise RecommendationContractError("recommendation candidate count exceeds maximum")
        if _has_unsafe_control(request.query):
            raise RecommendationContractError(
                "recommendation query contains unsafe control content"
            )
        for item in request.candidates:
            if item.tenant_id is not None and item.tenant_id != request.context.tenant_id:
                raise RecommendationContractError(
                    "recommendation candidate tenant does not match context"
                )
        estimate = 1 + len(request.candidates) + (len(request.query) + 99) // 100
        if estimate > self._max_latency_ms:
            raise RecommendationLatencyError("recommendation latency budget exceeded")
        return RecommendationLatencyMetadata(estimate, self._max_latency_ms, True)

    def _evaluate_safety(self, request: RecommendationRequest):
        searchable = " ".join(
            [
                request.query,
                *(item.title for item in request.candidates),
                *(tag for item in request.candidates for tag in item.tags),
            ]
        )
        return self._safety.evaluate(SafetyRequest(request.context, searchable))

    def _recommendations(self, request: RecommendationRequest) -> tuple[RecommendationItem, ...]:
        raise NotImplementedError

    def _cost(self, request: RecommendationRequest) -> float:
        return 0.0

    def _response(
        self,
        request: RecommendationRequest,
        recommendations: Iterable[RecommendationItem],
        safety: RecommendationSafetyMetadata,
        audit: SafetyAudit,
        latency: RecommendationLatencyMetadata,
        cost_usd: float,
    ) -> RecommendationResponse:
        normalized = tuple(recommendations)
        if len(normalized) > request.limit or any(
            item.rank != index for index, item in enumerate(normalized, start=1)
        ):
            raise RecommendationProviderError("recommendation provider returned invalid ranking")
        valid_ids = {item.candidate_id for item in request.candidates}
        if any(item.candidate_id not in valid_ids for item in normalized):
            raise RecommendationProviderError(
                "recommendation provider returned an unknown candidate"
            )
        return RecommendationResponse(
            recommendations=normalized,
            provider=self.provider,
            model=request.model or self._model,
            usage=RecommendationUsageMetadata(
                input_characters=len(request.query),
                candidate_count=len(request.candidates),
                returned_count=len(normalized),
                estimated_cost_usd=cost_usd,
            ),
            safety=safety,
            latency=latency,
            audit=audit,
            availability=self.availability,
            lineage=LineageMetadata.from_context(request.context),
            retention=RecommendationRetentionMetadata(
                expires_at=self._clock() + self._retention.retention_seconds,
                encrypted=True,
                key_ref=self._retention.encryption_key_ref,
                algorithm=self._retention.algorithm,
            ),
        )

    def _reserve(self, request: RecommendationRequest, cost_usd: float) -> QuotaReservation | None:
        if self._quota is None:
            return None
        return self._quota.reserve(
            request.context.tenant_id,
            requests=1,
            tokens=max(1, len(request.query.split()) + len(request.candidates)),
            cost_usd=cost_usd,
        )

    def _finish(
        self, reservation: QuotaReservation | None, response: RecommendationResponse
    ) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.commit(
                reservation,
                tokens=max(1, response.usage.input_characters // 4 + response.usage.returned_count),
                cost_usd=response.usage.estimated_cost_usd,
            )

    def _release(self, reservation: QuotaReservation | None) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.release(reservation)

    def _log(
        self, name: str, request: RecommendationRequest, response: RecommendationResponse
    ) -> None:
        if self._telemetry is not None:
            self._telemetry.log(
                name,
                TelemetryContext(
                    correlation_id=request.context.correlation_id,
                    tenant_id=request.context.tenant_id,
                    actor_id=request.context.actor_id,
                ),
                {
                    "provider": response.provider,
                    "model": response.model,
                    "decision": response.safety.decision.value,
                    "category": response.safety.category,
                    "candidateCount": response.usage.candidate_count,
                    "returnedCount": response.usage.returned_count,
                    "latencyMs": response.latency.latency_ms,
                    "estimatedCostUsd": response.usage.estimated_cost_usd,
                    "availability": response.availability.status.value,
                    "auditId": response.audit.audit_id,
                },
            )


class DeterministicRecommendations(_BaseRecommendations):
    """Stable local ranking fake; it never calls providers or echoes candidate content."""

    provider = "fake"

    def __init__(
        self,
        *,
        model: str = "fake-recommendations.v1",
        max_query_chars: int = 2_000,
        max_candidates: int = 100,
        max_latency_ms: int = 250,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: RecommendationRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_query_chars=max_query_chars,
            max_candidates=max_candidates,
            max_latency_ms=max_latency_ms,
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or RecommendationRetentionPolicy(),
            clock=clock or (lambda: 0),
        )

    @property
    def availability(self) -> AvailabilityDisposition:
        return AvailabilityDisposition(
            AvailabilityStatus.ALTERNATIVE,
            "deterministic local ranking is the tested no-credit alternative",
            "deterministic-local-ranking",
        )

    def _recommendations(self, request: RecommendationRequest) -> tuple[RecommendationItem, ...]:
        query_tokens = set(_tokens(request.query))
        ranked: list[tuple[float, RecommendationCandidate]] = []
        for item in request.candidates:
            searchable_tokens = set(_tokens(f"{item.title} {' '.join(item.tags)}"))
            score = round(len(query_tokens & searchable_tokens) / max(1, len(query_tokens)), 6)
            ranked.append((score, item))
        ranked.sort(key=lambda value: (-value[0], value[1].candidate_id))
        return tuple(
            RecommendationItem(
                candidate_id=item.candidate_id,
                rank=index,
                score=score,
                reason_code="token-overlap" if score else "deterministic-tie-break",
            )
            for index, (score, item) in enumerate(ranked[: request.limit], start=1)
        )


class BedrockRecommendations(_BaseRecommendations):
    """Bedrock recommendation port; provider I/O exists only through an injected transport."""

    provider = "bedrock"

    def __init__(
        self,
        transport: RecommendationTransport | None = None,
        *,
        active: bool = False,
        config_ref: str = "aws-secret-store:bedrock-recommendations",
        model: str = "amazon-recommendations.v1",
        max_query_chars: int = 2_000,
        max_candidates: int = 100,
        max_latency_ms: int = 250,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: RecommendationRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_query_chars=max_query_chars,
            max_candidates=max_candidates,
            max_latency_ms=max_latency_ms,
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or RecommendationRetentionPolicy(),
            clock=clock or (lambda: 0),
        )
        if not config_ref.strip():
            raise ValueError("Bedrock recommendation config reference is required")
        self._transport = transport
        self._active = active
        self.config_ref = config_ref

    @property
    def active(self) -> bool:
        return self._active

    @property
    def availability(self) -> AvailabilityDisposition:
        if self._active:
            return AvailabilityDisposition(
                AvailabilityStatus.ACTIVE,
                "Bedrock recommendation activation was explicitly enabled for injected transport",
            )
        return AvailabilityDisposition(
            AvailabilityStatus.GATED,
            "no approved AWS recommendation model or region is validated; credits, credentials, quota, and owner conformance are required",
            "deterministic-local-ranking",
        )

    def _recommendations(self, request: RecommendationRequest) -> tuple[RecommendationItem, ...]:
        if not self._active:
            raise ProviderUnavailableError(
                "Bedrock recommendation provider is gated until activation evidence exists"
            )
        if self._transport is None:
            raise ProviderUnavailableError(
                "Bedrock recommendation provider is active but transport is unavailable"
            )
        try:
            raw_items = tuple(self._transport(request))
        except Exception as error:
            raise RecommendationProviderError(
                "Bedrock recommendation provider request failed"
            ) from error
        try:
            normalized = tuple(
                value
                if isinstance(value, RecommendationItem)
                else RecommendationItem(
                    candidate_id=str(value[0]),
                    rank=index,
                    score=float(value[1]),
                    reason_code="provider-score",
                )
                for index, value in enumerate(raw_items[: request.limit], start=1)
            )
        except (TypeError, ValueError, IndexError) as error:
            raise RecommendationProviderError(
                "Bedrock recommendation provider returned invalid ranking"
            ) from error
        return normalized

    def _cost(self, request: RecommendationRequest) -> float:
        return round(max(1, len(request.query) + len(request.candidates) * 10) / 100_000, 8)


DeterministicRecommendation = DeterministicRecommendations
BedrockRecommendation = BedrockRecommendations


def _tokens(value: str) -> tuple[str, ...]:
    return tuple(RECOMMENDATION_TOKEN.findall(value.casefold()))


def _has_unsafe_control(value: str) -> bool:
    return any(ord(char) < 32 and char not in "\t\n\r" for char in value)


__all__ = [
    "NEUTRAL_USE_CASE",
    "RECOMMENDATION_OWNER",
    "AvailabilityDisposition",
    "AvailabilityStatus",
    "BedrockRecommendation",
    "BedrockRecommendations",
    "DeterministicRecommendation",
    "DeterministicRecommendations",
    "RecommendationCandidate",
    "RecommendationClient",
    "RecommendationContractError",
    "RecommendationItem",
    "RecommendationLatencyError",
    "RecommendationLatencyMetadata",
    "RecommendationProviderError",
    "RecommendationRequest",
    "RecommendationResponse",
    "RecommendationRetentionMetadata",
    "RecommendationRetentionPolicy",
    "RecommendationSafetyMetadata",
    "RecommendationTransport",
    "RecommendationUsageMetadata",
]
