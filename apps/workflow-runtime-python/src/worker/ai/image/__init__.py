"""Tenant-safe image generation/editing ports with deterministic asset staging."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Protocol

from worker.ai.guardrails import DeterministicGuardrail, SafetyAudit, SafetyDecision, SafetyRequest
from worker.ai.llm import ProviderUnavailableError
from worker.ai.quota import HardTenantQuota, QuotaReservation
from worker.langgraph.registry import RuntimeContext
from worker.telemetry.ports import TelemetryContext, TelemetryPort

SUPPORTED_IMAGE_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
CHECKSUM_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class ImageContractError(ValueError):
    """Raised when image input or output violates the typed media contract."""


class ImageProviderError(RuntimeError):
    """Raised after an injected image provider failure has been sanitized."""


class ImageAssetAccessError(PermissionError):
    """Raised when a staged image is accessed outside its tenant."""


class ImageOperation(StrEnum):
    GENERATE = "generate"
    EDIT = "edit"


class ImageAssetState(StrEnum):
    STAGED = "staged"
    PROMOTED = "promoted"


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
class ImageRetentionPolicy:
    retention_seconds: int = 86_400
    encryption_key_ref: str = "deterministic-local-image-key"
    algorithm: str = "deterministic-local-envelope.v1"

    def __post_init__(self) -> None:
        if self.retention_seconds < 0:
            raise ValueError("retention_seconds must be non-negative")
        if not self.encryption_key_ref.strip() or not self.algorithm.strip():
            raise ValueError("image retention metadata is incomplete")


@dataclass(frozen=True, slots=True)
class ImageRetentionMetadata:
    expires_at: int
    encrypted: bool
    key_ref: str
    algorithm: str


@dataclass(frozen=True, slots=True)
class ImageUsageMetadata:
    input_bytes: int
    output_bytes: int
    estimated_cost_usd: float
    currency: str = "USD"

    def __post_init__(self) -> None:
        if self.input_bytes < 0 or self.output_bytes < 0 or self.estimated_cost_usd < 0:
            raise ValueError("image usage metadata is invalid")
        if self.currency != "USD":
            raise ValueError("image usage currency must be USD")


@dataclass(frozen=True, slots=True)
class ImageLineageMetadata:
    tenant_id: str
    workspace_id: str
    actor_id: str
    correlation_id: str
    idempotency_key: str
    root_message_id: str
    source: str
    source_asset_id: str | None = None
    source_uri: str | None = None
    source_checksum: str | None = None


@dataclass(frozen=True, slots=True)
class ImageSafetyMetadata:
    decision: SafetyDecision
    category: str
    reason: str
    policy_version: str
    review_id: str | None = None


@dataclass(frozen=True, slots=True)
class ImageGenerationRequest:
    operation: str
    prompt: str
    context: RuntimeContext
    source_image: bytes | None = None
    source_asset_id: str | None = None
    source_uri: str | None = None
    source_checksum: str | None = None
    mime_type: str = "image/png"
    file_name: str | None = None
    model: str = "image-model.v1"

    def __post_init__(self) -> None:
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")
        try:
            operation = ImageOperation(self.operation)
        except ValueError as error:
            raise ImageContractError("image operation is unsupported") from error
        if not isinstance(self.prompt, str) or not self.prompt.strip():
            raise ImageContractError("image prompt is required")
        if not self.model.strip():
            raise ImageContractError("image model is required")
        normalized_mime = _normalize_mime(self.mime_type)
        if self.file_name and ("/" in self.file_name or "\\" in self.file_name):
            raise ImageContractError("image file name must not contain a path")
        source_fields = (
            self.source_image,
            self.source_asset_id,
            self.source_uri,
            self.source_checksum,
        )
        if any(value is not None for value in source_fields) and not all(
            value is not None for value in source_fields
        ):
            raise ImageContractError("image source lineage fields must be provided together")
        if operation is ImageOperation.EDIT and self.source_image is None:
            raise ImageContractError("image edit requires a source image")
        if self.source_uri is not None:
            _validate_source_uri(self.source_uri)
            if not self.source_asset_id or not self.source_asset_id.strip():
                raise ImageContractError("image source asset id is required")
            if not self.source_checksum or not CHECKSUM_PATTERN.fullmatch(self.source_checksum):
                raise ImageContractError("image source checksum is invalid")
            if hashlib.sha256(self.source_image or b"").hexdigest() != self.source_checksum:
                raise ImageContractError("image source checksum does not match B2 lineage")
        if self.source_image is not None and not isinstance(self.source_image, bytes):
            raise TypeError("image source must be bytes")
        object.__setattr__(self, "operation", operation.value)
        object.__setattr__(self, "mime_type", normalized_mime)
        object.__setattr__(self, "prompt", self.prompt.strip())


@dataclass(frozen=True, slots=True)
class ImageAsset:
    asset_id: str
    key: str
    data: bytes
    mime_type: str
    checksum: str
    tenant_id: str
    workspace_id: str
    state: str
    expires_at: int
    source_asset_id: str | None = None


@dataclass(frozen=True, slots=True)
class ImageResponse:
    operation: str
    assets: tuple[ImageAsset, ...]
    provider: str
    model: str
    usage: ImageUsageMetadata
    safety: ImageSafetyMetadata
    audit: SafetyAudit
    availability: AvailabilityDisposition
    lineage: ImageLineageMetadata
    retention: ImageRetentionMetadata


class ImageClient(Protocol):
    def generate(self, request: ImageGenerationRequest) -> ImageResponse: ...


class ImageAssetLifecycle(Protocol):
    def stage(
        self,
        context: RuntimeContext,
        data: bytes,
        *,
        mime_type: str,
        source_asset_id: str | None,
        expires_at: int,
    ) -> ImageAsset: ...

    def get(self, context: RuntimeContext, asset_id: str) -> ImageAsset | None: ...

    def promote(self, context: RuntimeContext, asset_id: str) -> ImageAsset: ...

    def cleanup(self, now: int) -> int: ...


class InMemoryImageAssetLifecycle:
    """Deterministic tenant-scoped staging fake; no object-storage or provider I/O."""

    def __init__(self) -> None:
        self.assets: dict[str, ImageAsset] = {}

    def stage(
        self,
        context: RuntimeContext,
        data: bytes,
        *,
        mime_type: str,
        source_asset_id: str | None,
        expires_at: int,
    ) -> ImageAsset:
        digest = hashlib.sha256(
            b"|".join(
                (
                    context.tenant_id.encode(),
                    context.lineage["rootMessageId"].encode(),
                    context.idempotency_key.encode(),
                    data,
                )
            )
        ).hexdigest()
        asset_id = f"image-{digest[:24]}"
        workspace_id = context.lineage.get("workspaceId", "workspace-default")
        asset = ImageAsset(
            asset_id=asset_id,
            key=f"staging/tenants/{context.tenant_id}/workspaces/{workspace_id}/assets/{asset_id}",
            data=bytes(data),
            mime_type=mime_type,
            checksum=hashlib.sha256(data).hexdigest(),
            tenant_id=context.tenant_id,
            workspace_id=workspace_id,
            state=ImageAssetState.STAGED.value,
            expires_at=expires_at,
            source_asset_id=source_asset_id,
        )
        self.assets[asset_id] = asset
        return asset

    def get(self, context: RuntimeContext, asset_id: str) -> ImageAsset | None:
        asset = self.assets.get(asset_id)
        if asset is not None and asset.tenant_id != context.tenant_id:
            raise ImageAssetAccessError("image asset belongs to another tenant")
        return asset

    def promote(self, context: RuntimeContext, asset_id: str) -> ImageAsset:
        asset = self.get(context, asset_id)
        if asset is None:
            raise KeyError("image asset was not found")
        if asset.state == ImageAssetState.PROMOTED.value:
            return asset
        promoted = replace(asset, state=ImageAssetState.PROMOTED.value)
        self.assets[asset_id] = promoted
        return promoted

    def cleanup(self, now: int) -> int:
        expired = [
            asset_id
            for asset_id, asset in self.assets.items()
            if asset.state == ImageAssetState.STAGED.value and asset.expires_at <= now
        ]
        for asset_id in expired:
            del self.assets[asset_id]
        return len(expired)


ImageTransport = Callable[[ImageGenerationRequest], bytes]


class _BaseImageGeneration:
    provider = "fake"

    def __init__(
        self,
        *,
        model: str,
        max_source_bytes: int,
        max_prompt_chars: int,
        max_output_bytes: int,
        lifecycle: ImageAssetLifecycle,
        quota: HardTenantQuota | None,
        telemetry: TelemetryPort | None,
        safety: DeterministicGuardrail | None,
        retention: ImageRetentionPolicy,
        clock: Callable[[], int],
    ) -> None:
        if (
            not model.strip()
            or max_source_bytes < 1
            or max_prompt_chars < 1
            or max_output_bytes < 1
        ):
            raise ValueError("image model and positive media/text bounds are required")
        self._model = model
        self._max_source_bytes = max_source_bytes
        self._max_prompt_chars = max_prompt_chars
        self._max_output_bytes = max_output_bytes
        self._lifecycle = lifecycle
        self._quota = quota
        self._telemetry = telemetry
        self._safety = safety or DeterministicGuardrail()
        self._retention = retention
        self._clock = clock

    def generate(
        self,
        request: ImageGenerationRequest,
        *,
        retention: ImageRetentionPolicy | None = None,
    ) -> ImageResponse:
        self._before_generate(request)
        self._validate(request)
        policy = retention or self._retention
        outcome = self._safety.evaluate(SafetyRequest(request.context, request.prompt))
        safety = ImageSafetyMetadata(
            decision=outcome.decision,
            category=outcome.category,
            reason=outcome.reason,
            policy_version=outcome.audit.policy_version,
            review_id=outcome.review_id,
        )
        if outcome.decision is not SafetyDecision.ALLOW:
            response = self._response(request, (), safety, outcome.audit, policy, 0.0)
            self._log("image.safety", request, response)
            return response

        cost_usd = self._cost(request)
        reservation = self._reserve(request, cost_usd)
        try:
            rendered = self._render(request)
            if not isinstance(rendered, bytes) or not rendered:
                raise ImageProviderError("image provider returned invalid image data")
            if len(rendered) > self._max_output_bytes:
                raise ImageProviderError(
                    "image provider returned image over the maximum configured size"
                )
            response = self._response(request, rendered, safety, outcome.audit, policy, cost_usd)
            self._finish(reservation, response)
            reservation = None
            self._log("image.completed", request, response)
            return response
        finally:
            self._release(reservation)

    def _before_generate(self, request: ImageGenerationRequest) -> None:
        del request

    def _validate(self, request: ImageGenerationRequest) -> None:
        if len(request.prompt) > self._max_prompt_chars:
            raise ImageContractError("image prompt exceeds maximum configured size")
        if request.mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
            raise ImageContractError("image output uses an unsupported media type")
        if request.source_image is not None:
            if not request.source_image:
                raise ImageContractError("image source payload must not be empty")
            if len(request.source_image) > self._max_source_bytes:
                raise ImageContractError("image source exceeds maximum configured size")
            if any(byte < 32 and byte not in (9, 10, 13) for byte in request.source_image):
                raise ImageContractError("image source contains unsafe control content")
        if any(ord(char) < 32 and char not in "\t\n\r" for char in request.prompt):
            raise ImageContractError("image prompt contains unsafe control content")
        if request.context.tenant_id != request.context.tenant_id.strip():
            raise ImageContractError("image tenant context is invalid")

    def _response(
        self,
        request: ImageGenerationRequest,
        rendered: bytes | tuple[ImageAsset, ...],
        safety: ImageSafetyMetadata,
        audit: SafetyAudit,
        retention: ImageRetentionPolicy,
        cost_usd: float,
    ) -> ImageResponse:
        expires_at = self._clock() + retention.retention_seconds
        assets: tuple[ImageAsset, ...]
        if isinstance(rendered, tuple):
            assets = rendered
            output_bytes = sum(len(asset.data) for asset in assets)
        else:
            staged = self._lifecycle.stage(
                request.context,
                rendered,
                mime_type=request.mime_type,
                source_asset_id=request.source_asset_id,
                expires_at=expires_at,
            )
            assets = (staged,)
            output_bytes = len(rendered)
        return ImageResponse(
            operation=request.operation,
            assets=assets,
            provider=self.provider,
            model=request.model or self._model,
            usage=ImageUsageMetadata(
                input_bytes=len(request.source_image or b""),
                output_bytes=output_bytes,
                estimated_cost_usd=cost_usd,
            ),
            safety=safety,
            audit=audit,
            availability=self.availability,
            lineage=ImageLineageMetadata(
                tenant_id=request.context.tenant_id,
                workspace_id=request.context.lineage.get("workspaceId", "workspace-default"),
                actor_id=request.context.actor_id,
                correlation_id=request.context.correlation_id,
                idempotency_key=request.context.idempotency_key,
                root_message_id=request.context.lineage["rootMessageId"],
                source=request.context.lineage["source"],
                source_asset_id=request.source_asset_id,
                source_uri=request.source_uri,
                source_checksum=request.source_checksum,
            ),
            retention=ImageRetentionMetadata(
                expires_at=expires_at,
                encrypted=True,
                key_ref=retention.encryption_key_ref,
                algorithm=retention.algorithm,
            ),
        )

    def _cost(self, request: ImageGenerationRequest) -> float:
        del request
        return 0.0

    def _reserve(self, request: ImageGenerationRequest, cost_usd: float) -> QuotaReservation | None:
        if self._quota is None:
            return None
        return self._quota.reserve(
            request.context.tenant_id,
            requests=1,
            tokens=max(1, len(request.prompt) // 4 + len(request.source_image or b"") // 1024),
            cost_usd=cost_usd,
        )

    def _finish(self, reservation: QuotaReservation | None, response: ImageResponse) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.commit(
                reservation,
                tokens=max(1, response.usage.output_bytes),
                cost_usd=response.usage.estimated_cost_usd,
            )

    def _release(self, reservation: QuotaReservation | None) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.release(reservation)

    def _log(self, name: str, request: ImageGenerationRequest, response: ImageResponse) -> None:
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
                    "operation": response.operation,
                    "decision": response.safety.decision.value,
                    "category": response.safety.category,
                    "assetCount": len(response.assets),
                    "inputBytes": response.usage.input_bytes,
                    "outputBytes": response.usage.output_bytes,
                    "estimatedCostUsd": response.usage.estimated_cost_usd,
                    "availability": response.availability.status.value,
                    "auditId": response.audit.audit_id,
                },
            )

    def _render(self, request: ImageGenerationRequest) -> bytes:
        raise NotImplementedError


class DeterministicImageGeneration(_BaseImageGeneration):
    """Stable local image fake; output is digest-derived and never includes prompt bytes."""

    provider = "fake"

    def __init__(
        self,
        *,
        model: str = "fake-image.v1",
        max_source_bytes: int = 10 * 1024 * 1024,
        max_prompt_chars: int = 2_000,
        max_output_bytes: int = 10 * 1024 * 1024,
        lifecycle: ImageAssetLifecycle | None = None,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: ImageRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_source_bytes=max_source_bytes,
            max_prompt_chars=max_prompt_chars,
            max_output_bytes=max_output_bytes,
            lifecycle=lifecycle or InMemoryImageAssetLifecycle(),
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or ImageRetentionPolicy(),
            clock=clock or (lambda: 0),
        )

    @property
    def availability(self) -> AvailabilityDisposition:
        return AvailabilityDisposition(
            AvailabilityStatus.ALTERNATIVE,
            "deterministic local image generation/editing is the tested no-credit alternative",
            "deterministic-local-image",
        )

    def _render(self, request: ImageGenerationRequest) -> bytes:
        source_digest = hashlib.sha256(request.source_image or b"").hexdigest()
        digest = hashlib.sha256(
            f"image.v1|{request.operation}|{request.context.tenant_id}|{request.prompt}|{source_digest}".encode()
        ).hexdigest()
        return f"deterministic-image:{digest}".encode()


class BedrockImageGeneration(_BaseImageGeneration):
    """Bedrock image port; provider I/O exists only through an injected transport."""

    provider = "bedrock"

    def __init__(
        self,
        transport: ImageTransport | None = None,
        *,
        active: bool = False,
        config_ref: str = "aws-secret-store:bedrock-image-generation",
        model: str = "amazon-image.v1",
        max_source_bytes: int = 10 * 1024 * 1024,
        max_prompt_chars: int = 2_000,
        max_output_bytes: int = 10 * 1024 * 1024,
        lifecycle: ImageAssetLifecycle | None = None,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: ImageRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_source_bytes=max_source_bytes,
            max_prompt_chars=max_prompt_chars,
            max_output_bytes=max_output_bytes,
            lifecycle=lifecycle or InMemoryImageAssetLifecycle(),
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or ImageRetentionPolicy(),
            clock=clock or (lambda: 0),
        )
        if not config_ref.strip():
            raise ValueError("Bedrock image config reference is required")
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
                "Bedrock image activation was explicitly enabled for injected transport",
            )
        return AvailabilityDisposition(
            AvailabilityStatus.GATED,
            "no approved AWS image model or region is validated; credits, credentials, quota, and owner conformance are required",
            "deterministic-local-image",
        )

    def _before_generate(self, request: ImageGenerationRequest) -> None:
        if not self._active:
            self._log_unavailable(request)
            raise ProviderUnavailableError(
                "Bedrock image provider is gated until activation evidence exists"
            )
        if self._transport is None:
            self._log_unavailable(request)
            raise ProviderUnavailableError(
                "Bedrock image provider is active but transport is unavailable"
            )

    def _render(self, request: ImageGenerationRequest) -> bytes:
        try:
            rendered = self._transport(request) if self._transport is not None else None
        except Exception as error:
            raise ImageProviderError("Bedrock image provider request failed") from error
        if not isinstance(rendered, bytes) or not rendered:
            raise ImageProviderError("Bedrock image provider returned invalid image data")
        return rendered

    def _cost(self, request: ImageGenerationRequest) -> float:
        return round(
            max(1, len(request.prompt) + len(request.source_image or b"")) / 1_000_000 * 0.04, 8
        )

    def _log_unavailable(self, request: ImageGenerationRequest) -> None:
        if self._telemetry is not None:
            self._telemetry.log(
                "image.unavailable",
                TelemetryContext(
                    correlation_id=request.context.correlation_id,
                    tenant_id=request.context.tenant_id,
                    actor_id=request.context.actor_id,
                ),
                {"provider": self.provider, "availability": self.availability.status.value},
            )


DeterministicImage = DeterministicImageGeneration
BedrockImage = BedrockImageGeneration
ImageRequest = ImageGenerationRequest
ImageResponseContract = ImageResponse


def _normalize_mime(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ImageContractError("image media type is required")
    normalized = value.split(";", 1)[0].strip().lower()
    if normalized == "image/jpg":
        normalized = "image/jpeg"
    if normalized not in SUPPORTED_IMAGE_MIME_TYPES:
        raise ImageContractError("image output uses an unsupported media type")
    return normalized


def _validate_source_uri(value: str) -> None:
    if not value.startswith("b2://") or ".." in value.split("b2://", 1)[1].split("/"):
        raise ImageContractError("image source URI must remain under the B2 boundary")


__all__ = [
    "SUPPORTED_IMAGE_MIME_TYPES",
    "AvailabilityDisposition",
    "AvailabilityStatus",
    "BedrockImage",
    "BedrockImageGeneration",
    "DeterministicImage",
    "DeterministicImageGeneration",
    "ImageAsset",
    "ImageAssetAccessError",
    "ImageAssetLifecycle",
    "ImageAssetState",
    "ImageClient",
    "ImageContractError",
    "ImageGenerationRequest",
    "ImageLineageMetadata",
    "ImageOperation",
    "ImageProviderError",
    "ImageRequest",
    "ImageResponse",
    "ImageResponseContract",
    "ImageRetentionMetadata",
    "ImageRetentionPolicy",
    "ImageSafetyMetadata",
    "ImageTransport",
    "ImageUsageMetadata",
    "InMemoryImageAssetLifecycle",
]
