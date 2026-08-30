import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.rag.chunking import ChunkingConfig, SafeChunker
from worker.rag.embeddings import (
    AwsEmbeddingProvider,
    DeterministicEmbeddingProvider,
    EmbeddingUnavailableError,
)
from worker.rag.ingest import (
    B2Object,
    ChunkRecord,
    IngestRequest,
    InMemoryB2Source,
    InMemoryChunkIndex,
    InMemoryIngestLedger,
    InMemoryQuarantineStore,
    RagIngestor,
)
from worker.rag.pgvector import (
    InMemoryPgVectorIndex,
    PgVectorUnavailableError,
    RagEmbeddingIndexer,
    TenantFilterError,
    UnavailablePgVectorIndex,
)


def _request(tenant_id: str = "tenant-a") -> IngestRequest:
    return IngestRequest(
        tenant_id=tenant_id,
        workspace_id=f"workspace-{tenant_id}",
        actor_id=f"actor-{tenant_id}",
        correlation_id=f"correlation-{tenant_id}",
        root_message_id=f"message-{tenant_id}",
        source_id=f"source-{tenant_id}",
        idempotency_key=f"ingest-{tenant_id}",
        retention_until=1_800_000_000,
    )


def _chunks_for(tenant_id: str, content: bytes = b"alpha beta gamma") -> list[ChunkRecord]:
    source = InMemoryB2Source()
    request = _request(tenant_id)
    source.put(
        B2Object(
            source_id=request.source_id,
            tenant_id=tenant_id,
            workspace_id=request.workspace_id,
            object_key=f"{tenant_id}/{request.source_id}.txt",
            mime_type="text/plain",
            content=content,
            allowed_actor_ids=frozenset({request.actor_id}),
        )
    )
    index = InMemoryChunkIndex()
    RagIngestor(
        source,
        index,
        InMemoryIngestLedger(),
        InMemoryQuarantineStore(),
        chunker=SafeChunker(ChunkingConfig(max_characters=32, overlap_characters=0)),
    ).ingest(request)
    return index.list_for_tenant(tenant_id)


def test_aws_embedding_adapter_is_gated_without_provider_calls_and_fake_is_stable():
    provider = AwsEmbeddingProvider(model="amazon.titan-embed-text-v2:0", activated=False)

    with pytest.raises(EmbeddingUnavailableError, match="activation gate"):
        provider.embed_documents(["alpha"])

    fake = DeterministicEmbeddingProvider(model="fake-embedding.v1", dimensions=8)
    first = fake.embed_documents(["alpha", "beta"])
    second = fake.embed_documents(["alpha", "beta"])
    assert first == second
    assert first[0] != first[1]
    assert all(len(vector) == 8 for vector in first)


def test_embedding_index_preserves_b2_lineage_and_embedding_index_versions():
    chunks = _chunks_for("tenant-a")
    index = InMemoryPgVectorIndex(index_version="rag-index.v1")
    indexed = RagEmbeddingIndexer(
        DeterministicEmbeddingProvider(dimensions=4),
        index,
        embedding_version="fake-embedding.v1",
    ).index(chunks)

    assert len(indexed) == len(chunks)
    record = indexed[0]
    assert record.tenant_id == "tenant-a"
    assert record.embedding_version == "fake-embedding.v1"
    assert record.index_version == "rag-index.v1"
    assert record.metadata.source_uri.startswith("b2://tenant-a/")
    assert record.metadata.source_asset_id == chunks[0].lineage.source_asset_id
    assert record.metadata.source_checksum == chunks[0].lineage.checksum
    assert record.metadata.parser_version == chunks[0].lineage.parser_version
    assert record.metadata.chunker_version == chunks[0].lineage.chunker_version
    assert record.metadata.retention_until == chunks[0].retention_until


def test_pgvector_index_requires_tenant_filters_and_keeps_versions_isolated():
    index = InMemoryPgVectorIndex(index_version="rag-index.v1")
    indexer = RagEmbeddingIndexer(DeterministicEmbeddingProvider(dimensions=3), index)
    tenant_a = indexer.index(_chunks_for("tenant-a"))
    tenant_b = indexer.index(_chunks_for("tenant-b"))

    assert [record.tenant_id for record in index.list_for_tenant("tenant-a")] == ["tenant-a"]
    assert [record.tenant_id for record in index.list_for_tenant("tenant-b")] == ["tenant-b"]
    with pytest.raises(TenantFilterError):
        index.list_for_tenant("")
    with pytest.raises(TenantFilterError):
        index.upsert(tenant_a + tenant_b, tenant_id="tenant-a")

    newer = InMemoryPgVectorIndex(index_version="rag-index.v2")
    RagEmbeddingIndexer(
        DeterministicEmbeddingProvider(dimensions=3), newer, embedding_version="fake-embedding.v2"
    ).index(_chunks_for("tenant-a"))
    assert newer.list_for_tenant("tenant-a", index_version="rag-index.v1") == []
    assert len(newer.list_for_tenant("tenant-a", index_version="rag-index.v2")) == len(tenant_a)


def test_pgvector_unavailable_adapter_is_explicit_without_database_calls():
    index = UnavailablePgVectorIndex()
    with pytest.raises(PgVectorUnavailableError, match="PGVector"):
        index.list_for_tenant("tenant-a")
