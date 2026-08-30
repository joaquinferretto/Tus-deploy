"""Deterministic stale-index detection and repair from B2-derived chunks."""

from __future__ import annotations

from dataclasses import dataclass

from worker.rag.ingest import ChunkRecord
from worker.rag.pgvector import EmbeddingRecord, InMemoryPgVectorIndex, RagEmbeddingIndexer


@dataclass(frozen=True, slots=True)
class ReconciliationReport:
    status: str
    tenant_id: str
    missing_vectors: int
    stale_vectors: int
    orphan_vectors: int
    repaired_vectors: int
    removed_vectors: int
    reasons: tuple[str, ...] = ()


class RagReconciliationService:
    def detect(
        self,
        tenant_id: str,
        chunks: list[ChunkRecord],
        records: list[EmbeddingRecord],
        index: InMemoryPgVectorIndex,
        *,
        expected_embedding_version: str | None = None,
    ) -> ReconciliationReport:
        expected = {chunk.chunk_id: chunk for chunk in chunks if chunk.tenant_id == tenant_id}
        stored_records = index.list_for_tenant(tenant_id)
        # The optional snapshot is useful to callers comparing a ledger read; the
        # index itself is authoritative for the current reconciliation decision.
        del records
        actual = {record.chunk_id: record for record in stored_records}
        missing = len(expected.keys() - actual.keys())
        stale = sum(
            1
            for chunk_id, record in actual.items()
            if chunk_id in expected
            and (
                record.metadata.source_checksum != expected[chunk_id].lineage.checksum
                or record.metadata.parser_version != expected[chunk_id].lineage.parser_version
                or record.metadata.chunker_version != expected[chunk_id].lineage.chunker_version
                or (
                    expected_embedding_version is not None
                    and record.embedding_version != expected_embedding_version
                )
                or record.index_version != index.index_version
            )
        )
        orphan = len(actual.keys() - expected.keys())
        return ReconciliationReport(
            status="stale" if missing or stale or orphan else "consistent",
            tenant_id=tenant_id,
            missing_vectors=missing,
            stale_vectors=stale,
            orphan_vectors=orphan,
            repaired_vectors=0,
            removed_vectors=0,
            reasons=tuple(
                reason
                for reason, count in (
                    ("missing_vector", missing),
                    ("stale_vector", stale),
                    ("orphan_vector", orphan),
                )
                if count
            ),
        )

    def reconcile(
        self,
        tenant_id: str,
        chunks: list[ChunkRecord],
        records: list[EmbeddingRecord],
        index: InMemoryPgVectorIndex,
        indexer: RagEmbeddingIndexer,
    ) -> ReconciliationReport:
        report = self.detect(
            tenant_id,
            chunks,
            records,
            index,
            expected_embedding_version=indexer.embedding_version,
        )
        if report.status == "consistent":
            return report
        removed = index.delete_source(tenant_id, chunks[0].source_id) if chunks else 0
        repaired = len(indexer.index([chunk for chunk in chunks if chunk.tenant_id == tenant_id]))
        return ReconciliationReport(
            status="repaired",
            tenant_id=tenant_id,
            missing_vectors=report.missing_vectors,
            stale_vectors=report.stale_vectors,
            orphan_vectors=report.orphan_vectors,
            repaired_vectors=repaired,
            removed_vectors=removed,
            reasons=report.reasons,
        )


__all__ = ["RagReconciliationService", "ReconciliationReport"]
