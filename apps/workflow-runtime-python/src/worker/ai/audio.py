"""Shared typed audio contracts for provider-free speech capabilities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from worker.ai.llm import LineageMetadata, ProviderUnavailableError
from worker.ai.quota import HardTenantQuota, QuotaReservation
from worker.langgraph.registry import RuntimeContext

SUPPORTED_AUDIO_MIME_TYPES: Final[frozenset[str]] = frozenset(
    {
        "audio/aac",
        "audio/flac",
        "audio/mpeg",
        "audio/mp4",
        "audio/ogg",
        "audio/opus",
        "audio/wav",
        "audio/webm",
    }
)
SUPPORTED_TTS_FORMATS: Final[frozenset[str]] = frozenset({"wav", "mp3"})


class AudioContractError(ValueError):
    """Raised for invalid audio metadata or bounded payloads."""


class AudioProviderError(RuntimeError):
    """Raised after an adapter failure has been sanitized."""


@dataclass(frozen=True, slots=True)
class AudioRetentionPolicy:
    retention_seconds: int = 86_400
    encryption_key_ref: str = "deterministic-local-audio-key"
    algorithm: str = "deterministic-local-envelope.v1"

    def __post_init__(self) -> None:
        if self.retention_seconds < 0:
            raise ValueError("retention_seconds must be non-negative")
        if not self.encryption_key_ref.strip():
            raise ValueError("encryption_key_ref is required")
        if not self.algorithm.strip():
            raise ValueError("algorithm is required")


@dataclass(frozen=True, slots=True)
class AudioRetentionMetadata:
    expires_at: int
    encrypted: bool
    key_ref: str
    algorithm: str


@dataclass(frozen=True, slots=True)
class AudioUsageMetadata:
    input_bytes: int = 0
    output_bytes: int = 0
    estimated_cost_usd: float = 0.0
    currency: str = "USD"

    def __post_init__(self) -> None:
        if self.input_bytes < 0 or self.output_bytes < 0:
            raise ValueError("Audio byte counts cannot be negative")
        if self.estimated_cost_usd < 0:
            raise ValueError("Estimated audio cost cannot be negative")


def retention_metadata(policy: AudioRetentionPolicy, now: int) -> AudioRetentionMetadata:
    return AudioRetentionMetadata(
        expires_at=now + policy.retention_seconds,
        encrypted=True,
        key_ref=policy.encryption_key_ref,
        algorithm=policy.algorithm,
    )


def validate_audio_payload(
    audio: bytes,
    *,
    mime_type: str,
    max_audio_bytes: int,
) -> str:
    if not audio:
        raise AudioContractError("audio payload must not be empty")
    if len(audio) > max_audio_bytes:
        raise AudioContractError("audio payload exceeds maximum configured size")
    normalized_mime = mime_type.split(";", 1)[0].strip().lower()
    if normalized_mime == "audio/mp3":
        normalized_mime = "audio/mpeg"
    if normalized_mime not in SUPPORTED_AUDIO_MIME_TYPES:
        raise AudioContractError("audio payload uses an unsupported media type")
    return normalized_mime


def validate_text(text: str, *, max_text_chars: int) -> str:
    if not isinstance(text, str) or not text.strip():
        raise AudioContractError("speech text is required")
    if len(text) > max_text_chars:
        raise AudioContractError("speech text exceeds maximum configured size")
    return text.strip()


def reserve_audio_quota(
    quota: HardTenantQuota | None,
    context: RuntimeContext,
    *,
    cost_usd: float,
) -> QuotaReservation | None:
    if quota is None:
        return None
    return quota.reserve(context.tenant_id, requests=1, tokens=0, cost_usd=cost_usd)


def finish_audio_quota(
    quota: HardTenantQuota | None,
    reservation: QuotaReservation | None,
    *,
    cost_usd: float,
) -> None:
    if quota is not None and reservation is not None:
        quota.commit(reservation, tokens=0, cost_usd=cost_usd)


def release_audio_quota(
    quota: HardTenantQuota | None, reservation: QuotaReservation | None
) -> None:
    if quota is not None and reservation is not None:
        quota.release(reservation)


__all__ = [
    "SUPPORTED_AUDIO_MIME_TYPES",
    "SUPPORTED_TTS_FORMATS",
    "AudioContractError",
    "AudioProviderError",
    "AudioRetentionMetadata",
    "AudioRetentionPolicy",
    "AudioUsageMetadata",
    "LineageMetadata",
    "ProviderUnavailableError",
    "finish_audio_quota",
    "release_audio_quota",
    "reserve_audio_quota",
    "retention_metadata",
    "validate_audio_payload",
    "validate_text",
]
