"""Typed speech-to-text ports with deterministic and activation-gated adapters."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Protocol

from worker.ai.audio import (
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
    validate_audio_payload,
)
from worker.ai.quota import HardTenantQuota
from worker.langgraph.registry import RuntimeContext


@dataclass(frozen=True, slots=True)
class STTRequest:
    audio: bytes
    context: RuntimeContext
    mime_type: str = "audio/wav"
    file_name: str | None = None
    language: str | None = None
    prompt: str | None = None
    model: str = "whisper-large-v3-turbo"

    def __post_init__(self) -> None:
        if not isinstance(self.audio, bytes):
            raise TypeError("audio must be bytes")
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")
        if not self.model.strip():
            raise ValueError("STT model is required")
        if self.file_name and ("/" in self.file_name or "\\" in self.file_name):
            raise AudioContractError("audio file name must not contain a path")


@dataclass(frozen=True, slots=True)
class STTResponse:
    text: str
    provider: str
    model: str
    mime_type: str
    usage: AudioUsageMetadata
    lineage: LineageMetadata
    retention: AudioRetentionMetadata


class STTClient(Protocol):
    def transcribe(self, request: STTRequest) -> STTResponse: ...


STTTransport = Callable[[STTRequest], str]


class _BaseSTT:
    provider = "fake"

    def __init__(
        self,
        *,
        model: str,
        max_audio_bytes: int,
        quota: HardTenantQuota | None,
        retention: AudioRetentionPolicy,
        clock: Callable[[], int],
    ) -> None:
        if max_audio_bytes < 1:
            raise ValueError("max_audio_bytes must be positive")
        self._model = model
        self._max_audio_bytes = max_audio_bytes
        self._quota = quota
        self._retention = retention
        self._clock = clock

    def _validate(self, request: STTRequest) -> str:
        return validate_audio_payload(
            request.audio,
            mime_type=request.mime_type,
            max_audio_bytes=self._max_audio_bytes,
        )

    def _response(self, request: STTRequest, text: str, mime_type: str) -> STTResponse:
        return STTResponse(
            text=text,
            provider=self.provider,
            model=request.model or self._model,
            mime_type=mime_type,
            usage=AudioUsageMetadata(input_bytes=len(request.audio)),
            lineage=LineageMetadata.from_context(request.context),
            retention=retention_metadata(self._retention, self._clock()),
        )


class DeterministicSTT(_BaseSTT):
    """Stable local fake; it never stores or echoes audio bytes."""

    provider = "fake"

    def __init__(
        self,
        *,
        model: str = "fake-stt.v1",
        max_audio_bytes: int = 10 * 1024 * 1024,
        quota: HardTenantQuota | None = None,
        retention: AudioRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
            max_audio_bytes=max_audio_bytes,
            quota=quota,
            retention=retention or AudioRetentionPolicy(),
            clock=clock or (lambda: 0),
        )

    def transcribe(self, request: STTRequest) -> STTResponse:
        mime_type = self._validate(request)
        reservation = reserve_audio_quota(self._quota, request.context, cost_usd=0.0)
        try:
            response = self._response(
                request,
                f"fake transcript: {len(request.audio)} bytes {mime_type}",
                mime_type,
            )
            finish_audio_quota(self._quota, reservation, cost_usd=0.0)
            reservation = None
            return response
        finally:
            release_audio_quota(self._quota, reservation)


class GroqSTT(_BaseSTT):
    """Groq STT port; live I/O is possible only through an injected transport."""

    provider = "groq"

    def __init__(
        self,
        transport: STTTransport | None = None,
        *,
        active: bool = False,
        model: str = "whisper-large-v3-turbo",
        max_audio_bytes: int = 10 * 1024 * 1024,
        quota: HardTenantQuota | None = None,
        retention: AudioRetentionPolicy | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        super().__init__(
            model=model,
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

    def transcribe(self, request: STTRequest) -> STTResponse:
        if not self._active:
            raise ProviderUnavailableError(
                "Groq STT provider is gated until activation evidence exists"
            )
        if self._transport is None:
            raise ProviderUnavailableError(
                "Groq STT provider is active but transport is unavailable"
            )
        mime_type = self._validate(request)
        cost_usd = round(len(request.audio) / 1000 * 0.01, 8)
        reservation = reserve_audio_quota(self._quota, request.context, cost_usd=cost_usd)
        try:
            try:
                text = self._transport(request)
            except Exception as error:
                raise AudioProviderError("Groq STT provider request failed") from error
            if not isinstance(text, str) or not text.strip():
                raise AudioProviderError("Groq STT provider returned no transcript")
            response = self._response(request, text.strip(), mime_type)
            response = replace(
                response,
                usage=AudioUsageMetadata(
                    input_bytes=len(request.audio), estimated_cost_usd=cost_usd
                ),
            )
            finish_audio_quota(self._quota, reservation, cost_usd=cost_usd)
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
    "DeterministicSTT",
    "GroqSTT",
    "LineageMetadata",
    "ProviderUnavailableError",
    "STTClient",
    "STTRequest",
    "STTResponse",
]
