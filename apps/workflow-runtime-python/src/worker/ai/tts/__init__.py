"""Typed text-to-speech ports with deterministic and activation-gated adapters."""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Protocol

from worker.ai.audio import (
    SUPPORTED_TTS_FORMATS,
    AudioContractError,
    AudioProviderError,
    AudioRetentionMetadata,
    AudioRetentionPolicy,
    AudioUsageMetadata,
    LineageMetadata,
    ProviderUnavailableError,
    finish_audio_quota,
    release_audio_quota,
    reserve_audio_quota,
    retention_metadata,
    validate_text,
)
from worker.ai.quota import HardTenantQuota
from worker.langgraph.registry import RuntimeContext


@dataclass(frozen=True, slots=True)
class TTSRequest:
    text: str
    context: RuntimeContext
    voice: str = "neutral"
    response_format: str = "wav"
    model: str = "playai-tts"

    def __post_init__(self) -> None:
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")
        if not self.voice.strip():
            raise ValueError("TTS voice is required")
        if self.response_format not in SUPPORTED_TTS_FORMATS:
            raise AudioContractError("unsupported TTS response format")
        if not self.model.strip():
            raise ValueError("TTS model is required")


@dataclass(frozen=True, slots=True)
class TTSResponse:
    audio: bytes
    provider: str
    model: str
    mime_type: str
    usage: AudioUsageMetadata
    lineage: LineageMetadata
    retention: AudioRetentionMetadata


class TTSClient(Protocol):
    def synthesize(self, request: TTSRequest) -> TTSResponse: ...


TTSTransport = Callable[[TTSRequest], bytes]


class _BaseTTS:
    provider = "fake"

    def __init__(
        self,
        *,
        model: str,
        max_text_chars: int,
        max_audio_bytes: int,
        quota: HardTenantQuota | None,
        retention: AudioRetentionPolicy,
        clock: Callable[[], int],
    ) -> None:
        if max_text_chars < 1 or max_audio_bytes < 1:
            raise ValueError("TTS bounds must be positive")
        self._model = model
        self._max_text_chars = max_text_chars
        self._max_audio_bytes = max_audio_bytes
        self._quota = quota
        self._retention = retention
        self._clock = clock

    def _validate(self, request: TTSRequest) -> str:
        return validate_text(request.text, max_text_chars=self._max_text_chars)

    def _response(self, request: TTSRequest, audio: bytes, text: str) -> TTSResponse:
        if not audio:
            raise AudioProviderError("TTS provider returned no audio")
        if len(audio) > self._max_audio_bytes:
            raise AudioProviderError("TTS provider returned oversized audio")
        mime_type = "audio/mpeg" if request.response_format == "mp3" else "audio/wav"
        return TTSResponse(
            audio=audio,
            provider=self.provider,
            model=request.model or self._model,
            mime_type=mime_type,
            usage=AudioUsageMetadata(output_bytes=len(audio)),
            lineage=LineageMetadata.from_context(request.context),
            retention=retention_metadata(self._retention, self._clock()),
        )


class DeterministicTTS(_BaseTTS):
    """Stable local fake that returns a digest-derived audio fixture."""

    provider = "fake"

    def __init__(
        self,
        *,
        model: str = "fake-tts.v1",
        max_text_chars: int = 8_000,
        max_audio_bytes: int = 10 * 1024 * 1024,
        quota: HardTenantQuota | None = None,
        retention: AudioRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_text_chars=max_text_chars,
            max_audio_bytes=max_audio_bytes,
            quota=quota,
            retention=retention or AudioRetentionPolicy(),
            clock=clock or (lambda: 0),
        )

    def synthesize(self, request: TTSRequest) -> TTSResponse:
        text = self._validate(request)
        reservation = reserve_audio_quota(self._quota, request.context, cost_usd=0.0)
        try:
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:24].encode("ascii")
            response = self._response(request, b"FAKE-AUDIO-V1:" + digest, text)
            finish_audio_quota(self._quota, reservation, cost_usd=0.0)
            reservation = None
            return response
        finally:
            release_audio_quota(self._quota, reservation)


class GroqTTS(_BaseTTS):
    """Groq TTS port; live I/O is possible only through an injected transport."""

    provider = "groq"

    def __init__(
        self,
        transport: TTSTransport | None = None,
        *,
        active: bool = False,
        model: str = "playai-tts",
        max_text_chars: int = 8_000,
        max_audio_bytes: int = 10 * 1024 * 1024,
        quota: HardTenantQuota | None = None,
        retention: AudioRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_text_chars=max_text_chars,
            max_audio_bytes=max_audio_bytes,
            quota=quota,
            retention=retention or AudioRetentionPolicy(),
            clock=clock or (lambda: 0),
        )
        self._transport = transport
        self._active = active

    @property
    def active(self) -> bool:
        return self._active

    def synthesize(self, request: TTSRequest) -> TTSResponse:
        if not self._active:
            raise ProviderUnavailableError(
                "Groq TTS provider is gated until activation evidence exists"
            )
        if self._transport is None:
            raise ProviderUnavailableError(
                "Groq TTS provider is active but transport is unavailable"
            )
        text = self._validate(request)
        reservation = reserve_audio_quota(self._quota, request.context, cost_usd=0.01)
        try:
            try:
                audio = self._transport(request)
            except Exception as error:
                raise AudioProviderError("Groq TTS provider request failed") from error
            if not isinstance(audio, bytes):
                raise AudioProviderError("Groq TTS provider returned invalid audio")
            response = self._response(request, audio, text)
            response = replace(
                response,
                usage=AudioUsageMetadata(output_bytes=len(audio), estimated_cost_usd=0.01),
            )
            finish_audio_quota(self._quota, reservation, cost_usd=0.01)
            reservation = None
            return response
        finally:
            release_audio_quota(self._quota, reservation)


__all__ = [
    "AudioContractError",
    "AudioProviderError",
    "AudioRetentionMetadata",
    "AudioRetentionPolicy",
    "AudioUsageMetadata",
    "DeterministicTTS",
    "GroqTTS",
    "LineageMetadata",
    "ProviderUnavailableError",
    "TTSClient",
    "TTSRequest",
    "TTSResponse",
]
