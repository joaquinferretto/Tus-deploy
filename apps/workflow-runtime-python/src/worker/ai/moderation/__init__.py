"""Tenant-safe moderation and labels ports with deterministic local fakes."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from worker.ai.guardrails import (
    DeterministicGuardrail,
    InMemoryHumanReviewQueue,
    SafetyAudit,
    SafetyDecision,
    SafetyRequest,
)
from worker.ai.llm import ProviderUnavailableError
from worker.ai.privacy import redact_text
from worker.ai.quota import HardTenantQuota, QuotaReservation
from worker.langgraph.registry import RuntimeContext
from worker.telemetry.ports import TelemetryContext, TelemetryPort

SUPPORTED_MODERATION_CONTENT_TYPES = frozenset({"text/plain", "text/markdown", "application/json"})


class ModerationContractError(ValueError):
    """Raised when moderation input or output violates its typed contract."""


class ModerationProviderError(RuntimeError):
    """Raised after an injected moderation provider failure is sanitized."""


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
class ModerationRetentionPolicy:
    retention_seconds: int = 86_400
    encryption_key_ref: str = "deterministic-local-moderation-key"
    algorithm: str = "deterministic-local-envelope.v1"

    def __post_init__(self) -> None:
        if self.retention_seconds < 0:
            raise ValueError("retention_seconds must be non-negative")
        if not self.encryption_key_ref.strip() or not self.algorithm.strip():
            raise ValueError("moderation retention metadata is incomplete")


@dataclass(frozen=True, slots=True)
class ModerationRetentionMetadata:
    expires_at: int
    encrypted: bool
    key_ref: str
    algorithm: str


@dataclass(frozen=True, slots=True)
class ModerationUsageMetadata:
    input_characters: int
    output_labels: int
    estimated_cost_usd: float
    currency: str = "USD"

    def __post_init__(self) -> None:
        if self.input_characters < 0 or self.output_labels < 1:
            raise ValueError("moderation usage counts are invalid")
        if self.estimated_cost_usd < 0:
            raise ValueError("Estimated moderation cost cannot be negative")


@dataclass(frozen=True, slots=True)
class ModerationLabel:
    name: str
    confidence: float

    def __post_init__(self) -> None:
        if not self.name.strip() or not 0 <= self.confidence <= 1:
            raise ModerationContractError("moderation label is invalid")


@dataclass(frozen=True, slots=True)
class ModerationSafetyMetadata:
    decision: SafetyDecision
    category: str
    reason: str
    policy_version: str
    review_id: str | None = None


@dataclass(frozen=True, slots=True)
class ModerationLineageMetadata:
    tenant_id: str
    actor_id: str
    correlation_id: str
    root_message_id: str
    source: str


@dataclass(frozen=True, slots=True)
class ModerationRequest:
    content: str
    context: RuntimeContext
    content_type: str = "text/plain"
    file_name: str | None = None
    model: str = "moderation-model.v1"

    def __post_init__(self) -> None:
        if not isinstance(self.content, str) or not self.content.strip():
            raise ModerationContractError("moderation content is required")
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")
        if not self.model.strip():
            raise ModerationContractError("moderation model is required")
        if self.file_name and ("/" in self.file_name or "\\" in self.file_name):
            raise ModerationContractError("moderation file name must not contain a path")
        object.__setattr__(self, "content_type", _normalize_content_type(self.content_type))


@dataclass(frozen=True, slots=True)
class ModerationResponse:
    redacted_content: str
    labels: tuple[ModerationLabel, ...]
    provider: str
    model: str
    usage: ModerationUsageMetadata
    safety: ModerationSafetyMetadata
    audit: SafetyAudit
    availability: AvailabilityDisposition
    lineage: ModerationLineageMetadata
    retention: ModerationRetentionMetadata
    review_id: str | None = None


class ModerationClient(Protocol):
    def moderate(self, request: ModerationRequest) -> ModerationResponse: ...


ModerationTransport = Callable[[ModerationRequest], Iterable[ModerationLabel | tuple[str, float]]]


class _BaseModeration:
    provider = "fake"

    def __init__(
        self,
        *,
        model: str,
        max_content_chars: int,
        max_labels: int,
        quota: HardTenantQuota | None,
        telemetry: TelemetryPort | None,
        guardrail: DeterministicGuardrail | None,
        review_queue: InMemoryHumanReviewQueue | None,
        retention: ModerationRetentionPolicy,
        clock: Callable[[], int],
    ) -> None:
        if not model.strip() or max_content_chars < 1 or max_labels < 1:
            raise ValueError("moderation model and positive content/label bounds are required")
        self._model = model
        self._max_content_chars = max_content_chars
        self._max_labels = max_labels
        self._quota = quota
        self._telemetry = telemetry
        self._guardrail = guardrail or DeterministicGuardrail(review_queue=review_queue)
        self._retention = retention
        self._clock = clock
        self._audits: list[SafetyAudit] = []

    def moderate(self, request: ModerationRequest) -> ModerationResponse:
        self._validate(request)
        outcome = self._guardrail.evaluate(SafetyRequest(request.context, request.content))
        self._audits.append(outcome.audit)
        safety = ModerationSafetyMetadata(
            decision=outcome.decision,
            category=outcome.category,
            reason=outcome.reason,
            policy_version=outcome.audit.policy_version,
            review_id=outcome.review_id,
        )
        if outcome.decision is not SafetyDecision.ALLOW:
            response = self._build_response(
                request,
                (ModerationLabel(outcome.category, 1.0),),
                safety,
                outcome.audit,
                outcome.redacted_content,
                0.0,
            )
            self._log("moderation.safety", request, response)
            return response

        labels = self._labels(request)
        cost_usd = self._cost(request)
        reservation = self._reserve(request, cost_usd)
        try:
            response = self._build_response(
                request,
                labels,
                safety,
                outcome.audit,
                outcome.redacted_content,
                cost_usd,
            )
            self._finish(reservation, response)
            reservation = None
            self._log("moderation.completed", request, response)
            return response
        finally:
            self._release(reservation)

    def audit_log(self, context: RuntimeContext) -> tuple[SafetyAudit, ...]:
        return tuple(audit for audit in self._audits if audit.tenant_id == context.tenant_id)

    def _validate(self, request: ModerationRequest) -> None:
        if len(request.content) > self._max_content_chars:
            raise ModerationContractError("moderation content exceeds maximum configured size")
        if request.content_type not in SUPPORTED_MODERATION_CONTENT_TYPES:
            raise ModerationContractError("moderation content uses an unsupported media type")
        if any(ord(char) < 32 and char not in "\t\n\r" for char in request.content):
            raise ModerationContractError("moderation content contains unsafe control content")
        if request.context.tenant_id != request.context.tenant_id.strip():
            raise ModerationContractError("moderation tenant context is invalid")

    def _labels(self, request: ModerationRequest) -> tuple[ModerationLabel, ...]:
        raise NotImplementedError

    def _cost(self, request: ModerationRequest) -> float:
        return 0.0

    def _build_response(
        self,
        request: ModerationRequest,
        labels: Iterable[ModerationLabel],
        safety: ModerationSafetyMetadata,
        audit: SafetyAudit,
        redacted_content: str,
        cost_usd: float,
    ) -> ModerationResponse:
        normalized = tuple(labels)
        if not normalized or len(normalized) > self._max_labels:
            raise ModerationProviderError("moderation provider returned invalid labels")
        return ModerationResponse(
            redacted_content=redact_text(redacted_content),
            labels=normalized,
            provider=self.provider,
            model=request.model or self._model,
            usage=ModerationUsageMetadata(
                input_characters=len(request.content),
                output_labels=len(normalized),
                estimated_cost_usd=cost_usd,
            ),
            safety=safety,
            audit=audit,
            availability=self.availability,
            lineage=ModerationLineageMetadata(
                tenant_id=request.context.tenant_id,
                actor_id=request.context.actor_id,
                correlation_id=request.context.correlation_id,
                root_message_id=request.context.lineage["rootMessageId"],
                source=request.context.lineage["source"],
            ),
            retention=ModerationRetentionMetadata(
                expires_at=self._clock() + self._retention.retention_seconds,
                encrypted=True,
                key_ref=self._retention.encryption_key_ref,
                algorithm=self._retention.algorithm,
            ),
            review_id=safety.review_id,
        )

    def _reserve(self, request: ModerationRequest, cost_usd: float) -> QuotaReservation | None:
        if self._quota is None:
            return None
        return self._quota.reserve(
            request.context.tenant_id,
            requests=1,
            tokens=0,
            cost_usd=cost_usd,
        )

    def _finish(self, reservation: QuotaReservation | None, response: ModerationResponse) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.commit(
                reservation,
                tokens=response.usage.output_labels,
                cost_usd=response.usage.estimated_cost_usd,
            )

    def _release(self, reservation: QuotaReservation | None) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.release(reservation)

    def _log(self, name: str, request: ModerationRequest, response: ModerationResponse) -> None:
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
                    "labelCount": response.usage.output_labels,
                    "availability": response.availability.status.value,
                    "auditId": response.audit.audit_id,
                    "reviewId": response.review_id,
                },
            )


class DeterministicModeration(_BaseModeration):
    """Stable local moderation fake; it never calls a provider or echoes raw payloads."""

    provider = "fake"

    def __init__(
        self,
        *,
        model: str = "fake-moderation.v1",
        max_content_chars: int = 20_000,
        max_labels: int = 16,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        guardrail: DeterministicGuardrail | None = None,
        review_queue: InMemoryHumanReviewQueue | None = None,
        retention: ModerationRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_content_chars=max_content_chars,
            max_labels=max_labels,
            quota=quota,
            telemetry=telemetry,
            guardrail=guardrail,
            review_queue=review_queue,
            retention=retention or ModerationRetentionPolicy(),
            clock=clock or (lambda: 0),
        )

    @property
    def availability(self) -> AvailabilityDisposition:
        return AvailabilityDisposition(
            AvailabilityStatus.ALTERNATIVE,
            "deterministic local moderation is the tested no-credit alternative",
            "bedrock",
        )

    def _labels(self, request: ModerationRequest) -> tuple[ModerationLabel, ...]:
        return (ModerationLabel("safe", 1.0),)


class BedrockModeration(_BaseModeration):
    """Bedrock moderation port; provider I/O exists only through an injected transport."""

    provider = "bedrock"

    def __init__(
        self,
        transport: ModerationTransport | None = None,
        *,
        active: bool = False,
        config_ref: str = "aws-secret-store:bedrock-moderation",
        model: str = "amazon-moderation.v1",
        max_content_chars: int = 20_000,
        max_labels: int = 16,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        guardrail: DeterministicGuardrail | None = None,
        review_queue: InMemoryHumanReviewQueue | None = None,
        retention: ModerationRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_content_chars=max_content_chars,
            max_labels=max_labels,
            quota=quota,
            telemetry=telemetry,
            guardrail=guardrail,
            review_queue=review_queue,
            retention=retention or ModerationRetentionPolicy(),
            clock=clock or (lambda: 0),
        )
        if not config_ref.strip():
            raise ValueError("Bedrock moderation config reference is required")
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
                "Bedrock moderation activation was explicitly enabled for injected transport",
            )
        return AvailabilityDisposition(
            AvailabilityStatus.GATED,
            "Bedrock moderation requires credits, credentials, region, quota, and owner-approved live conformance",
            "deterministic-local-moderation",
        )

    def _labels(self, request: ModerationRequest) -> tuple[ModerationLabel, ...]:
        if not self._active:
            raise ProviderUnavailableError(
                "Bedrock moderation provider is gated until activation evidence exists"
            )
        if self._transport is None:
            raise ProviderUnavailableError(
                "Bedrock moderation provider is active but transport is unavailable"
            )
        try:
            raw_labels = tuple(self._transport(request))
        except Exception as error:
            raise ModerationProviderError("Bedrock moderation provider request failed") from error
        try:
            labels = tuple(
                value if isinstance(value, ModerationLabel) else ModerationLabel(*value)
                for value in raw_labels
            )
        except (TypeError, ValueError) as error:
            raise ModerationProviderError(
                "Bedrock moderation provider returned invalid labels"
            ) from error
        if not labels or len(labels) > self._max_labels:
            raise ModerationProviderError("Bedrock moderation provider returned invalid labels")
        return labels

    def _cost(self, request: ModerationRequest) -> float:
        return round(len(request.content) / 1_000_000 * 0.001, 8)


DeterministicLabels = DeterministicModeration
ModerationAudit = SafetyAudit


def _normalize_content_type(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ModerationContractError("moderation content type is required")
    return value.split(";", 1)[0].strip().lower()


__all__ = [
    "SUPPORTED_MODERATION_CONTENT_TYPES",
    "AvailabilityDisposition",
    "AvailabilityStatus",
    "BedrockModeration",
    "DeterministicLabels",
    "DeterministicModeration",
    "ModerationAudit",
    "ModerationClient",
    "ModerationContractError",
    "ModerationLabel",
    "ModerationLineageMetadata",
    "ModerationProviderError",
    "ModerationRequest",
    "ModerationResponse",
    "ModerationRetentionMetadata",
    "ModerationRetentionPolicy",
    "ModerationSafetyMetadata",
    "ModerationTransport",
    "ModerationUsageMetadata",
]
