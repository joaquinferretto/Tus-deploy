"""Tenant-safe PGVector ownership and deterministic indexing primitives."""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

from worker.rag.embeddings import EmbeddingProvider
from worker.rag.ingest import ChunkRecord

PGVECTOR_DATA_CLASS: Final = "vectors_and_retrieval_metadata"
PGVECTOR_OWNER: Final = "postgresql"
PGVECTOR_REBUILD_STRATEGY: Final = "rebuild-from-b2-lineage"


class TenantFilterError(ValueError):
    """Raised when a vector operation is unscoped or crosses tenant boundaries."""


class PgVectorUnavailableError(RuntimeError):
    """Raised when the live PostgreSQL/PGVector adapter is not available."""


@dataclass(frozen=True, slots=True)
class PgVectorOwnership:
    data_class: str = PGVECTOR_DATA_CLASS
    owner: str = PGVECTOR_OWNER
    source_of_truth: str = "b2-lineage"
    rebuild_strategy: str = PGVECTOR_REBUILD_STRATEGY
    tenant_scoped: bool = True


@dataclass(frozen=True, slots=True)
class EmbeddingMetadata:
    source_asset_id: str
    source_uri: str
    source_checksum: str
    parser_version: str
    chunker_version: str
    retention_until: int | None

    def __post_init__(self) -> None:
        for name in (
            "source_asset_id",
            "source_uri",
            "source_checksum",
            "parser_version",
            "chunker_version",
        ):
            if not getattr(self, name).strip():
                raise ValueError(f"embedding metadata {name} is required")
        if not self.source_uri.startswith("b2://"):
            raise ValueError("embedding metadata source_uri must use the B2 boundary")


@dataclass(frozen=True, slots=True)
class EmbeddingRecord:
    embedding_id: str
    chunk_id: str
    tenant_id: str
    workspace_id: str
    source_id: str
    chunk_index: int
    vector: tuple[float, ...]
    model: str
    embedding_version: str
    index_version: str
    metadata: EmbeddingMetadata

    def __post_init__(self) -> None:
        for name in (
            "embedding_id",
            "chunk_id",
            "tenant_id",
            "workspace_id",
            "source_id",
            "model",
            "embedding_version",
            "index_version",
        ):
            if not getattr(self, name).strip():
                raise ValueError(f"embedding record {name} is required")
        if self.chunk_index < 0 or not self.vector:
            raise ValueError("embedding record chunk index and vector are required")
        if not all(math.isfinite(value) for value in self.vector):
            raise ValueError("embedding vector must contain finite values")


class InMemoryPgVectorIndex:
    """Provider-free fake that models owned, versioned, tenant-filtered rows."""

    ownership = PgVectorOwnership()

    def __init__(self, *, index_version: str = "rag-index.v1") -> None:
        if not index_version.strip():
            raise ValueError("index_version is required")
        self.index_version = index_version
        self._records: dict[tuple[str, str, int, str, str], EmbeddingRecord] = {}

    def upsert(self, records: Iterable[EmbeddingRecord], *, tenant_id: str) -> None:
        tenant = self._require_tenant(tenant_id)
        pending = list(records)
        if any(record.tenant_id != tenant for record in pending):
            raise TenantFilterError("all PGVector records must match the tenant filter")
        if any(record.index_version != self.index_version for record in pending):
            raise ValueError("record index version does not match the selected index")
        staged = {
            (
                record.tenant_id,
                record.source_id,
                record.chunk_index,
                record.embedding_version,
                record.index_version,
            ): record
            for record in pending
        }
        self._records.update(staged)

    def list_for_tenant(
        self, tenant_id: str, *, index_version: str | None = None
    ) -> list[EmbeddingRecord]:
        tenant = self._require_tenant(tenant_id)
        selected_version = index_version or self.index_version
        if not selected_version.strip():
            raise ValueError("index_version is required")
        return [
            record
            for record in self._records.values()
            if record.tenant_id == tenant and record.index_version == selected_version
        ]

    def list_for_source(
        self, tenant_id: str, source_id: str, *, index_version: str | None = None
    ) -> list[EmbeddingRecord]:
        return [
            record
            for record in self.list_for_tenant(tenant_id, index_version=index_version)
            if record.source_id == source_id
        ]

    def delete_source(
        self, tenant_id: str, source_id: str, *, index_version: str | None = None
    ) -> int:
        tenant = self._require_tenant(tenant_id)
        selected_version = index_version or self.index_version
        keys = [
            key
            for key, record in self._records.items()
            if record.tenant_id == tenant
            and record.source_id == source_id
            and record.index_version == selected_version
        ]
        for key in keys:
            del self._records[key]
        return len(keys)

    def delete_all_versions(self, tenant_id: str, source_id: str) -> int:
        tenant = self._require_tenant(tenant_id)
        keys = [
            key
            for key, record in self._records.items()
            if record.tenant_id == tenant and record.source_id == source_id
        ]
        for key in keys:
            del self._records[key]
        return len(keys)

    def tenants_for_source(self, source_id: str) -> set[str]:
        return {
            record.tenant_id for record in self._records.values() if record.source_id == source_id
        }

    @staticmethod
    def _require_tenant(tenant_id: str) -> str:
        if not isinstance(tenant_id, str) or not tenant_id.strip():
            raise TenantFilterError("PGVector operations require a non-empty tenant filter")
        return tenant_id.strip()


