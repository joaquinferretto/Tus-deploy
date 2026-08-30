"""Tenant-safe, provider-neutral vision and multimodal input ports."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from worker.ai.guardrails import DeterministicGuardrail, SafetyDecision, SafetyRequest
from worker.ai.llm import LineageMetadata, ProviderUnavailableError
from worker.ai.quota import HardTenantQuota, QuotaReservation
from worker.langgraph.registry import RuntimeContext
from worker.telemetry.ports import TelemetryContext, TelemetryPort

SUPPORTED_VISION_MIME_TYPES = frozenset(
    {
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
    }
)


class VisionContractError(ValueError):
    """Raised when vision input or output violates the typed media contract."""


class VisionSafetyError(PermissionError):
    """Raised when the deterministic safety policy denies vision content."""


class VisionProviderError(RuntimeError):
    """Raised after an injected provider failure has been sanitized."""


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
class VisionRetentionPolicy:
    retention_seconds: int = 86_400
    encryption_key_ref: str = "deterministic-local-vision-key"
    algorithm: str = "deterministic-local-envelope.v1"

    def __post_init__(self) -> None:
        if self.retention_seconds < 0:
            raise ValueError("retention_seconds must be non-negative")
        if not self.encryption_key_ref.strip() or not self.algorithm.strip():
            raise ValueError("vision retention metadata is incomplete")


@dataclass(frozen=True, slots=True)
class VisionRetentionMetadata:
    expires_at: int
    encrypted: bool
    key_ref: str
    algorithm: str


@dataclass(frozen=True, slots=True)
class VisionUsageMetadata:
    input_bytes: int
    output_characters: int
    estimated_cost_usd: float
    currency: str = "USD"

    def __post_init__(self) -> None:
        if self.input_bytes < 0 or self.output_characters < 0:
            raise ValueError("Vision usage counts cannot be negative")
        if self.estimated_cost_usd < 0:
            raise ValueError("Estimated vision cost cannot be negative")


@dataclass(frozen=True, slots=True)
class VisionSafetyMetadata:
    decision: SafetyDecision
    category: str
    policy_version: str


@dataclass(frozen=True, slots=True)
class VisionRequest:
    image: bytes
    context: RuntimeContext
    mime_type: str = "image/png"
    file_name: str | None = None
    prompt: str | None = None
    model: str = "vision-model.v1"

    def __post_init__(self) -> None:
        if not isinstance(self.image, bytes):
            raise TypeError("vision image must be bytes")
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")
        if not self.model.strip():
            raise VisionContractError("vision model is required")
        if self.file_name and ("/" in self.file_name or "\\" in self.file_name):
            raise VisionContractError("vision file name must not contain a path")
        if self.prompt is not None and not isinstance(self.prompt, str):
            raise TypeError("vision prompt must be text")
        object.__setattr__(self, "mime_type", _normalize_mime(self.mime_type))
        if self.prompt is not None:
            object.__setattr__(self, "prompt", self.prompt.strip() or None)


@dataclass(frozen=True, slots=True)
class VisionResponse:
    analysis: str
    provider: str
    model: str
    mime_type: str
    usage: VisionUsageMetadata
    safety: VisionSafetyMetadata
    availability: AvailabilityDisposition
    lineage: LineageMetadata
    retention: VisionRetentionMetadata


class VisionClient(Protocol):
    def analyze(self, request: VisionRequest) -> VisionResponse: ...


VisionTransport = Callable[[VisionRequest], str]


class _BaseVision:
    provider = "fake"

    def __init__(
        self,
        *,
        model: str,
        max_image_bytes: int,
        max_prompt_chars: int,
        max_analysis_chars: int,
        quota: HardTenantQuota | None,
        telemetry: TelemetryPort | None,
        safety: DeterministicGuardrail | None,
        retention: VisionRetentionPolicy,
        clock: Callable[[], int],
    ) -> None:
        if (
            not model.strip()
            or max_image_bytes < 1
            or max_prompt_chars < 1
            or max_analysis_chars < 1
        ):
            raise ValueError("vision model and positive media/text bounds are required")
        self._model = model
        self._max_image_bytes = max_image_bytes
        self._max_prompt_chars = max_prompt_chars
        self._max_analysis_chars = max_analysis_chars
        self._quota = quota
        self._telemetry = telemetry
        self._safety = safety or DeterministicGuardrail()
        self._retention = retention
        self._clock = clock

    def _validate(self, request: VisionRequest) -> str | None:
        if not request.image:
            raise VisionContractError("vision image payload must not be empty")
        if len(request.image) > self._max_image_bytes:
            raise VisionContractError("vision image exceeds maximum configured size")
        if request.mime_type not in SUPPORTED_VISION_MIME_TYPES:
            raise VisionContractError("vision image uses an unsupported media type")
        if request.prompt is not None and len(request.prompt) > self._max_prompt_chars:
            raise VisionContractError("vision prompt exceeds maximum configured size")
        if request.context.tenant_id != request.context.tenant_id.strip():
            raise VisionContractError("vision tenant context is invalid")
        return request.prompt

    def _check_safety(self, request: VisionRequest) -> VisionSafetyMetadata:
        safety_text = request.prompt or "vision image analysis"
        outcome = self._safety.evaluate(SafetyRequest(request.context, safety_text))
        if outcome.decision is not SafetyDecision.ALLOW:
            self._log(
                "vision.safety_denied",
                request,
                {"category": outcome.category, "decision": outcome.decision.value},
            )
            raise VisionSafetyError("vision safety policy denied or escalated content")
        return VisionSafetyMetadata(
            decision=outcome.decision,
            category=outcome.category,
            policy_version=outcome.audit.policy_version,
        )

    def _response(
        self,
        request: VisionRequest,
        analysis: str,
        safety: VisionSafetyMetadata,
        cost_usd: float,
    ) -> VisionResponse:
        if not analysis.strip():
            raise VisionProviderError("vision provider returned no analysis")
        if len(analysis) > self._max_analysis_chars:
            raise VisionProviderError(
                "vision provider returned analysis over the maximum configured size"
            )
        return VisionResponse(
            analysis=analysis.strip(),
            provider=self.provider,
            model=request.model or self._model,
            mime_type=request.mime_type,
            usage=VisionUsageMetadata(
                input_bytes=len(request.image),
                output_characters=len(analysis.strip()),
                estimated_cost_usd=cost_usd,
            ),
            safety=safety,
            availability=self.availability,
            lineage=LineageMetadata.from_context(request.context),
            retention=VisionRetentionMetadata(
                expires_at=self._clock() + self._retention.retention_seconds,
                encrypted=True,
                key_ref=self._retention.encryption_key_ref,
                algorithm=self._retention.algorithm,
            ),
        )

    def _reserve(self, request: VisionRequest, cost_usd: float) -> QuotaReservation | None:
        if self._quota is None:
            return None
        return self._quota.reserve(
            request.context.tenant_id,
            requests=1,
            tokens=0,
            cost_usd=cost_usd,
        )

    def _finish(
        self,
        reservation: QuotaReservation | None,
        response: VisionResponse,
    ) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.commit(
                reservation,
                tokens=response.usage.output_characters,
                cost_usd=response.usage.estimated_cost_usd,
            )

    def _release(self, reservation: QuotaReservation | None) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.release(reservation)

    def _log(self, name: str, request: VisionRequest, attributes: dict[str, object]) -> None:
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


class DeterministicVision(_BaseVision):
    """Stable local fake; it never calls a provider or echoes image bytes."""

    provider = "fake"

    def __init__(
        self,
        *,
        model: str = "fake-vision.v1",
        max_image_bytes: int = 10 * 1024 * 1024,
        max_prompt_chars: int = 2_000,
        max_analysis_chars: int = 8_000,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: VisionRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_image_bytes=max_image_bytes,
            max_prompt_chars=max_prompt_chars,
            max_analysis_chars=max_analysis_chars,
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or VisionRetentionPolicy(),
            clock=clock or (lambda: 0),
        )

    @property
    def availability(self) -> AvailabilityDisposition:
        return AvailabilityDisposition(
            AvailabilityStatus.ALTERNATIVE,
            "deterministic local vision is the tested no-credit alternative",
            "bedrock",
        )

    def analyze(self, request: VisionRequest) -> VisionResponse:
        self._validate(request)
        safety = self._check_safety(request)
        reservation = self._reserve(request, 0.0)
        try:
            response = self._response(
                request,
                f"fake vision analysis: {request.mime_type} {len(request.image)} bytes",
                safety,
                0.0,
            )
            self._finish(reservation, response)
            reservation = None
            self._log(
                "vision.completed",
                request,
                {
                    "provider": response.provider,
                    "model": response.model,
                    "mimeType": response.mime_type,
                    "inputBytes": response.usage.input_bytes,
                    "outputCharacters": response.usage.output_characters,
                    "availability": response.availability.status.value,
                },
            )
            return response
        finally:
            self._release(reservation)


class BedrockVision(_BaseVision):
    """Bedrock vision port; provider I/O exists only through an injected transport."""

    provider = "bedrock"

    def __init__(
        self,
        transport: VisionTransport | None = None,
        *,
        active: bool = False,
        config_ref: str = "aws-secret-store:bedrock-vision",
        model: str = "amazon-vision.v1",
        max_image_bytes: int = 10 * 1024 * 1024,
        max_prompt_chars: int = 2_000,
        max_analysis_chars: int = 8_000,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: VisionRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_image_bytes=max_image_bytes,
            max_prompt_chars=max_prompt_chars,
            max_analysis_chars=max_analysis_chars,
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or VisionRetentionPolicy(),
            clock=clock or (lambda: 0),
        )
        if not config_ref.strip():
            raise ValueError("Bedrock vision config reference is required")
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
                "Bedrock vision activation was explicitly enabled for injected transport",
            )
        return AvailabilityDisposition(
            AvailabilityStatus.GATED,
            "Bedrock vision requires credits, credentials, region, quota, and owner-approved live conformance",
            "deterministic-local-vision",
        )

    def analyze(self, request: VisionRequest) -> VisionResponse:
        if not self._active:
            self._log(
                "vision.unavailable",
                request,
                {"provider": self.provider, "availability": self.availability.status.value},
            )
            raise ProviderUnavailableError(
                "Bedrock vision provider is gated until activation evidence exists"
            )
        if self._transport is None:
            self._log(
                "vision.unavailable",
                request,
                {"provider": self.provider, "availability": self.availability.status.value},
            )
            raise ProviderUnavailableError(
                "Bedrock vision provider is active but transport is unavailable"
            )
        self._validate(request)
        safety = self._check_safety(request)
        cost_usd = round(len(request.image) / 1_000_000 * 0.01, 8)
        reservation = self._reserve(request, cost_usd)
        try:
            try:
                analysis = self._transport(request)
            except Exception as error:
                raise VisionProviderError("Bedrock vision provider request failed") from error
            if not isinstance(analysis, str) or not analysis.strip():
                raise VisionProviderError("Bedrock vision provider returned no analysis")
            response = self._response(request, analysis, safety, cost_usd)
            self._finish(reservation, response)
            reservation = None
            self._log(
                "vision.completed",
                request,
                {
                    "provider": response.provider,
                    "model": response.model,
                    "mimeType": response.mime_type,
                    "inputBytes": response.usage.input_bytes,
                    "outputCharacters": response.usage.output_characters,
                    "availability": response.availability.status.value,
                },
            )
            return response
        finally:
            self._release(reservation)


def _normalize_mime(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise VisionContractError("vision media type is required")
    normalized = value.split(";", 1)[0].strip().lower()
    if normalized == "image/jpg":
        normalized = "image/jpeg"
    return normalized


__all__ = [
    "SUPPORTED_VISION_MIME_TYPES",
    "AvailabilityDisposition",
    "AvailabilityStatus",
    "BedrockVision",
    "DeterministicVision",
    "VisionClient",
    "VisionContractError",
    "VisionProviderError",
    "VisionRequest",
    "VisionResponse",
    "VisionRetentionMetadata",
    "VisionRetentionPolicy",
    "VisionSafetyError",
    "VisionSafetyMetadata",
    "VisionUsageMetadata",
]
