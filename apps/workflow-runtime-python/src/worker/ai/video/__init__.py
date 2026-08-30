"""Tenant-safe asynchronous video generation/editing with deterministic local execution."""

from __future__ import annotations

import asyncio
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

VIDEO_OWNER = "AI Platform / Runtime"
NEUTRAL_USE_CASE = "tenant-authorized generation and editing of reusable media across products"
SUPPORTED_VIDEO_MIME_TYPES = frozenset({"video/mp4", "video/webm"})
CHECKSUM_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class VideoContractError(ValueError):
    """Raised when video input or output violates the typed media contract."""


class VideoProviderError(RuntimeError):
    """Raised after an injected video provider failure has been sanitized."""


class VideoAssetAccessError(PermissionError):
    """Raised when a staged video is accessed outside its tenant."""


class VideoOperation(StrEnum):
    GENERATE = "generate"
    EDIT = "edit"


class VideoJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    DENIED = "denied"
    FAILED = "failed"
    EXPIRED = "expired"


class VideoAssetState(StrEnum):
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
class VideoRetentionPolicy:
    retention_seconds: int = 86_400
    encryption_key_ref: str = "deterministic-local-video-key"
    algorithm: str = "deterministic-local-envelope.v1"

    def __post_init__(self) -> None:
        if self.retention_seconds < 0:
            raise ValueError("retention_seconds must be non-negative")
        if not self.encryption_key_ref.strip() or not self.algorithm.strip():
            raise ValueError("video retention metadata is incomplete")


@dataclass(frozen=True, slots=True)
class VideoRetentionMetadata:
    expires_at: int
    encrypted: bool
    key_ref: str
    algorithm: str


@dataclass(frozen=True, slots=True)
class VideoUsageMetadata:
    input_bytes: int
    output_bytes: int
    duration_seconds: int
    estimated_cost_usd: float
    currency: str = "USD"

    def __post_init__(self) -> None:
        if (
            self.input_bytes < 0
            or self.output_bytes < 0
            or self.duration_seconds < 1
            or self.estimated_cost_usd < 0
        ):
            raise ValueError("video usage metadata is invalid")
        if self.currency != "USD":
            raise ValueError("video usage currency must be USD")


@dataclass(frozen=True, slots=True)
class VideoProgress:
    stage: str
    percent: int

    def __post_init__(self) -> None:
        if not self.stage.strip() or not 0 <= self.percent <= 100:
            raise VideoContractError("video progress is invalid")


@dataclass(frozen=True, slots=True)
class VideoLineageMetadata:
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
class VideoSafetyMetadata:
    decision: SafetyDecision
    category: str
    reason: str
    policy_version: str
    review_id: str | None = None


@dataclass(frozen=True, slots=True)
class VideoGenerationRequest:
    operation: str
    prompt: str
    context: RuntimeContext
    source_video: bytes | None = None
    source_asset_id: str | None = None
    source_uri: str | None = None
    source_checksum: str | None = None
    mime_type: str = "video/mp4"
    file_name: str | None = None
    duration_seconds: int = 4
    model: str = "video-model.v1"

    def __post_init__(self) -> None:
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")
        try:
            operation = VideoOperation(self.operation)
        except ValueError as error:
            raise VideoContractError("video operation is unsupported") from error
        if not isinstance(self.prompt, str) or not self.prompt.strip():
            raise VideoContractError("video prompt is required")
        if not self.model.strip():
            raise VideoContractError("video model is required")
        if self.duration_seconds < 1:
            raise VideoContractError("video duration must be positive")
        normalized_mime = _normalize_mime(self.mime_type)
        if self.file_name and ("/" in self.file_name or "\\" in self.file_name):
            raise VideoContractError("video file name must not contain a path")
        source_fields = (
            self.source_video,
            self.source_asset_id,
            self.source_uri,
            self.source_checksum,
        )
        if any(value is not None for value in source_fields) and not all(
            value is not None for value in source_fields
        ):
            raise VideoContractError("video source lineage fields must be provided together")
        if operation is VideoOperation.EDIT and self.source_video is None:
            raise VideoContractError("video edit requires a source video")
        if self.source_video is not None and not isinstance(self.source_video, bytes):
            raise TypeError("video source must be bytes")
        if self.source_uri is not None:
            _validate_source_uri(self.source_uri)
            if not self.source_asset_id or not self.source_asset_id.strip():
                raise VideoContractError("video source asset id is required")
            if not self.source_checksum or not CHECKSUM_PATTERN.fullmatch(self.source_checksum):
                raise VideoContractError("video source checksum is invalid")
            if hashlib.sha256(self.source_video or b"").hexdigest() != self.source_checksum:
                raise VideoContractError("video source checksum does not match B2 lineage")
        object.__setattr__(self, "operation", operation.value)
        object.__setattr__(self, "mime_type", normalized_mime)
        object.__setattr__(self, "prompt", self.prompt.strip())


