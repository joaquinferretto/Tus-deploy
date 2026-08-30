"""Versioned RAG reindexing with a retained last-passing selector."""

from __future__ import annotations

from dataclasses import dataclass

from worker.rag.embeddings import EmbeddingProvider
from worker.rag.ingest import ChunkRecord
from worker.rag.pgvector import InMemoryPgVectorIndex, RagEmbeddingIndexer


@dataclass(frozen=True, slots=True)
class ReindexResult:
    status: str
    index_version: str
    selected_index_version: str
    quality: float
    minimum_quality: float
    indexed_records: int
    source_deleted: bool = False
    reason: str | None = None


class RetainedIndexSelector:
    def __init__(self, *, initial_index_version: str) -> None:
        if not initial_index_version.strip():
            raise ValueError("initial_index_version is required")
        self.selected_index_version = initial_index_version
        self._passing: dict[str, float] = {}

    def mark_passing(self, index_version: str, *, quality: float) -> None:
        if not index_version.strip() or not 0 <= quality <= 1:
            raise ValueError("index version and quality must be valid")
        self._passing[index_version] = quality

    def select(self, index_version: str) -> str:
        if index_version not in self._passing:
            raise ValueError("only a passing index can be selected")
        self.selected_index_version = index_version
        return index_version

    @property
    def last_passing_index_version(self) -> str:
        return self.selected_index_version


class ReindexCoordinator:
    def __init__(self, provider: EmbeddingProvider, selector: RetainedIndexSelector) -> None:
        self.provider = provider
        self.selector = selector
        self.indexes: dict[str, InMemoryPgVectorIndex] = {}

    def reindex(
        self,
        chunks: list[ChunkRecord],
        index_version: str,
        *,
        quality: float,
        minimum_quality: float,
    ) -> ReindexResult:
        if not index_version.strip() or not 0 <= quality <= 1:
            raise ValueError("index version and quality must be valid")
        if not 0 <= minimum_quality <= 1:
            raise ValueError("minimum_quality must be between zero and one")
        index = InMemoryPgVectorIndex(index_version=index_version)
        indexed = RagEmbeddingIndexer(self.provider, index).index(chunks) if chunks else []
        self.indexes[index_version] = index
        if quality < minimum_quality:
            return ReindexResult(
                status="rolled_back",
                index_version=index_version,
                selected_index_version=self.selector.last_passing_index_version,
                quality=quality,
                minimum_quality=minimum_quality,
                indexed_records=len(indexed),
                reason="evaluation_quality_below_threshold",
            )
        self.selector.mark_passing(index_version, quality=quality)
        self.selector.select(index_version)
        return ReindexResult(
            status="completed",
            index_version=index_version,
            selected_index_version=index_version,
            quality=quality,
            minimum_quality=minimum_quality,
            indexed_records=len(indexed),
        )


__all__ = ["ReindexCoordinator", "ReindexResult", "RetainedIndexSelector"]
