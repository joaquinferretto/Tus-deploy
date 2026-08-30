import sys
from dataclasses import replace
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.rag.chunking import ChunkingConfig, SafeChunker
from worker.rag.delete import (
    DeletionRequest,
    InMemoryDerivedArtifacts,
    RagDeletionPropagator,
)
from worker.rag.embeddings import DeterministicEmbeddingProvider
from worker.rag.evaluations import (
    DEFAULT_RAG_EVALUATION_FIXTURES,
    DeterministicRagEvaluator,
)
from worker.rag.ingest import (
    B2Object,
    IngestRequest,
    InMemoryB2Source,
    InMemoryChunkIndex,
    InMemoryIngestLedger,
    InMemoryQuarantineStore,
    RagIngestor,
)
from worker.rag.pgvector import InMemoryPgVectorIndex, RagEmbeddingIndexer
from worker.rag.reconciliation import RagReconciliationService
from worker.rag.reindex import ReindexCoordinator, RetainedIndexSelector
from worker.rag.update import RagUpdater, UpdateRequest


def _request(source_id: str = "asset-a", key: str = "ingest-a") -> IngestRequest:
    return IngestRequest(
        tenant_id="tenant-a",
        workspace_id="workspace-a",
        actor_id="actor-a",
        correlation_id="corr-a",
        root_message_id="message-a",
        source_id=source_id,
        idempotency_key=key,
        retention_until=1_900_000_000,
    )


def _runtime(content: bytes = b"alpha policy"):
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
    chunks = InMemoryChunkIndex()
    ledger = InMemoryIngestLedger()
    ingestor = RagIngestor(
        source,
        chunks,
        ledger,
        InMemoryQuarantineStore(),
        chunker=SafeChunker(ChunkingConfig(max_characters=32, overlap_characters=0)),
    )
    result = ingestor.ingest(_request())
    provider = DeterministicEmbeddingProvider(dimensions=4)
    vectors = InMemoryPgVectorIndex(index_version="rag-index.v1")
    indexer = RagEmbeddingIndexer(
        provider, vectors, embedding_version="fake-embedding.v1"
    )
    indexer.index(chunks.list_for_tenant("tenant-a"))
    return source, chunks, vectors, ingestor, indexer, result


def test_update_replaces_source_derived_data_without_cross_tenant_residue():
    source, chunks, vectors, ingestor, indexer, before = _runtime()
    updater = RagUpdater(source, chunks, vectors, ingestor, indexer)
    source.put(
        B2Object(
            source_id="asset-a",
            tenant_id="tenant-a",
            workspace_id="workspace-a",
            object_key="tenant-a/asset-a.txt",
            mime_type="text/plain",
            content=b"beta policy replaces alpha",
            allowed_actor_ids=frozenset({"actor-a"}),
        )
    )

    result = updater.update(UpdateRequest.from_ingest(_request(key="update-a")))

    assert before.status == "completed"
    assert result.status == "completed"
    assert result.previous_checksum != result.checksum
    assert [chunk.text for chunk in chunks.list_for_tenant("tenant-a")] == [
        "beta policy replaces alpha"
    ]
    assert all(
        record.metadata.source_checksum == result.checksum
        for record in vectors.list_for_tenant("tenant-a")
    )


def test_deletion_propagates_to_chunks_vectors_cache_and_citations_idempotently():
    _, chunks, vectors, _, _, _ = _runtime()
    artifacts = InMemoryDerivedArtifacts()
    artifacts.add("tenant-a", "asset-a", "cache")
    artifacts.add("tenant-a", "asset-a", "citation")
    deletion = RagDeletionPropagator(chunks, vectors, artifacts)

    first = deletion.delete(
        DeletionRequest("tenant-a", "asset-a", "actor-a", "delete-a")
    )
    replay = deletion.delete(
        DeletionRequest("tenant-a", "asset-a", "actor-a", "delete-a")
    )

    assert first.status == "completed"
    assert first.removed_chunks == 1
    assert first.removed_vectors == 1
    assert first.removed_artifacts == 2
    assert replay.idempotent is True
    assert chunks.list_for_tenant("tenant-a") == []
    assert vectors.list_for_tenant("tenant-a") == []
    assert artifacts.remaining("tenant-a", "asset-a") == []


def test_stale_reconciliation_repairs_missing_and_versioned_vectors():
    _, chunks, vectors, _, indexer, _ = _runtime()
    records = vectors.list_for_tenant("tenant-a")
    vectors.delete_source("tenant-a", "asset-a")
    report = RagReconciliationService().reconcile(
        "tenant-a", chunks.list_for_tenant("tenant-a"), records, vectors, indexer
    )

    assert report.status == "repaired"
    assert report.missing_vectors == 1
    assert report.repaired_vectors == 1
    assert len(vectors.list_for_tenant("tenant-a")) == 1


def test_stale_detection_names_parser_and_embedding_version_drift():
    _, chunks, vectors, _, indexer, _ = _runtime()
    current = vectors.list_for_tenant("tenant-a")[0]
    stale = replace(
        current,
        embedding_version="old-embedding.v1",
        metadata=replace(current.metadata, parser_version="old-parser.v1"),
    )
    vectors.upsert([stale], tenant_id="tenant-a")

    report = RagReconciliationService().detect(
        "tenant-a",
        chunks.list_for_tenant("tenant-a"),
        [stale],
        vectors,
        expected_embedding_version=indexer.embedding_version,
    )

    assert report.status == "stale"
    assert report.stale_vectors == 1
    assert report.reasons == ("stale_vector",)