@dataclass(frozen=True, slots=True)
class VideoAsset:
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
class VideoJob:
    job_id: str
    operation: str
    status: VideoJobStatus
    progress: tuple[VideoProgress, ...]
    assets: tuple[VideoAsset, ...]
    provider: str
    model: str
    usage: VideoUsageMetadata
    safety: VideoSafetyMetadata
    audit: SafetyAudit
    availability: AvailabilityDisposition
    lineage: VideoLineageMetadata
    retention: VideoRetentionMetadata
    cancellation_requested: bool = False


class VideoClient(Protocol):
    async def submit(self, request: VideoGenerationRequest) -> VideoJob: ...

    async def run(
        self,
        job_id: str | VideoJob,
        context: RuntimeContext,
        *,
        retention: VideoRetentionPolicy | None = None,
    ) -> VideoJob: ...

    async def get(self, job_id: str, context: RuntimeContext) -> VideoJob: ...

    async def cancel(self, job_id: str, context: RuntimeContext) -> VideoJob: ...

    async def cleanup(self, now: int) -> int: ...


class VideoAssetLifecycle(Protocol):
    def stage(
        self,
        context: RuntimeContext,
        data: bytes,
        *,
        mime_type: str,
        source_asset_id: str | None,
        expires_at: int,
    ) -> VideoAsset: ...

    def get(self, context: RuntimeContext, asset_id: str) -> VideoAsset | None: ...

    def promote(self, context: RuntimeContext, asset_id: str) -> VideoAsset: ...

    def discard(self, context: RuntimeContext, asset_id: str) -> None: ...

    def cleanup(self, now: int) -> int: ...


class InMemoryVideoAssetLifecycle:
    """Deterministic tenant-scoped staging fake; no object-storage or provider I/O."""

    def __init__(self) -> None:
        self.assets: dict[str, VideoAsset] = {}

    def stage(
        self,
        context: RuntimeContext,
        data: bytes,
        *,
        mime_type: str,
        source_asset_id: str | None,
        expires_at: int,
    ) -> VideoAsset:
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
        asset_id = f"video-{digest[:24]}"
        workspace_id = context.lineage.get("workspaceId", "workspace-default")
        asset = VideoAsset(
            asset_id=asset_id,
            key=f"staging/tenants/{context.tenant_id}/workspaces/{workspace_id}/assets/{asset_id}",
            data=bytes(data),
            mime_type=mime_type,
            checksum=hashlib.sha256(data).hexdigest(),
            tenant_id=context.tenant_id,
            workspace_id=workspace_id,
            state=VideoAssetState.STAGED.value,
            expires_at=expires_at,
            source_asset_id=source_asset_id,
        )
        self.assets[asset_id] = asset
        return asset

    def get(self, context: RuntimeContext, asset_id: str) -> VideoAsset | None:
        asset = self.assets.get(asset_id)
        if asset is not None and asset.tenant_id != context.tenant_id:
            raise VideoAssetAccessError("video asset belongs to another tenant")
        return asset

    def promote(self, context: RuntimeContext, asset_id: str) -> VideoAsset:
        asset = self.get(context, asset_id)
        if asset is None:
            raise KeyError("video asset was not found")
        if asset.state == VideoAssetState.PROMOTED.value:
            return asset
        promoted = replace(asset, state=VideoAssetState.PROMOTED.value)
        self.assets[asset_id] = promoted
        return promoted

    def discard(self, context: RuntimeContext, asset_id: str) -> None:
        asset = self.get(context, asset_id)
        if asset is not None:
            del self.assets[asset_id]

    def cleanup(self, now: int) -> int:
        expired = [
            asset_id
            for asset_id, asset in self.assets.items()
            if asset.state == VideoAssetState.STAGED.value and asset.expires_at <= now
        ]
        for asset_id in expired:
            del self.assets[asset_id]
        return len(expired)


VideoTransport = Callable[[VideoGenerationRequest], bytes]


