"""Tenant-safe OCR/document-intelligence ports with deterministic local fakes."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from worker.ai.llm import ProviderUnavailableError
from worker.ai.quota import HardTenantQuota, QuotaReservation
from worker.langgraph.registry import RuntimeContext
from worker.telemetry.ports import TelemetryContext, TelemetryPort

SUPPORTED_OCR_MIME_TYPES = frozenset(
    {"application/pdf", "image/jpeg", "image/png", "image/tiff", "image/webp"}
)
CHECKSUM_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class OcrContractError(ValueError):
    """Raised when OCR input or output violates the typed document contract."""


class OcrProviderError(RuntimeError):
    """Raised after an injected OCR provider failure has been sanitized."""


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
class OcrRetentionPolicy:
    retention_seconds: int = 86_400
    encryption_key_ref: str = "deterministic-local-ocr-key"
    algorithm: str = "deterministic-local-envelope.v1"

    def __post_init__(self) -> None:
        if self.retention_seconds < 0:
            raise ValueError("retention_seconds must be non-negative")
        if not self.encryption_key_ref.strip() or not self.algorithm.strip():
            raise ValueError("OCR retention metadata is incomplete")


@dataclass(frozen=True, slots=True)
class OcrRetentionMetadata:
    expires_at: int
    encrypted: bool
    key_ref: str
    algorithm: str


@dataclass(frozen=True, slots=True)
class OcrUsageMetadata:
    input_bytes: int
    output_characters: int
    pages: int
    estimated_cost_usd: float
    currency: str = "USD"

    def __post_init__(self) -> None:
        if self.input_bytes < 0 or self.output_characters < 0 or self.pages < 1:
            raise ValueError("OCR usage counts are invalid")
        if self.estimated_cost_usd < 0:
            raise ValueError("Estimated OCR cost cannot be negative")


@dataclass(frozen=True, slots=True)
class OcrSafetyMetadata:
    decision: str = "allow"
    category: str = "document"
    policy_version: str = "ocr-safe.v1"


@dataclass(frozen=True, slots=True)
class OcrLineageMetadata:
    tenant_id: str
    workspace_id: str
    actor_id: str
    source_asset_id: str
    source_uri: str
    source_checksum: str
    root_message_id: str
    correlation_id: str

    def __post_init__(self) -> None:
        for name in (
            "tenant_id",
            "workspace_id",
            "actor_id",
            "source_asset_id",
            "source_uri",
            "source_checksum",
            "root_message_id",
            "correlation_id",
        ):
            if not getattr(self, name).strip():
                raise OcrContractError(f"OCR lineage {name} is required")
        if not self.source_uri.startswith("b2://"):
            raise OcrContractError("OCR lineage source URI must use the B2 boundary")
        if not CHECKSUM_PATTERN.fullmatch(self.source_checksum):
            raise OcrContractError("OCR lineage checksum must be a lowercase SHA-256 digest")


@dataclass(frozen=True, slots=True)
class OcrRequest:
    document: bytes
    context: RuntimeContext
    mime_type: str
    file_name: str
    source_asset_id: str
    source_uri: str
    source_checksum: str
    model: str = "ocr-model.v1"

    def __post_init__(self) -> None:
        if not isinstance(self.document, bytes):
            raise TypeError("OCR document must be bytes")
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")
        if not self.model.strip():
            raise OcrContractError("OCR model is required")
        if not self.file_name.strip() or "/" in self.file_name or "\\" in self.file_name:
            raise OcrContractError("OCR file name must not contain a path")
        for name in ("source_asset_id", "source_uri", "source_checksum"):
            if not getattr(self, name).strip():
                raise OcrContractError(f"OCR {name} is required")
        if not self.source_uri.startswith("b2://"):
            raise OcrContractError("OCR source URI must use the B2 boundary")
        if ".." in self.source_uri.split("b2://", 1)[1].split("/"):
            raise OcrContractError("OCR source URI must remain under the B2 boundary")
        if not CHECKSUM_PATTERN.fullmatch(self.source_checksum):
            raise OcrContractError("OCR source checksum must be a lowercase SHA-256 digest")
        if hashlib.sha256(self.document).hexdigest() != self.source_checksum:
            raise OcrContractError("OCR document checksum does not match B2 lineage")
        object.__setattr__(self, "mime_type", _normalize_mime(self.mime_type))


@dataclass(frozen=True, slots=True)
class OcrResponse:
    text: str
    pages: int
    provider: str
    model: str
    usage: OcrUsageMetadata
    safety: OcrSafetyMetadata
    availability: AvailabilityDisposition
    lineage: OcrLineageMetadata
    retention: OcrRetentionMetadata


class OcrClient(Protocol):
    def extract(self, request: OcrRequest) -> OcrResponse: ...


OcrTransport = Callable[[OcrRequest], str]


class _BaseOCR:
    provider = "fake"

    def __init__(
        self,
        *,
        model: str,
        max_document_bytes: int,
        max_output_chars: int,
        quota: HardTenantQuota | None,
        telemetry: TelemetryPort | None,
        retention: OcrRetentionPolicy,
        clock: Callable[[], int],
    ) -> None:
        if not model.strip() or max_document_bytes < 1 or max_output_chars < 1:
            raise ValueError("OCR model and positive document/output bounds are required")
        self._model = model
        self._max_document_bytes = max_document_bytes
        self._max_output_chars = max_output_chars
        self._quota = quota
        self._telemetry = telemetry
        self._retention = retention
        self._clock = clock

    def _validate(self, request: OcrRequest) -> None:
        if not request.document:
            raise OcrContractError("OCR document payload must not be empty")
        if len(request.document) > self._max_document_bytes:
            raise OcrContractError("OCR document exceeds maximum configured size")
        if request.mime_type not in SUPPORTED_OCR_MIME_TYPES:
            raise OcrContractError("OCR document uses an unsupported media type")
        if request.context.tenant_id != request.context.tenant_id.strip():
            raise OcrContractError("OCR tenant context is invalid")
        if b"\x00" in request.document or any(
            byte < 32 and byte not in (9, 10, 13) for byte in request.document
        ):
            raise OcrContractError("OCR document contains unsafe control content")

    def _lineage(self, request: OcrRequest) -> OcrLineageMetadata:
        return OcrLineageMetadata(
            tenant_id=request.context.tenant_id,
            workspace_id=request.context.lineage.get("workspaceId", "workspace-default"),
            actor_id=request.context.actor_id,
            source_asset_id=request.source_asset_id,
            source_uri=request.source_uri,
            source_checksum=request.source_checksum,
            root_message_id=request.context.lineage["rootMessageId"],
            correlation_id=request.context.correlation_id,
        )

    def _response(
        self,
        request: OcrRequest,
        text: str,
        cost_usd: float,
    ) -> OcrResponse:
        normalized = text.strip()
        if not normalized:
            raise OcrProviderError("OCR provider returned no text")
        if len(normalized) > self._max_output_chars:
            raise OcrProviderError("OCR provider returned text over the maximum configured size")
        return OcrResponse(
            text=normalized,
            pages=1,
            provider=self.provider,
            model=request.model or self._model,
            usage=OcrUsageMetadata(
                input_bytes=len(request.document),
                output_characters=len(normalized),
                pages=1,
                estimated_cost_usd=cost_usd,
            ),
            safety=OcrSafetyMetadata(),
            availability=self.availability,
            lineage=self._lineage(request),
            retention=OcrRetentionMetadata(
                expires_at=self._clock() + self._retention.retention_seconds,
                encrypted=True,
                key_ref=self._retention.encryption_key_ref,
                algorithm=self._retention.algorithm,
            ),
        )

    def _reserve(self, request: OcrRequest, cost_usd: float) -> QuotaReservation | None:
        if self._quota is None:
            return None
        return self._quota.reserve(
            request.context.tenant_id,
            requests=1,
            tokens=0,
            cost_usd=cost_usd,
        )

    def _finish(self, reservation: QuotaReservation | None, response: OcrResponse) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.commit(
                reservation,
                tokens=response.usage.output_characters,
                cost_usd=response.usage.estimated_cost_usd,
            )

    def _release(self, reservation: QuotaReservation | None) -> None:
        if self._quota is not None and reservation is not None:
            self._quota.release(reservation)

    def _log(self, name: str, request: OcrRequest, attributes: dict[str, object]) -> None:
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


class DeterministicOCR(_BaseOCR):
    """Stable local fake; it never calls a provider or echoes document bytes."""

    provider = "fake"

    def __init__(
        self,
        *,
        model: str = "fake-ocr.v1",
        max_document_bytes: int = 10 * 1024 * 1024,
        max_output_chars: int = 8_000,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        retention: OcrRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_document_bytes=max_document_bytes,
            max_output_chars=max_output_chars,
            quota=quota,
            telemetry=telemetry,
            retention=retention or OcrRetentionPolicy(),
            clock=clock or (lambda: 0),
        )

    @property
    def availability(self) -> AvailabilityDisposition:
        return AvailabilityDisposition(
            AvailabilityStatus.ALTERNATIVE,
            "deterministic local OCR is the tested no-credit alternative",
            "textract",
        )

    def extract(self, request: OcrRequest) -> OcrResponse:
        self._validate(request)
        reservation = self._reserve(request, 0.0)
        try:
            response = self._response(
                request,
                f"fake OCR text: {request.mime_type} {len(request.document)} bytes",
                0.0,
            )
            self._finish(reservation, response)
            reservation = None
            self._log(
                "ocr.completed",
                request,
                {
                    "provider": response.provider,
                    "model": response.model,
                    "mimeType": request.mime_type,
                    "inputBytes": response.usage.input_bytes,
                    "outputCharacters": response.usage.output_characters,
                    "pages": response.pages,
                    "estimatedCostUsd": response.usage.estimated_cost_usd,
                    "availability": response.availability.status.value,
                },
            )
            return response
        finally:
            self._release(reservation)


class TextractOCR(_BaseOCR):
    """AWS Textract port; provider I/O exists only through an injected transport."""

    provider = "textract"

    def __init__(
        self,
        transport: OcrTransport | None = None,
        *,
        active: bool = False,
        config_ref: str = "aws-secret-store:textract-ocr",
        model: str = "amazon-textract.v1",
        max_document_bytes: int = 10 * 1024 * 1024,
        max_output_chars: int = 8_000,
        quota: HardTenantQuota | None = None,
        telemetry: TelemetryPort | None = None,
        retention: OcrRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_document_bytes=max_document_bytes,
            max_output_chars=max_output_chars,
            quota=quota,
            telemetry=telemetry,
            retention=retention or OcrRetentionPolicy(),
            clock=clock or (lambda: 0),
        )
        if not config_ref.strip():
            raise ValueError("Textract OCR config reference is required")
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
                "Textract OCR activation was explicitly enabled for injected transport",
            )
        return AvailabilityDisposition(
            AvailabilityStatus.GATED,
            "Textract OCR requires credentials, region, quota, and owner-approved live conformance",
            "deterministic-local-ocr",
        )

    def extract(self, request: OcrRequest) -> OcrResponse:
        if not self._active:
            self._log(
                "ocr.unavailable",
                request,
                {"provider": self.provider, "availability": self.availability.status.value},
            )
            raise ProviderUnavailableError(
                "Textract OCR provider is gated until activation evidence exists"
            )
        if self._transport is None:
            self._log(
                "ocr.unavailable",
                request,
                {"provider": self.provider, "availability": self.availability.status.value},
            )
            raise ProviderUnavailableError(
                "Textract OCR provider is active but transport is unavailable"
            )
        self._validate(request)
        cost_usd = round(max(1, len(request.document)) / 1_000_000 * 0.01, 8)
        reservation = self._reserve(request, cost_usd)
        try:
            try:
                text = self._transport(request)
            except Exception as error:
                raise OcrProviderError("Textract OCR provider request failed") from error
            if not isinstance(text, str):
                raise OcrProviderError("Textract OCR provider returned invalid text")
            response = self._response(request, text, cost_usd)
            self._finish(reservation, response)
            reservation = None
            self._log(
                "ocr.completed",
                request,
                {
                    "provider": response.provider,
                    "model": response.model,
                    "mimeType": request.mime_type,
                    "inputBytes": response.usage.input_bytes,
                    "outputCharacters": response.usage.output_characters,
                    "pages": response.pages,
                    "estimatedCostUsd": response.usage.estimated_cost_usd,
                    "availability": response.availability.status.value,
                },
            )
            return response
        finally:
            self._release(reservation)


AwsTextractOCR = TextractOCR
DeterministicOcr = DeterministicOCR
OCRRequest = OcrRequest
OCRResponse = OcrResponse


def _normalize_mime(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OcrContractError("OCR media type is required")
    return value.split(";", 1)[0].strip().lower()


__all__ = [
    "SUPPORTED_OCR_MIME_TYPES",
    "AvailabilityDisposition",
    "AvailabilityStatus",
    "AwsTextractOCR",
    "DeterministicOCR",
    "DeterministicOcr",
    "OCRRequest",
    "OCRResponse",
    "OcrClient",
    "OcrContractError",
    "OcrLineageMetadata",
    "OcrProviderError",
    "OcrRequest",
    "OcrResponse",
    "OcrRetentionMetadata",
    "OcrRetentionPolicy",
    "OcrSafetyMetadata",
    "OcrUsageMetadata",
    "TextractOCR",
]
