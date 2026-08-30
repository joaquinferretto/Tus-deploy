import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.rag.chunking import ChunkingConfig, SafeChunker
from worker.rag.dedup import DeduplicationIndex, checksum_bytes
from worker.rag.ingest import (
    B2Object,
    IngestRequest,
    InMemoryB2Source,
    InMemoryChunkIndex,
    InMemoryIngestLedger,
    InMemoryQuarantineStore,
    RagIngestor,
    SourceAuthorizationError,
)
from worker.rag.lineage import TenantLineage
from worker.rag.parsing import (
    DocumentTooLargeError,
    ParserConfig,
    SafeParser,
    UnsupportedMimeTypeError,
)


def request(**overrides: object) -> IngestRequest:
    values: dict[str, object] = {
        "tenant_id": "tenant-a",
        "workspace_id": "workspace-a",
        "actor_id": "actor-a",
        "correlation_id": "corr-a",
        "root_message_id": "message-a",
        "source_id": "asset-a",
        "idempotency_key": "ingest-a",
        "retention_until": 1_800_000_000,
    }
    values.update(overrides)
    return IngestRequest(**values)


def ingestor(*, content: bytes = b"alpha beta\n\ngamma delta") -> tuple[RagIngestor, InMemoryChunkIndex, InMemoryIngestLedger, InMemoryQuarantineStore]:
    source = InMemoryB2Source()
    source.put(
        B2Object(
            source_id="asset-a",
            tenant_id="tenant-a",
            workspace_id="workspace-a",
            object_key="tenant-a/asset-a.txt",
            mime_type="text/plain",
            content=content,
            allowed_actor_ids=frozenset({"actor-a"}),
        )
    )
    index = InMemoryChunkIndex()
    ledger = InMemoryIngestLedger()
    quarantine = InMemoryQuarantineStore()
    runtime = RagIngestor(
        source,
        index,
        ledger,
        quarantine,
        chunker=SafeChunker(ChunkingConfig(max_characters=16, overlap_characters=2)),
    )
    return runtime, index, ledger, quarantine


def test_parser_rejects_unsupported_types_and_oversized_or_unsafe_content():
    parser = SafeParser(ParserConfig(max_bytes=8))
    with pytest.raises(UnsupportedMimeTypeError):
        parser.parse(b"<script>alert(1)</script>", "text/html", "asset-a")
    with pytest.raises(DocumentTooLargeError):
        parser.parse(b"123456789", "text/plain", "asset-a")
    with pytest.raises(ValueError, match="NUL"):
        SafeParser(ParserConfig()).parse(b"safe\x00unsafe", "text/plain", "asset-a")


def test_parser_and_chunker_are_deterministic_and_preserve_offsets():
    parsed = SafeParser(ParserConfig()).parse(
        b"First paragraph.\n\nSecond paragraph with enough words.",
        "text/plain",
        "asset-a",
    )
    chunks = SafeChunker(ChunkingConfig(max_characters=24, overlap_characters=4)).chunk(parsed)
    assert [chunk.chunk_index for chunk in chunks] == [0, 1, 2]
    assert all(chunk.text == parsed.text[chunk.start_offset : chunk.end_offset] for chunk in chunks)
    assert all(len(chunk.text) <= 24 for chunk in chunks)
    assert chunks[0].checksum == checksum_bytes(chunks[0].text.encode("utf-8"))


def test_lineage_is_tenant_scoped_and_dedup_does_not_cross_tenants():
    lineage = TenantLineage(
        tenant_id="tenant-a",
        workspace_id="workspace-a",
        actor_id="actor-a",
        source_asset_id="asset-a",
        source_uri="b2://tenant-a/asset-a.txt",
        checksum="a" * 64,
        root_message_id="message-a",
        correlation_id="corr-a",
        parser_version="safe-text.v1",
        chunker_version="bounded.v1",
    )
    assert lineage.as_dict()["tenantId"] == "tenant-a"
    index = DeduplicationIndex()
    assert index.reserve("tenant-a", "a" * 64) is True
    assert index.reserve("tenant-a", "a" * 64) is False
    assert index.reserve("tenant-b", "a" * 64) is True


def test_b2_boundary_denies_wrong_tenant_or_actor_before_parsing():
    runtime, _, _, quarantine = ingestor()
    with pytest.raises(SourceAuthorizationError):
        runtime.ingest(request(tenant_id="tenant-b"))
    with pytest.raises(SourceAuthorizationError):
        runtime.ingest(request(actor_id="actor-b"))
    assert quarantine.records == []


def test_b2_source_rejects_path_traversal_keys_at_the_source_boundary():
    with pytest.raises(ValueError, match="tenant prefix"):
        B2Object(
            source_id="asset-a",
            tenant_id="tenant-a",
            workspace_id="workspace-a",
            object_key="tenant-a/../tenant-b/asset.txt",
            mime_type="text/plain",
            content=b"unsafe key",
        )


def test_ingestion_commits_chunks_with_checksum_lineage_and_retention():
    runtime, index, ledger, _ = ingestor()
    result = runtime.ingest(request())
    assert result.status == "completed"
    assert result.chunk_count == 2
    chunks = index.list_for_tenant("tenant-a")
    assert len(chunks) == 2
    assert all(chunk.lineage.tenant_id == "tenant-a" for chunk in chunks)
    assert all(chunk.retention_until == 1_800_000_000 for chunk in chunks)
    assert all(len(chunk.checksum) == 64 for chunk in chunks)
    assert ledger.get("tenant-a", "ingest-a").status == "completed"


def test_duplicate_source_is_idempotent_and_has_no_duplicate_visible_chunks():
    runtime, index, _, _ = ingestor()
    first = runtime.ingest(request())
    duplicate = runtime.ingest(request(idempotency_key="ingest-b"))
    assert first.status == "completed"
    assert duplicate.status == "duplicate"
    assert duplicate.chunk_count == first.chunk_count
    assert len(index.list_for_tenant("tenant-a")) == first.chunk_count


def test_unsafe_source_is_quarantined_without_partial_tenant_visible_index():
    runtime, index, ledger, quarantine = ingestor(content=b"not-json")
    result = runtime.ingest(request(mime_type="application/json"))
    assert result.status == "quarantined"
    assert result.reason == "mime_mismatch"
    assert index.list_for_tenant("tenant-a") == []
    assert quarantine.records[0].reason == "mime_mismatch"
    assert ledger.get("tenant-a", "ingest-a").status == "quarantined"


def test_partial_commit_is_recoverable_and_never_exposes_staged_chunks():
    runtime, index, ledger, _ = ingestor()
    index.fail_next_commit = True
    partial = runtime.ingest(request())
    assert partial.status == "partial"
    assert partial.retryable is True
    assert index.list_for_tenant("tenant-a") == []
    assert ledger.get("tenant-a", "ingest-a").status == "partial"

    recovered = runtime.ingest(request())
    assert recovered.status == "completed"
    assert recovered.reason is None
    assert len(index.list_for_tenant("tenant-a")) == recovered.chunk_count


def test_unavailable_b2_adapter_is_explicit():
    runtime, _, _, _ = ingestor()
    runtime.source = InMemoryB2Source.unavailable()
    with pytest.raises(RuntimeError, match="B2 source provider is unavailable"):
        runtime.ingest(request())