class _BaseVideoGeneration:
    provider = "fake"

    def __init__(
        self,
        *,
        model: str,
        max_source_bytes: int,
        max_prompt_chars: int,
        max_duration_seconds: int,
        max_output_bytes: int,
        lifecycle: VideoAssetLifecycle,
        quota: HardTenantQuota | None,
        telemetry: TelemetryPort | None,
        safety: DeterministicGuardrail | None,
        retention: VideoRetentionPolicy,
        clock: Callable[[], int],
    ) -> None:
        if (
            not model.strip()
            or max_source_bytes < 1
            or max_prompt_chars < 1
            or max_duration_seconds < 1
            or max_output_bytes < 1
        ):
            raise ValueError("video model and positive media/text bounds are required")
        self._model = model
        self._max_source_bytes = max_source_bytes
        self._max_prompt_chars = max_prompt_chars
        self._max_duration_seconds = max_duration_seconds
        self._max_output_bytes = max_output_bytes
        self._lifecycle = lifecycle
        self._quota = quota
        self._telemetry = telemetry
        self._safety = safety or DeterministicGuardrail()
        self._retention = retention
        self._clock = clock
        self._jobs: dict[str, VideoJob] = {}
        self._requests: dict[str, VideoGenerationRequest] = {}
        self._reservations: dict[str, QuotaReservation] = {}

    async def submit(self, request: VideoGenerationRequest) -> VideoJob:
        self._before_submit(request)
        self._validate(request)
        job_id = self._job_id(request)
        existing = self._jobs.get(job_id)
        if existing is not None:
            return existing
        outcome = self._safety.evaluate(SafetyRequest(request.context, request.prompt))
        safety = VideoSafetyMetadata(
            decision=outcome.decision,
            category=outcome.category,
            reason=outcome.reason,
            policy_version=outcome.audit.policy_version,
            review_id=outcome.review_id,
        )
        retention = self._retention
        job = self._job(
            job_id,
            request,
            VideoJobStatus.DENIED
            if outcome.decision is not SafetyDecision.ALLOW
            else VideoJobStatus.QUEUED,
            safety,
            outcome.audit,
            retention,
        )
        self._jobs[job_id] = job
        self._requests[job_id] = request
        if job.status is VideoJobStatus.DENIED:
            self._log("video.safety", request, job)
            return job
        try:
            reservation = self._reserve(request)
        except Exception:
            self._jobs.pop(job_id, None)
            self._requests.pop(job_id, None)
            raise
        self._reservations[job_id] = reservation
        self._log("video.queued", request, job)
        return job

    async def run(
        self,
        job_id: str,
        context: RuntimeContext,
        *,
        retention: VideoRetentionPolicy | None = None,
    ) -> VideoJob:
        job_id = self._normalize_job_id(job_id)
        job = self._owned_job(job_id, context)
        if job.status in {
            VideoJobStatus.COMPLETED,
            VideoJobStatus.CANCELLED,
            VideoJobStatus.DENIED,
            VideoJobStatus.EXPIRED,
        }:
            return job
        request = self._requests[job_id]
        policy = retention or self._retention
        job = replace(
            job,
            status=VideoJobStatus.RUNNING,
            retention=self._retention_metadata(policy),
        )
        self._jobs[job_id] = job
        try:
            for percent, stage in ((25, "prepare"), (50, "render"), (75, "package")):
                await asyncio.sleep(0)
                job = self._jobs[job_id]
                if job.status is VideoJobStatus.CANCELLED or job.cancellation_requested:
                    return job
                self._jobs[job_id] = replace(
                    job,
                    progress=job.progress + (VideoProgress(stage, percent),),
                )
            await asyncio.sleep(0)
            job = self._jobs[job_id]
            if job.status is VideoJobStatus.CANCELLED or job.cancellation_requested:
                return job
            rendered = self._render(request)
            if not isinstance(rendered, bytes) or not rendered:
                raise VideoProviderError("video provider returned invalid video data")
            if len(rendered) > self._max_output_bytes:
                raise VideoProviderError(
                    "video provider returned video over the maximum configured size"
                )
            asset = self._lifecycle.stage(
                context,
                rendered,
                mime_type=request.mime_type,
                source_asset_id=request.source_asset_id,
                expires_at=job.retention.expires_at,
            )
            completed = replace(
                job,
                status=VideoJobStatus.COMPLETED,
                progress=job.progress + (VideoProgress("complete", 100),),
                assets=(asset,),
                usage=replace(
                    job.usage,
                    output_bytes=len(rendered),
                    estimated_cost_usd=self._cost(request),
                ),
            )
            self._commit(job_id, completed)
            self._jobs[job_id] = completed
            self._log("video.completed", request, completed)
            return completed
        except Exception:
            current = self._jobs.get(job_id, job)
            for asset in current.assets:
                self._lifecycle.discard(context, asset.asset_id)
            self._release(job_id)
            self._jobs[job_id] = replace(current, status=VideoJobStatus.FAILED, assets=())
            raise

    async def get(self, job_id: str | VideoJob, context: RuntimeContext) -> VideoJob:
        job_id = self._normalize_job_id(job_id)
        return self._owned_job(job_id, context)

    async def cancel(self, job_id: str | VideoJob, context: RuntimeContext) -> VideoJob:
        job_id = self._normalize_job_id(job_id)
        job = self._owned_job(job_id, context)
        if job.status in {
            VideoJobStatus.COMPLETED,
            VideoJobStatus.CANCELLED,
            VideoJobStatus.DENIED,
            VideoJobStatus.EXPIRED,
        }:
            return job
        for asset in job.assets:
            self._lifecycle.discard(context, asset.asset_id)
        self._release(job_id)
        cancelled = replace(
            job,
            status=VideoJobStatus.CANCELLED,
            assets=(),
            cancellation_requested=True,
        )
        self._jobs[job_id] = cancelled
        self._log("video.cancelled", self._requests[job_id], cancelled)
        return cancelled

    async def cleanup(self, now: int) -> int:
        eligible = [
            job
            for job in self._jobs.values()
            if job.status is VideoJobStatus.COMPLETED
            and job.retention.expires_at <= now
            and any(asset.state == VideoAssetState.STAGED.value for asset in job.assets)
        ]
        deleted = self._lifecycle.cleanup(now)
        for job in eligible:
            self._jobs[job.job_id] = replace(job, status=VideoJobStatus.EXPIRED, assets=())
            self._log("video.expired", self._requests[job.job_id], self._jobs[job.job_id])
        return deleted

    def _before_submit(self, request: VideoGenerationRequest) -> None:
        del request

    def _validate(self, request: VideoGenerationRequest) -> None:
        if len(request.prompt) > self._max_prompt_chars:
            raise VideoContractError("video prompt exceeds maximum configured size")
        if request.mime_type not in SUPPORTED_VIDEO_MIME_TYPES:
            raise VideoContractError("video output uses an unsupported media type")
        if request.duration_seconds > self._max_duration_seconds:
            raise VideoContractError("video duration exceeds maximum configured size")
        if request.source_video is not None:
            if not request.source_video:
                raise VideoContractError("video source payload must not be empty")
            if len(request.source_video) > self._max_source_bytes:
                raise VideoContractError("video source exceeds maximum configured size")
            if any(byte < 32 and byte not in (9, 10, 13) for byte in request.source_video):
                raise VideoContractError("video source contains unsafe control content")
        if any(ord(char) < 32 and char not in "\t\n\r" for char in request.prompt):
            raise VideoContractError("video prompt contains unsafe control content")

    def _job(
        self,
        job_id: str,
        request: VideoGenerationRequest,
        status: VideoJobStatus,
        safety: VideoSafetyMetadata,
        audit: SafetyAudit,
        retention: VideoRetentionPolicy,
    ) -> VideoJob:
        return VideoJob(
            job_id=job_id,
            operation=request.operation,
            status=status,
            progress=(VideoProgress("queued", 0),),
            assets=(),
            provider=self.provider,
            model=request.model or self._model,
            usage=VideoUsageMetadata(
                input_bytes=len(request.source_video or b""),
                output_bytes=0,
                duration_seconds=request.duration_seconds,
                estimated_cost_usd=0.0,
            ),
            safety=safety,
            audit=audit,
            availability=self.availability,
            lineage=self._lineage(request),
            retention=self._retention_metadata(retention),
        )

    def _lineage(self, request: VideoGenerationRequest) -> VideoLineageMetadata:
        return VideoLineageMetadata(
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
        )

    def _retention_metadata(self, policy: VideoRetentionPolicy) -> VideoRetentionMetadata:
        return VideoRetentionMetadata(
            expires_at=self._clock() + policy.retention_seconds,
            encrypted=True,
            key_ref=policy.encryption_key_ref,
            algorithm=policy.algorithm,
        )

    def _reserve(self, request: VideoGenerationRequest) -> QuotaReservation:
        if self._quota is None:
            return None  # type: ignore[return-value]
        return self._quota.reserve(
            request.context.tenant_id,
            requests=1,
            tokens=max(1, len(request.prompt) // 4 + request.duration_seconds),
            cost_usd=self._cost(request),
        )

    def _commit(self, job_id: str, job: VideoJob) -> None:
        reservation = self._reservations.get(job_id)
        if self._quota is not None and reservation is not None:
            try:
                self._quota.commit(
                    reservation,
                    tokens=max(1, job.usage.output_bytes),
                    cost_usd=job.usage.estimated_cost_usd,
                )
            except Exception:
                self._quota.release(reservation)
                self._reservations.pop(job_id, None)
                raise
            self._reservations.pop(job_id, None)

    def _release(self, job_id: str) -> None:
        reservation = self._reservations.pop(job_id, None)
        if self._quota is not None and reservation is not None:
            self._quota.release(reservation)

    def _owned_job(self, job_id: str, context: RuntimeContext) -> VideoJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise KeyError("video job was not found")
        if job.lineage.tenant_id != context.tenant_id:
            raise VideoAssetAccessError("video job belongs to another tenant")
        return job

    @staticmethod
    def _normalize_job_id(job_id: str | VideoJob) -> str:
        if isinstance(job_id, VideoJob):
            return job_id.job_id
        if not isinstance(job_id, str) or not job_id.strip():
            raise VideoContractError("video job id is required")
        return job_id

    def _job_id(self, request: VideoGenerationRequest) -> str:
        source = request.source_checksum or "none"
        digest = hashlib.sha256(
            f"video.v1|{request.context.tenant_id}|{request.context.idempotency_key}|{request.operation}|{request.prompt}|{source}".encode()
        ).hexdigest()
        return f"video-job-{digest[:24]}"

    def _cost(self, request: VideoGenerationRequest) -> float:
        del request
        return 0.0

    def _log(self, name: str, request: VideoGenerationRequest, job: VideoJob) -> None:
        if self._telemetry is not None:
            self._telemetry.log(
                name,
                TelemetryContext(
                    correlation_id=request.context.correlation_id,
                    tenant_id=request.context.tenant_id,
                    actor_id=request.context.actor_id,
                ),
                {
                    "provider": job.provider,
                    "model": job.model,
                    "operation": job.operation,
                    "status": job.status.value,
                    "progress": job.progress[-1].percent,
                    "decision": job.safety.decision.value,
                    "inputBytes": job.usage.input_bytes,
                    "outputBytes": job.usage.output_bytes,
                    "durationSeconds": job.usage.duration_seconds,
                    "estimatedCostUsd": job.usage.estimated_cost_usd,
                    "availability": job.availability.status.value,
                    "auditId": job.audit.audit_id,
                },
            )

    def _render(self, request: VideoGenerationRequest) -> bytes:
        raise NotImplementedError


class DeterministicVideoGeneration(_BaseVideoGeneration):
    """Stable local video fake; output is digest-derived and never includes prompt bytes."""

    provider = "fake"

    def __init__(
        self,
        *,
        model: str = "fake-video.v1",
        max_source_bytes: int = 50 * 1024 * 1024,
        max_prompt_chars: int = 2_000,
        max_duration_seconds: int = 300,
        max_output_bytes: int = 50 * 1024 * 1024,
        lifecycle: VideoAssetLifecycle | None = None,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: VideoRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_source_bytes=max_source_bytes,
            max_prompt_chars=max_prompt_chars,
            max_duration_seconds=max_duration_seconds,
            max_output_bytes=max_output_bytes,
            lifecycle=lifecycle or InMemoryVideoAssetLifecycle(),
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or VideoRetentionPolicy(),
            clock=clock or (lambda: 0),
        )

    @property
    def availability(self) -> AvailabilityDisposition:
        return AvailabilityDisposition(
            AvailabilityStatus.ALTERNATIVE,
            "deterministic local video generation/editing is the tested no-credit alternative",
            "deterministic-local-video",
        )

    def _render(self, request: VideoGenerationRequest) -> bytes:
        source_digest = hashlib.sha256(request.source_video or b"").hexdigest()
        digest = hashlib.sha256(
            f"video.v1|{request.operation}|{request.context.tenant_id}|{request.prompt}|{source_digest}|{request.duration_seconds}".encode()
        ).hexdigest()
        return f"deterministic-video:{digest}".encode()


class BedrockVideoGeneration(_BaseVideoGeneration):
    """Bedrock video port; provider I/O exists only through an injected transport."""

    provider = "bedrock"

    def __init__(
        self,
        transport: VideoTransport | None = None,
        *,
        active: bool = False,
        config_ref: str = "aws-secret-store:bedrock-video-generation",
        model: str = "amazon-video.v1",
        max_source_bytes: int = 50 * 1024 * 1024,
        max_prompt_chars: int = 2_000,
        max_duration_seconds: int = 300,
        max_output_bytes: int = 50 * 1024 * 1024,
        lifecycle: VideoAssetLifecycle | None = None,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        safety: DeterministicGuardrail | None = None,
        retention: VideoRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_source_bytes=max_source_bytes,
            max_prompt_chars=max_prompt_chars,
            max_duration_seconds=max_duration_seconds,
            max_output_bytes=max_output_bytes,
            lifecycle=lifecycle or InMemoryVideoAssetLifecycle(),
            quota=quota,
            telemetry=telemetry,
            safety=safety,
            retention=retention or VideoRetentionPolicy(),
            clock=clock or (lambda: 0),
        )
        if not config_ref.strip():
            raise ValueError("Bedrock video config reference is required")
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
                "Bedrock video activation was explicitly enabled for injected transport",
            )
        return AvailabilityDisposition(
            AvailabilityStatus.GATED,
            "no approved AWS video model or region is validated; credits, credentials, quota, and owner conformance are required",
            "deterministic-local-video",
        )

    def _before_submit(self, request: VideoGenerationRequest) -> None:
        if not self._active:
            self._log_unavailable(request)
            raise ProviderUnavailableError(
                "Bedrock video provider is gated until activation evidence exists"
            )
        if self._transport is None:
            self._log_unavailable(request)
            raise ProviderUnavailableError(
                "Bedrock video provider is active but transport is unavailable"
            )

    def _render(self, request: VideoGenerationRequest) -> bytes:
        try:
            rendered = self._transport(request) if self._transport is not None else None
        except Exception as error:
            raise VideoProviderError("Bedrock video provider request failed") from error
        if not isinstance(rendered, bytes) or not rendered:
            raise VideoProviderError("Bedrock video provider returned invalid video data")
        return rendered

    def _cost(self, request: VideoGenerationRequest) -> float:
        return round(
            max(1, len(request.prompt) + len(request.source_video or b""))
            * max(1, request.duration_seconds)
            / 1_000_000
            * 0.08,
            8,
        )

    def _log_unavailable(self, request: VideoGenerationRequest) -> None:
        if self._telemetry is not None:
            self._telemetry.log(
                "video.unavailable",
                TelemetryContext(
                    correlation_id=request.context.correlation_id,
                    tenant_id=request.context.tenant_id,
                    actor_id=request.context.actor_id,
                ),
                {"provider": self.provider, "availability": self.availability.status.value},
            )


