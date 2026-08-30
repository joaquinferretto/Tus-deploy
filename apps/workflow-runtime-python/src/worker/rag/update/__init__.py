"""Tenant-safe source updates that replace all derived RAG state."""

from __future__ import annotations

from dataclasses import dataclass

from worker.rag.ingest import IngestRequest, InMemoryB2Source, InMemoryChunkIndex, RagIngestor
from worker.rag.pgvector import InMemoryPgVectorIndex, RagEmbeddingIndexer


@dataclass(frozen=True, slots=True)
class UpdateRequest:
    tenant_id: str
    workspace_id: str
    actor_id: str
    correlation_id: str
    root_message_id: str
    source_id: str
    idempotency_key: str
    retention_until: int | None

    @classmethod
    def from_ingest(cls, request: IngestRequest) -> UpdateRequest:
        return cls(
            tenant_id=request.tenant_id,
            workspace_id=request.workspace_id,
            actor_id=request.actor_id,
            correlation_id=request.correlation_id,
            root_message_id=request.root_message_id,
            source_id=request.source_id,
            idempotency_key=request.idempotency_key,
            retention_until=request.retention_until,
        )

    def as_ingest(self) -> IngestRequest:
        return IngestRequest(
            tenant_id=self.tenant_id,
            workspace_id=self.workspace_id,
            actor_id=self.actor_id,
            correlation_id=self.correlation_id,
            root_message_id=self.root_message_id,
            source_id=self.source_id,
            idempotency_key=self.idempotency_key,
            retention_until=self.retention_until,
        )


@dataclass(frozen=True, slots=True)
class UpdateResult:
    status: str
    source_id: str
    tenant_id: str
    checksum: str | None
    previous_checksum: str | None
    chunk_count: int
    reason: str | None = None


class RagUpdater:
    """Rebuild a source in place while keeping tenant and lineage boundaries."""

    def __init__(
        self,
        source: InMemoryB2Source,
        chunks: InMemoryChunkIndex,
        vectors: InMemoryPgVectorIndex,
        ingestor: RagIngestor,
        indexer: RagEmbeddingIndexer,
    ) -> None:
        self.source = source
        self.chunks = chunks
        self.vectors = vectors
        self.ingestor = ingestor
        self.indexer = indexer

    def update(self, request: UpdateRequest) -> UpdateResult:
        previous = self.chunks.list_for_source(request.tenant_id, request.source_id)
        previous_checksum = previous[0].lineage.checksum if previous else None
        # Fetch first: the B2 adapter enforces tenant/workspace/actor authorization.
        self.source.fetch(
            source_id=request.source_id,
            tenant_id=request.tenant_id,
            workspace_id=request.workspace_id,
            actor_id=request.actor_id,
        )
        self.chunks.delete_source(request.tenant_id, request.source_id)
        self.vectors.delete_all_versions(request.tenant_id, request.source_id)
        result = self.ingestor.ingest(request.as_ingest())
        if result.status == "completed":
            self.indexer.index(self.chunks.list_for_source(request.tenant_id, request.source_id))
        return UpdateResult(
            status=result.status,
            source_id=result.source_id,
            tenant_id=result.tenant_id,
            checksum=result.checksum,
            previous_checksum=previous_checksum,
            chunk_count=result.chunk_count,
            reason=result.reason,
        )


__all__ = ["RagUpdater", "UpdateRequest", "UpdateResult"]