class UnavailablePgVectorIndex:
    """Explicit live boundary used when PostgreSQL/PGVector is not provisioned."""

    ownership = PgVectorOwnership()
    index_version = "unavailable"

    def upsert(self, records: Iterable[EmbeddingRecord], *, tenant_id: str) -> None:
        del records, tenant_id
        raise PgVectorUnavailableError(
            "PostgreSQL/PGVector is unavailable; use a deterministic fake"
        )

    def list_for_tenant(
        self, tenant_id: str, *, index_version: str | None = None
    ) -> list[EmbeddingRecord]:
        del tenant_id, index_version
        raise PgVectorUnavailableError(
            "PostgreSQL/PGVector is unavailable; use a deterministic fake"
        )


class RagEmbeddingIndexer:
    """Turns authorized P3.7 chunks into versioned, rebuildable vector rows."""

    def __init__(
        self,
        provider: EmbeddingProvider,
        index: InMemoryPgVectorIndex,
        *,
        embedding_version: str | None = None,
    ) -> None:
        self.provider = provider
        self.vector_index = index
        self.embedding_version = embedding_version or provider.embedding_version
        if not self.embedding_version.strip():
            raise ValueError("embedding_version is required")

    def index_chunks(self, chunks: Iterable[ChunkRecord]) -> list[EmbeddingRecord]:
        pending = list(chunks)
        if not pending:
            return []
        tenant_ids = {chunk.tenant_id for chunk in pending}
        if len(tenant_ids) != 1:
            raise TenantFilterError("one tenant filter is required per embedding batch")
        tenant_id = next(iter(tenant_ids))
        vectors = self.provider.embed_documents([chunk.text for chunk in pending])
        if len(vectors) != len(pending):
            raise ValueError("embedding provider returned an unexpected vector count")
        records = [
            EmbeddingRecord(
                embedding_id=(
                    f"{chunk.tenant_id}:{chunk.source_id}:{chunk.chunk_index}:"
                    f"{self.embedding_version}:{self.vector_index.index_version}"
                ),
                chunk_id=chunk.chunk_id,
                tenant_id=chunk.tenant_id,
                workspace_id=chunk.workspace_id,
                source_id=chunk.source_id,
                chunk_index=chunk.chunk_index,
                vector=tuple(vectors[index]),
                model=self.provider.model,
                embedding_version=self.embedding_version,
                index_version=self.vector_index.index_version,
                metadata=EmbeddingMetadata(
                    source_asset_id=chunk.lineage.source_asset_id,
                    source_uri=chunk.lineage.source_uri,
                    source_checksum=chunk.lineage.checksum,
                    parser_version=chunk.lineage.parser_version,
                    chunker_version=chunk.lineage.chunker_version,
                    retention_until=chunk.retention_until,
                ),
            )
            for index, chunk in enumerate(pending)
        ]
        self.vector_index.upsert(records, tenant_id=tenant_id)
        return records

    def index(self, chunks: Iterable[ChunkRecord]) -> list[EmbeddingRecord]:
        return self.index_chunks(chunks)


__all__ = [
    "PGVECTOR_DATA_CLASS",
    "PGVECTOR_OWNER",
    "PGVECTOR_REBUILD_STRATEGY",
    "EmbeddingMetadata",
    "EmbeddingRecord",
    "InMemoryPgVectorIndex",
    "PgVectorOwnership",
    "PgVectorUnavailableError",
    "RagEmbeddingIndexer",
    "TenantFilterError",
    "UnavailablePgVectorIndex",
]