DeterministicVideo = DeterministicVideoGeneration
BedrockVideo = BedrockVideoGeneration
VideoRequest = VideoGenerationRequest
VideoResponse = VideoJob


def _normalize_mime(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise VideoContractError("video media type is required")
    normalized = value.split(";", 1)[0].strip().lower()
    if normalized not in SUPPORTED_VIDEO_MIME_TYPES:
        raise VideoContractError("video output uses an unsupported media type")
    return normalized


def _validate_source_uri(value: str) -> None:
    if not value.startswith("b2://") or ".." in value.split("b2://", 1)[1].split("/"):
        raise VideoContractError("video source URI must remain under the B2 boundary")


__all__ = [
    "NEUTRAL_USE_CASE",
    "SUPPORTED_VIDEO_MIME_TYPES",
    "VIDEO_OWNER",
    "AvailabilityDisposition",
    "AvailabilityStatus",
    "BedrockVideo",
    "BedrockVideoGeneration",
    "DeterministicVideo",
    "DeterministicVideoGeneration",
    "InMemoryVideoAssetLifecycle",
    "VideoAsset",
    "VideoAssetAccessError",
    "VideoAssetLifecycle",
    "VideoAssetState",
    "VideoClient",
    "VideoContractError",
    "VideoGenerationRequest",
    "VideoJob",
    "VideoJobStatus",
    "VideoLineageMetadata",
    "VideoOperation",
    "VideoProgress",
    "VideoProviderError",
    "VideoRequest",
    "VideoResponse",
    "VideoRetentionMetadata",
    "VideoRetentionPolicy",
    "VideoSafetyMetadata",
    "VideoTransport",
    "VideoUsageMetadata",
]
