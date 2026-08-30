import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.ai import DeterministicOCR as ExportedDeterministicOCR
from worker.ai.ocr import (
    AvailabilityStatus,
    DeterministicOCR,
    OcrContractError,
    OcrProviderError,
    OcrRequest,
    OcrRetentionPolicy,
    TextractOCR,
)
from worker.ai.quota import HardTenantQuota, QuotaExceededError, TenantQuota
from worker.langgraph.registry import RuntimeContext
from worker.telemetry import InMemoryTelemetry


def context(
    *, tenant_id: str = "tenant-a", actor_id: str = "actor-a"
) -> RuntimeContext:
    return RuntimeContext(
        tenant_id=tenant_id,
        actor_id=actor_id,
        correlation_id="corr-a",
        idempotency_key="idem-a",
        lineage={"rootMessageId": "message-a", "source": "p4.10-test"},
    )


def request(
    *,
    tenant_id: str = "tenant-a",
    document: bytes = b"document-bytes",
    mime_type: str = "application/pdf",
    source_uri: str = "b2://tenant-a/documents/doc-a.pdf",
    source_checksum: str | None = None,
) -> OcrRequest:
    import hashlib

    values = {
        "document": document,
        "context": context(tenant_id=tenant_id),
        "mime_type": mime_type,
        "file_name": "doc-a.pdf",
        "source_asset_id": "asset-a",
        "source_uri": source_uri,
        "source_checksum": source_checksum or hashlib.sha256(document).hexdigest(),
        "model": "ocr-model.v1",
    }
    return OcrRequest(**values)


def test_ocr_schemas_are_strict_versioned_and_include_b2_lineage_retention_cost():
    assert ExportedDeterministicOCR is DeterministicOCR
    schema_paths = sorted(
        (ROOT / "packages" / "ai-contracts" / "schemas" / "ocr").glob("*.schema.json")
    )
    assert [path.name for path in schema_paths] == [
        "request.v1.schema.json",
        "response.v1.schema.json",
    ]
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

    request_schema = json.loads(schema_paths[0].read_text(encoding="utf-8"))
    response_schema = json.loads(schema_paths[1].read_text(encoding="utf-8"))
    assert {
        "documentBase64",
        "mimeType",
        "fileName",
        "sourceAssetId",
        "sourceUri",
        "sourceChecksum",
        "model",
    }.issubset(request_schema["required"])
    assert {"text", "pages", "provider", "usage", "safety", "availability"}.issubset(
        response_schema["required"]
    )


def test_deterministic_ocr_is_repeatable_tenant_safe_and_records_lineage_retention_and_cost():
    telemetry = InMemoryTelemetry()
    client = DeterministicOCR(telemetry=telemetry, clock=lambda: 100)

    first = client.extract(request(document=b"private-document-bytes"))
    second = client.extract(request(document=b"private-document-bytes"))

    assert first == second
    assert first.provider == "fake"
    assert first.text == "fake OCR text: application/pdf 22 bytes"
    assert first.pages == 1
    assert first.lineage.tenant_id == "tenant-a"
    assert first.lineage.source_uri == "b2://tenant-a/documents/doc-a.pdf"
    assert first.availability.status is AvailabilityStatus.ALTERNATIVE
    assert first.retention.expires_at == 86_500
    assert first.usage.input_bytes == 22
    assert first.usage.estimated_cost_usd == 0.0
    assert len(telemetry.logs) == 2
    assert all("private-document-bytes" not in str(log) for log in telemetry.logs)


