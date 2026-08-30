import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.ai.quota import HardTenantQuota, QuotaExceededError, TenantQuota
from worker.ai.stt import (
    AudioContractError,
    AudioProviderError,
    AudioRetentionPolicy,
    DeterministicSTT,
    GroqSTT,
    STTRequest,
)
from worker.ai.tts import (
    DeterministicTTS,
    GroqTTS,
    TTSRequest,
)
from worker.langgraph.registry import RuntimeContext


def context(*, tenant_id: str = "tenant-a") -> RuntimeContext:
    return RuntimeContext(
        tenant_id=tenant_id,
        actor_id="actor-a",
        correlation_id="corr-a",
        idempotency_key="idem-a",
        lineage={"rootMessageId": "message-a", "source": "p4.7-test"},
    )


def stt_request(
    *, tenant_id: str = "tenant-a", audio: bytes = b"wav-data"
) -> STTRequest:
    return STTRequest(
        audio=audio,
        context=context(tenant_id=tenant_id),
        mime_type="audio/wav",
        file_name="dictado.wav",
        language="es",
    )


def test_speech_schemas_are_strict_versioned_and_carry_lineage_retention_metadata():
    schema_paths = sorted(
        (ROOT / "packages" / "ai-contracts" / "schemas").glob("{stt,tts}/*.schema.json")
    )

    # pathlib does not expand brace globs; keep the assertion explicit and deterministic.
    schema_paths = sorted(
        path
        for capability in ("stt", "tts")
        for path in (ROOT / "packages" / "ai-contracts" / "schemas" / capability).glob(
            "*.schema.json"
        )
    )
    assert len(schema_paths) == 4
    for path in schema_paths:
        schema = json.loads(path.read_text(encoding="utf-8"))
        assert schema["type"] == "object"
        assert schema["additionalProperties"] is False
        assert schema["properties"]["contractVersion"]["const"] == "1.0.0"
        assert {
            "tenantId",
            "actorId",
            "correlationId",
            "lineage",
            "retention",
        }.issubset(schema["required"])


def test_deterministic_stt_is_repeatable_sanitized_and_records_lineage_retention_and_usage():
    policy = AudioRetentionPolicy(
        retention_seconds=60, encryption_key_ref="local-audio-key"
    )
    client = DeterministicSTT(retention=policy, clock=lambda: 100)

    first = client.transcribe(stt_request())
    second = client.transcribe(stt_request())

    assert first == second
    assert first.provider == "fake"
    assert first.text == "fake transcript: 8 bytes audio/wav"
    assert first.usage.input_bytes == 8
    assert first.usage.estimated_cost_usd == 0.0
    assert first.lineage.tenant_id == "tenant-a"
    assert first.retention.expires_at == 160
    assert first.retention.encrypted is True
    assert "wav-data" not in first.text


def test_deterministic_tts_is_repeatable_and_returns_bounded_audio_metadata():
    client = DeterministicTTS(
        retention=AudioRetentionPolicy(
            retention_seconds=30, encryption_key_ref="local-audio-key"
        ),
        clock=lambda: 10,
    )
    request = TTSRequest(text="Hola plataforma", context=context(), voice="neutral")

    first = client.synthesize(request)
    second = client.synthesize(request)

    assert first == second
    assert first.provider == "fake"
    assert first.mime_type == "audio/wav"
    assert first.audio.startswith(b"FAKE-AUDIO-V1:")
    assert first.usage.output_bytes == len(first.audio)
    assert first.lineage.correlation_id == "corr-a"
    assert first.retention.expires_at == 40


def test_speech_contract_triangulates_mp3_output_and_mime_alias_normalization():
    stt = DeterministicSTT()
    tts = DeterministicTTS()

    transcription = stt.transcribe(
        STTRequest(
            audio=b"mpeg", context=context(), mime_type="audio/mp3", model="fake"
        )
    )
    speech = tts.synthesize(
        TTSRequest(text="different input", context=context(), response_format="mp3")
    )

    assert transcription.mime_type == "audio/mpeg"
    assert transcription.text == "fake transcript: 4 bytes audio/mpeg"
    assert speech.mime_type == "audio/mpeg"
    assert (
        speech.audio
        != DeterministicTTS()
        .synthesize(TTSRequest(text="hello", context=context(), response_format="mp3"))
        .audio
    )


def test_groq_active_adapters_use_only_injected_transports_and_gated_adapters_fail_closed():
    stt = GroqSTT(transport=lambda request: "groq transcript", active=True)
    tts = GroqTTS(transport=lambda request: b"groq-audio", active=True)

    assert stt.transcribe(stt_request()).provider == "groq"
    assert (
        tts.synthesize(TTSRequest(text="hello", context=context())).provider == "groq"
    )

    with pytest.raises(RuntimeError, match="gated"):
        GroqSTT().transcribe(stt_request())
    with pytest.raises(RuntimeError, match="gated"):
        GroqTTS().synthesize(TTSRequest(text="hello", context=context()))


def test_provider_errors_are_sanitized_and_never_include_audio_or_text_payloads():
    def failing_stt(_: STTRequest) -> str:
        raise RuntimeError("provider token=secret-value audio=wav-data")

    def failing_tts(_: TTSRequest) -> bytes:
        raise RuntimeError("provider token=secret-value text=private sentence")

    with pytest.raises(AudioProviderError) as stt_error:
        GroqSTT(transport=failing_stt, active=True).transcribe(stt_request())
    with pytest.raises(AudioProviderError) as tts_error:
        GroqTTS(transport=failing_tts, active=True).synthesize(
            TTSRequest(text="private sentence", context=context())
        )

    assert str(stt_error.value) == "Groq STT provider request failed"
    assert str(tts_error.value) == "Groq TTS provider request failed"
    assert "secret-value" not in str(stt_error.value) + str(tts_error.value)
    assert "private sentence" not in str(stt_error.value) + str(tts_error.value)


def test_groq_tts_sanitizes_non_bytes_transport_failures():
    def invalid_tts(_: TTSRequest) -> bytes:
        raise RuntimeError("text=confidential token=hidden")

    with pytest.raises(
        AudioProviderError, match="Groq TTS provider request failed"
    ) as error:
        GroqTTS(transport=invalid_tts, active=True).synthesize(
            TTSRequest(text="another sentence", context=context())
        )
    assert "confidential" not in str(error.value)


def test_audio_contract_rejects_empty_or_oversized_input_without_echoing_payload():
    with pytest.raises(AudioContractError, match="audio payload"):
        DeterministicSTT().transcribe(stt_request(audio=b""))

    with pytest.raises(AudioContractError, match="maximum") as error:
        DeterministicSTT(max_audio_bytes=3).transcribe(stt_request())
    assert "wav-data" not in str(error.value)


def test_audio_calls_reserve_and_commit_tenant_quota_without_cross_tenant_leakage():
    quota = HardTenantQuota()
    quota.configure(
        "tenant-a", TenantQuota(max_requests=1, max_tokens=100, max_cost_usd=1.0)
    )
    quota.configure(
        "tenant-b", TenantQuota(max_requests=1, max_tokens=100, max_cost_usd=1.0)
    )
    client = DeterministicSTT(quota=quota)

    client.transcribe(stt_request(tenant_id="tenant-a"))
    with pytest.raises(QuotaExceededError, match="requests quota"):
        client.transcribe(stt_request(tenant_id="tenant-a"))

    other_tenant = client.transcribe(stt_request(tenant_id="tenant-b"))
    assert other_tenant.lineage.tenant_id == "tenant-b"
