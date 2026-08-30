"""Tenant-safe, provider-neutral translation ports and deterministic fakes."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from worker.ai.guardrails import DeterministicGuardrail, SafetyDecision, SafetyRequest
from worker.ai.llm import LineageMetadata, ProviderUnavailableError
from worker.ai.quota import HardTenantQuota, QuotaReservation
from worker.langgraph.registry import RuntimeContext
from worker.telemetry.ports import TelemetryContext, TelemetryPort


class TranslationContractError(ValueError):
    """Raised when translation input is outside the typed contract bounds."""


class TranslationSafetyError(PermissionError):
    """Raised when the safety policy denies or escalates translation content."""


class TranslationProviderError(RuntimeError):
    """Raised after a provider failure has been sanitized."""


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
class TranslationRetentionPolicy:
    retention_seconds: int = 86_400
    encryption_key_ref: str = "deterministic-local-translation-key"
    algorithm: str = "deterministic-local-envelope.v1"

    def __post_init__(self) -> None:
        if self.retention_seconds < 0:
            raise ValueError("retention_seconds must be non-negative")
        if not self.encryption_key_ref.strip() or not self.algorithm.strip():
            raise ValueError("translation retention metadata is incomplete")


@dataclass(frozen=True, slots=True)
class TranslationRetentionMetadata:
    expires_at: int
    encrypted: bool
    key_ref: str
    algorithm: str


@dataclass(frozen=True, slots=True)
class TranslationUsageMetadata:
    input_characters: int
    output_characters: int
    estimated_cost_usd: float
    currency: str = "USD"

    def __post_init__(self) -> None:
        if self.input_characters < 0 or self.output_characters < 0:
            raise ValueError("Translation character counts cannot be negative")
        if self.estimated_cost_usd < 0:
            raise ValueError("Estimated translation cost cannot be negative")


@dataclass(frozen=True, slots=True)
class TranslationSafetyMetadata:
    decision: SafetyDecision
    category: str
    policy_version: str


@dataclass(frozen=True, slots=True)
class TranslationRequest:
    text: str
    source_language: str
    target_language: str
    context: RuntimeContext
    model: str = "translation-model.v1"

    def __post_init__(self) -> None:
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")
        if not isinstance(self.text, str) or not self.text.strip():
            raise TranslationContractError("translation text is required")
        if not self.model.strip():
            raise TranslationContractError("translation model is required")
        source = normalize_language(self.source_language, allow_auto=True)
        target = normalize_language(self.target_language)
        if source != "auto" and source == target:
            raise TranslationContractError("source and target languages must be different")
        object.__setattr__(self, "source_language", source)
        object.__setattr__(self, "target_language", target)


@dataclass(frozen=True, slots=True)
class TranslationResponse:
    translated_text: str
    provider: str
    model: str
    source_language: str
    target_language: str
    usage: TranslationUsageMetadata
    safety: TranslationSafetyMetadata
    availability: AvailabilityDisposition
    lineage: LineageMetadata
    retention: TranslationRetentionMetadata


class TranslationClient(Protocol):
    def translate(self, request: TranslationRequest) -> TranslationResponse: ...


TranslationTransport = Callable[[TranslationRequest], str]


class _BaseTranslation:
    provider = "fake"

    def __init__(
        self,
        *,
        model: str,
        max_text_chars: int,
        quota: HardTenantQuota | None,
        telemetry: TelemetryPort | None,
        safety: DeterministicGuardrail | None,
        retention: TranslationRetentionPolicy,
        clock: Callable[[], int],
    ) -> None:
        if not model.strip() or max_text_chars < 1:
            raise ValueError("translation model and positive text bound are required")
        self._model = model
        self._max_text_chars = max_text_chars
        self._quota = quota
        self._telemetry = telemetry
        self._safety = safety or DeterministicGuardrail()
        self._retention = retention
        self._clock = clock

    def _validate(self, request: TranslationRequest) -> str:
        if len(request.text) > self._max_text_chars:
            raise TranslationContractError("translation text exceeds maximum configured size")
        if request.context.tenant_id != request.context.tenant_id.strip():
            raise TranslationContractError("translation tenant context is invalid")
        return request.text.strip()

    def _check_safety(self, request: TranslationRequest) -> TranslationSafetyMetadata:
        outcome = self._safety.evaluate(SafetyRequest(request.context, request.text))
        if outcome.decision is not SafetyDecision.ALLOW:
            self._log(
                "translation.safety_denied",
                request,
                {"category": outcome.category, "decision": outcome.decision.value},
            )
            raise TranslationSafetyError("translation safety policy denied or escalated content")
        return TranslationSafetyMetadata(
            decision=outcome.decision,
            category=outcome.category,
            policy_version=outcome.audit.policy_version,
        )

    def _response(
        self,
        request: TranslationRequest,
        text: str,
        safety: TranslationSafetyMetadata,
        cost_usd: float,
    ) -> TranslationResponse:
        return TranslationResponse(
            translated_text=text,
            provider=self.provider,
            model=request.model or self._model,
            source_language=request.source_language,
            target_language=request.target_language,
            usage=TranslationUsageMetadata(len(request.text), len(text), cost_usd),
            safety=safety,
            availability=self.availability,
            lineage=LineageMetadata.from_context(request.context),
            retention=TranslationRetentionMetadata(
                expires_at=self._clock() + self._retention.retention_seconds,
                encrypted=True,
                key_ref=self._retention.encryption_key_ref,
                algorithm=self._retention.algorithm,
            ),
        )

    def _reserve(self, request: TranslationRequest, cost_usd: float) -> QuotaReservation | None:
        if self._quota is None:
            return None
        return self._quota.reserve(
            request.context.tenant_id,
            requests=1,
            tokens=max(1, len(request.text.split())),
            cost_usd=cost_usd,
        )

    def _finish(
        self,
        request: TranslationRequest,
        reservation: QuotaReservation | None,
        response: TranslationResponse,
    ) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.commit(
                reservation,
                tokens=max(1, len(request.text.split()) + len(response.translated_text.split())),
                cost_usd=response.usage.estimated_cost_usd,
            )

    def _release(self, reservation: QuotaReservation | None) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.release(reservation)

    def _log(self, name: str, request: TranslationRequest, attributes: dict[str, object]) -> None:
        if self._telemetry is not None:
            self._telemetry.log(
                name,
                TelemetryContext(
                    correlation_id=request.context.correlation_id,
                    tenant_id=request.context.tenant_id,
                    actor_id=request.context.actor_id,
                ),
                attributes,
            )


class DeterministicTranslation(_BaseTranslation):
    """Stable local fake; it never calls a provider or records source text."""

    provider = "fake"

    def __init__(
        self,
        *,
        model: str = "fake-translation.v1",
        max_text_chars: int = 8_000,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: TranslationRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_text_chars=max_text_chars,
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or TranslationRetentionPolicy(),
            clock=clock or (lambda: 0),
        )

    @property
    def availability(self) -> AvailabilityDisposition:
        return AvailabilityDisposition(
            AvailabilityStatus.ALTERNATIVE,
            "deterministic local translation is the tested no-credit alternative",
            "bedrock",
        )

    def translate(self, request: TranslationRequest) -> TranslationResponse:
        self._validate(request)
        safety = self._check_safety(request)
        reservation = self._reserve(request, 0.0)
        try:
            response = self._response(
                request,
                f"[{request.target_language}] {request.text.strip()}",
                safety,
                0.0,
            )
            self._finish(request, reservation, response)
            reservation = None
            self._log(
                "translation.completed",
                request,
                {
                    "provider": response.provider,
                    "model": response.model,
                    "sourceLanguage": response.source_language,
                    "targetLanguage": response.target_language,
                    "inputCharacters": response.usage.input_characters,
                    "outputCharacters": response.usage.output_characters,
                    "availability": response.availability.status.value,
                },
            )
            return response
        finally:
            self._release(reservation)


class BedrockTranslation(_BaseTranslation):
    """Bedrock port; transport injection is the only path to provider I/O."""

    provider = "bedrock"

    def __init__(
        self,
        transport: TranslationTransport | None = None,
        *,
        active: bool = False,
        config_ref: str = "aws-secret-store:bedrock-translation",
        model: str = "amazon-translate.v1",
        max_text_chars: int = 8_000,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: TranslationRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_text_chars=max_text_chars,
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or TranslationRetentionPolicy(),
            clock=clock or (lambda: 0),
        )
        if not config_ref.strip():
            raise ValueError("Bedrock translation config reference is required")
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
                "Bedrock translation activation was explicitly enabled for injected transport",
            )
        return AvailabilityDisposition(
            AvailabilityStatus.GATED,
            "Bedrock translation requires credits, credentials, region, quota, and owner-approved live conformance",
            "deterministic-local-translation",
        )

    def translate(self, request: TranslationRequest) -> TranslationResponse:
        if not self._active:
            self._log(
                "translation.unavailable",
                request,
                {"provider": self.provider, "availability": self.availability.status.value},
            )
            raise ProviderUnavailableError(
                "Bedrock translation provider is gated until activation evidence exists"
            )
        if self._transport is None:
            self._log(
                "translation.unavailable",
                request,
                {"provider": self.provider, "availability": self.availability.status.value},
            )
            raise ProviderUnavailableError(
                "Bedrock translation provider is active but transport is unavailable"
            )
        self._validate(request)
        safety = self._check_safety(request)
        cost_usd = round(max(1, len(request.text)) / 100_000, 8)
        reservation = self._reserve(request, cost_usd)
        try:
            try:
                translated = self._transport(request)
            except Exception as error:
                raise TranslationProviderError(
                    "Bedrock translation provider request failed"
                ) from error
            if not isinstance(translated, str) or not translated.strip():
                raise TranslationProviderError("Bedrock translation provider returned no text")
            response = self._response(request, translated.strip(), safety, cost_usd)
            self._finish(request, reservation, response)
            reservation = None
            self._log(
                "translation.completed",
                request,
                {
                    "provider": response.provider,
                    "model": response.model,
                    "sourceLanguage": response.source_language,
                    "targetLanguage": response.target_language,
                    "inputCharacters": response.usage.input_characters,
                    "outputCharacters": response.usage.output_characters,
                    "availability": response.availability.status.value,
                },
            )
            return response
        finally:
            self._release(reservation)


def normalize_language(value: str, *, allow_auto: bool = False) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TranslationContractError("language is required")
    normalized = value.strip().replace("_", "-")
    if allow_auto and normalized.casefold() == "auto":
        return "auto"
    if not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-[A-Za-z]{2}|-[0-9]{3})?", normalized):
        raise TranslationContractError("language must be a valid BCP-47 tag")
    parts = normalized.split("-")
    canonical = [parts[0].lower()]
    for part in parts[1:]:
        canonical.append(part.title() if len(part) == 4 else part.upper())
    return "-".join(canonical)


__all__ = [
    "AvailabilityDisposition",
    "AvailabilityStatus",
    "BedrockTranslation",
    "DeterministicTranslation",
    "TranslationClient",
    "TranslationContractError",
    "TranslationProviderError",
    "TranslationRequest",
    "TranslationResponse",
    "TranslationRetentionMetadata",
    "TranslationRetentionPolicy",
    "TranslationSafetyError",
    "TranslationSafetyMetadata",
    "TranslationUsageMetadata",
    "normalize_language",
]