def test_ocr_rejects_unsafe_oversized_invalid_b2_and_checksum_documents_without_echoing_payload():
    client = DeterministicOCR(max_document_bytes=4)
    with pytest.raises(OcrContractError, match="maximum") as oversized:
        client.extract(request(document=b"secret-document"))
    assert "secret-document" not in str(oversized.value)

    with pytest.raises(OcrContractError, match="unsafe"):
        DeterministicOCR().extract(request(document=b"safe\x00unsafe"))
    with pytest.raises(OcrContractError, match="media type"):
        DeterministicOCR().extract(request(mime_type="application/octet-stream"))
    with pytest.raises(OcrContractError, match="B2"):
        DeterministicOCR().extract(
            request(source_uri="https://example.invalid/doc.pdf")
        )
    with pytest.raises(OcrContractError, match="checksum"):
        DeterministicOCR().extract(request(source_checksum="0" * 64))
    with pytest.raises(OcrContractError, match="file name"):
        OcrRequest(
            document=b"ok",
            context=context(),
            mime_type="application/pdf",
            file_name="../private.pdf",
            source_asset_id="asset-a",
            source_uri="b2://tenant-a/documents/doc-a.pdf",
            source_checksum="0" * 64,
        )


def test_ocr_uses_hard_tenant_quotas_without_cross_tenant_leakage():
    quota = HardTenantQuota()
    quota.configure(
        "tenant-a", TenantQuota(max_requests=1, max_tokens=100, max_cost_usd=1.0)
    )
    quota.configure(
        "tenant-b", TenantQuota(max_requests=1, max_tokens=100, max_cost_usd=1.0)
    )
    client = DeterministicOCR(quota=quota)

    client.extract(request(tenant_id="tenant-a"))
    with pytest.raises(QuotaExceededError, match="requests quota"):
        client.extract(request(tenant_id="tenant-a"))
    assert client.extract(request(tenant_id="tenant-b")).lineage.tenant_id == "tenant-b"


def test_ocr_triangulates_image_mime_normalization_and_custom_retention_evidence():
    client = DeterministicOCR(
        retention=OcrRetentionPolicy(
            retention_seconds=25,
            encryption_key_ref="local-ocr-key",
            algorithm="deterministic-local-envelope.v2",
        ),
        clock=lambda: 7,
    )
    response = client.extract(
        request(
            document=b"image-input",
            mime_type="image/png; charset=binary",
            source_uri="b2://tenant-a/images/doc-a.png",
        )
    )

    assert response.text == "fake OCR text: image/png 11 bytes"
    assert response.lineage.source_uri == "b2://tenant-a/images/doc-a.png"
    assert response.retention.expires_at == 32
    assert response.retention.key_ref == "local-ocr-key"
    assert response.retention.algorithm == "deterministic-local-envelope.v2"
    assert response.usage.pages == 1


def test_textract_ocr_is_activation_gated_and_uses_only_injected_transport():
    gated = TextractOCR()
    assert gated.availability.status is AvailabilityStatus.GATED
    with pytest.raises(RuntimeError, match="gated"):
        gated.extract(request())

    active = TextractOCR(
        transport=lambda ocr_request: f"extracted:{ocr_request.mime_type}",
        active=True,
    )
    response = active.extract(request())
    assert response.provider == "textract"
    assert response.text == "extracted:application/pdf"
    assert response.availability.status is AvailabilityStatus.ACTIVE
    assert response.usage.estimated_cost_usd > 0


def test_textract_provider_failures_are_sanitized_and_oversized_output_releases_quota():
    def failing_transport(_: OcrRequest) -> str:
        raise RuntimeError("token=secret-value document=private-document")

    with pytest.raises(OcrProviderError) as error:
        TextractOCR(transport=failing_transport, active=True).extract(
            request(document=b"private-document")
        )
    assert str(error.value) == "Textract OCR provider request failed"
    assert "secret-value" not in str(error.value)
    assert "private-document" not in str(error.value)

    quota = HardTenantQuota()
    quota.configure(
        "tenant-a", TenantQuota(max_requests=1, max_tokens=100, max_cost_usd=1.0)
    )
    with pytest.raises(OcrProviderError, match="maximum"):
        TextractOCR(
            transport=lambda _: "x" * 20,
            active=True,
            max_output_chars=10,
            quota=quota,
        ).extract(request())
    assert DeterministicOCR(quota=quota).extract(request()).provider == "fake"