def test_degraded_reindex_rolls_back_to_last_passing_index():
    _, chunks, _, _, _, _ = _runtime()
    provider = DeterministicEmbeddingProvider(dimensions=4)
    selector = RetainedIndexSelector(initial_index_version="rag-index.v1")
    selector.mark_passing("rag-index.v1", quality=0.95)
    coordinator = ReindexCoordinator(provider, selector)

    result = coordinator.reindex(
        chunks.list_for_tenant("tenant-a"),
        "rag-index.v2",
        quality=0.40,
        minimum_quality=0.80,
    )

    assert result.status == "rolled_back"
    assert result.selected_index_version == "rag-index.v1"
    assert selector.selected_index_version == "rag-index.v1"
    assert result.source_deleted is False


def test_deterministic_evaluations_cover_quality_isolation_and_operations():
    result = DeterministicRagEvaluator(DEFAULT_RAG_EVALUATION_FIXTURES).run()

    assert result.passed is True
    assert result.metrics["recall_at_k"] == 1.0
    assert result.metrics["tenant_isolation"] == 1.0
    assert result.metrics["citation_correctness"] == 1.0
    assert result.metrics["quality"] == 1.0
    assert result.metrics["latency_ms"] == 42.0
    assert result.metrics["cost_units"] == 3.0


def test_deletion_rejects_cross_tenant_source_without_disclosing_state():
    _, chunks, vectors, _, _, _ = _runtime()
    deletion = RagDeletionPropagator(chunks, vectors, InMemoryDerivedArtifacts())

    with pytest.raises(PermissionError, match="tenant-scoped"):
        deletion.delete(DeletionRequest("tenant-b", "asset-a", "actor-b", "delete-b"))


def test_deletion_removes_authorized_b2_metadata_with_derived_state():
    source, chunks, vectors, _, _, _ = _runtime()
    deletion = RagDeletionPropagator(
        chunks, vectors, InMemoryDerivedArtifacts(), source=source
    )

    result = deletion.delete(
        DeletionRequest("tenant-a", "asset-a", "actor-a", "delete-source")
    )

    assert result.status == "completed"
    with pytest.raises(PermissionError, match="not authorized"):
        source.fetch(
            source_id="asset-a",
            tenant_id="tenant-a",
            workspace_id="workspace-a",
            actor_id="actor-a",
        )


def test_update_failure_is_partial_and_never_leaves_new_vectors_visible():
    source, chunks, vectors, ingestor, indexer, _ = _runtime()
    updater = RagUpdater(source, chunks, vectors, ingestor, indexer)
    source.put(
        B2Object(
            source_id="asset-a",
            tenant_id="tenant-a",
            workspace_id="workspace-a",
            object_key="tenant-a/asset-a.txt",
            mime_type="text/plain",
            content=b"replacement content",
            allowed_actor_ids=frozenset({"actor-a"}),
        )
    )
    chunks.fail_next_commit = True

    result = updater.update(UpdateRequest.from_ingest(_request(key="update-failure")))

    assert result.status == "partial"
    assert chunks.list_for_tenant("tenant-a") == []
    assert vectors.list_for_tenant("tenant-a") == []


def test_successful_reindex_promotes_only_a_passing_version():
    _, chunks, _, _, _, _ = _runtime()
    provider = DeterministicEmbeddingProvider(dimensions=4)
    selector = RetainedIndexSelector(initial_index_version="rag-index.v1")
    selector.mark_passing("rag-index.v1", quality=0.90)
    coordinator = ReindexCoordinator(provider, selector)

    result = coordinator.reindex(
        chunks.list_for_tenant("tenant-a"),
        "rag-index.v2",
        quality=0.95,
        minimum_quality=0.80,
    )

    assert result.status == "completed"
    assert result.selected_index_version == "rag-index.v2"
    assert len(coordinator.indexes["rag-index.v2"].list_for_tenant("tenant-a")) == 1


def test_evaluation_thresholds_report_quality_latency_and_cost_failures():
    fixture = DEFAULT_RAG_EVALUATION_FIXTURES[0]
    degraded = fixture.__class__(
        name="degraded",
        expected_chunk_ids=fixture.expected_chunk_ids,
        returned_chunk_ids=(),
        expected_tenant_id=fixture.expected_tenant_id,
        returned_tenant_ids=("tenant-b",),
        citations_correct=False,
        quality=0.2,
        latency_ms=200.0,
        cost_units=30.0,
    )

    result = DeterministicRagEvaluator([degraded]).run(
        minimum_recall=1.0,
        minimum_isolation=1.0,
        minimum_citation_correctness=1.0,
        minimum_quality=0.8,
        maximum_latency_ms=100.0,
        maximum_cost_units=10.0,
    )

    assert result.passed is False
    assert result.failures == (
        "recall",
        "tenant_isolation",
        "citation_correctness",
        "quality",
        "latency",
        "cost",
    )
