"""Deterministic, tenant-safe lexical and vector retrieval ports."""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from worker.rag.ingest import ChunkRecord
    from worker.rag.pgvector import EmbeddingRecord


class RetrievalProviderError(RuntimeError):
    """Base error for a retrieval boundary that cannot produce candidates."""


class RetrievalProviderUnavailableError(RetrievalProviderError):
    """Raised when a retrieval provider is explicitly disabled or unprovisioned."""


class RetrievalProviderTimeoutError(TimeoutError, RetrievalProviderError):
    """Raised when a retrieval provider exceeds its bounded time budget."""


class RetrievalTenantIsolationError(PermissionError):
    """Raised when a retrieval result crosses the requested tenant boundary."""


@dataclass(frozen=True, slots=True)
class RetrievalLimits:
    """Hard bounds applied before rank fusion and answer context construction."""

    max_candidates: int = 50
    max_results: int = 8
    max_context_characters: int = 6_000
    max_citation_characters: int = 320

    def __post_init__(self) -> None:
        for name in (
            "max_candidates",
            "max_results",
            "max_context_characters",
            "max_citation_characters",
        ):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                raise ValueError(f"{name} must be positive")
        if self.max_results > self.max_candidates:
            raise ValueError("max_results cannot exceed max_candidates")


@dataclass(frozen=True, slots=True)
class RetrievalDocument:
    """A chunk plus the immutable lineage needed to make a citation auditable."""

    chunk_id: str
    tenant_id: str
    workspace_id: str
    source_id: str
    text: str
    vector: tuple[float, ...]
    source_uri: str
    source_checksum: str
    chunk_index: int
    start_offset: int
    end_offset: int
    embedding_version: str
    index_version: str
    retention_until: int | None = None

    @classmethod
    def from_chunk_and_embedding(
        cls,
        chunk: ChunkRecord,
        embedding: EmbeddingRecord,
    ) -> RetrievalDocument:
        """Join P3.7 text with P3.8 vector/lineage records without a second source of truth."""

        if chunk.chunk_id != embedding.chunk_id or chunk.tenant_id != embedding.tenant_id:
            raise RetrievalTenantIsolationError("chunk and embedding records are not tenant aligned")
        metadata = embedding.metadata
        return cls(
            chunk_id=chunk.chunk_id,
            tenant_id=chunk.tenant_id,
            workspace_id=chunk.workspace_id,
            source_id=chunk.source_id,
            text=chunk.text,
            vector=embedding.vector,
            source_uri=metadata.source_uri,
            source_checksum=metadata.source_checksum,
            chunk_index=chunk.chunk_index,
            start_offset=chunk.start_offset,
            end_offset=chunk.end_offset,
            embedding_version=embedding.embedding_version,
            index_version=embedding.index_version,
            retention_until=chunk.retention_until,
        )

    def __post_init__(self) -> None:
        for name in (
            "chunk_id",
            "tenant_id",
            "workspace_id",
            "source_id",
            "text",
            "source_uri",
            "source_checksum",
            "embedding_version",
            "index_version",
        ):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"retrieval document {name} is required")
        if not self.source_uri.startswith("b2://"):
            raise ValueError("retrieval document source_uri must use the B2 boundary")
        if self.chunk_index < 0 or self.start_offset < 0 or self.end_offset < self.start_offset:
            raise ValueError("retrieval document offsets are invalid")
        if self.end_offset - self.start_offset != len(self.text):
            raise ValueError("retrieval document offsets must cover the chunk text")
        if not self.vector or not all(math.isfinite(value) for value in self.vector):
            raise ValueError("retrieval document vector must contain finite values")

    def as_hit(self, *, score: float, channel: str, rank: int) -> RetrievalHit:
        return RetrievalHit(self, float(score), channel, rank)


@dataclass(frozen=True, slots=True)
class RetrievalHit:
    document: RetrievalDocument
    score: float
    channel: str
    rank: int

    def __post_init__(self) -> None:
        if self.channel not in {"lexical", "vector"}:
            raise ValueError("retrieval channel is unsupported")
        if self.rank < 1 or not math.isfinite(self.score):
            raise ValueError("retrieval hit rank and score are invalid")


class QueryEmbeddingProvider(Protocol):
    def embed_documents(self, texts: Sequence[str]) -> list[tuple[float, ...]]:
        """Return one query vector for each input string."""


class RetrievalProvider(Protocol):
    def search(self, tenant_id: str, query: str, *, limit: int) -> list[RetrievalHit]:
        """Return only candidates authorized for tenant_id."""


def _require_query(tenant_id: str, query: str, limit: int) -> tuple[str, str, int]:
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise RetrievalTenantIsolationError("retrieval requires a non-empty tenant filter")
    if not isinstance(query, str) or not query.strip():
        raise ValueError("retrieval query is required")
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1:
        raise ValueError("retrieval limit must be positive")
    return tenant_id.strip(), query.strip(), limit


def _tokens(value: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(re.findall(r"[\w-]+", value.casefold())))


class InMemoryLexicalRetriever:
    """Provider-free lexical fake using deterministic token overlap scoring."""

    def __init__(self, documents: Iterable[RetrievalDocument]) -> None:
        self.documents = tuple(documents)

    def search(self, tenant_id: str, query: str, *, limit: int) -> list[RetrievalHit]:
        tenant, query_text, bounded_limit = _require_query(tenant_id, query, limit)
        query_tokens = set(_tokens(query_text))
        scored: list[tuple[float, RetrievalDocument]] = []
        for document in self.documents:
            if document.tenant_id != tenant:
                continue
            document_tokens = set(_tokens(document.text))
            overlap = len(query_tokens & document_tokens)
            if overlap:
                scored.append((overlap / len(query_tokens), document))
        scored.sort(key=lambda item: (-item[0], item[1].chunk_id))
        return [document.as_hit(score=score, channel="lexical", rank=index) for index, (score, document) in enumerate(scored[:bounded_limit], 1)]


class InMemoryVectorRetriever:
    """Provider-free vector fake with cosine similarity and mandatory tenant filtering."""

    def __init__(
        self,
        documents: Iterable[RetrievalDocument],
        query_embeddings: QueryEmbeddingProvider,
    ) -> None:
        self.documents = tuple(documents)
        self.query_embeddings = query_embeddings

    def search(self, tenant_id: str, query: str, *, limit: int) -> list[RetrievalHit]:
        tenant, query_text, bounded_limit = _require_query(tenant_id, query, limit)
        vectors = self.query_embeddings.embed_documents([query_text])
        if len(vectors) != 1:
            raise RetrievalProviderError("query embedding provider returned an unexpected vector count")
        query_vector = tuple(vectors[0])
        scored: list[tuple[float, RetrievalDocument]] = []
        for document in self.documents:
            if document.tenant_id != tenant:
                continue
            if len(document.vector) != len(query_vector):
                raise RetrievalProviderError("query and document vector dimensions do not match")
            score = _cosine_similarity(query_vector, document.vector)
            if score > 0:
                scored.append((score, document))
        scored.sort(key=lambda item: (-item[0], item[1].chunk_id))
        return [document.as_hit(score=score, channel="vector", rank=index) for index, (score, document) in enumerate(scored[:bounded_limit], 1)]


class UnavailableRetrievalProvider:
    """Explicit live retrieval boundary; it never falls back to a hidden provider."""

    def __init__(self, reason: str = "retrieval provider is not provisioned") -> None:
        if not reason.strip():
            raise ValueError("retrieval unavailability reason is required")
        self.reason = reason

    def search(self, tenant_id: str, query: str, *, limit: int) -> list[RetrievalHit]:
        del tenant_id, query, limit
        raise RetrievalProviderUnavailableError(self.reason)


def _cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    left_magnitude = math.sqrt(sum(value * value for value in left))
    right_magnitude = math.sqrt(sum(value * value for value in right))
    if left_magnitude == 0 or right_magnitude == 0:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True)) / (left_magnitude * right_magnitude)


def documents_from_chunks_and_embeddings(
    chunks: Iterable[ChunkRecord],
    embeddings: Iterable[EmbeddingRecord],
    *,
    tenant_id: str,
) -> tuple[RetrievalDocument, ...]:
    """Create a deterministic retrieval corpus from tenant-filtered P3.7/P3.8 records."""

    if not tenant_id.strip():
        raise RetrievalTenantIsolationError("retrieval corpus requires a non-empty tenant filter")
    chunk_by_id = {chunk.chunk_id: chunk for chunk in chunks if chunk.tenant_id == tenant_id}
    documents: list[RetrievalDocument] = []
    for embedding in embeddings:
        if embedding.tenant_id != tenant_id:
            raise RetrievalTenantIsolationError("embedding corpus crosses tenant boundary")
        chunk = chunk_by_id.get(embedding.chunk_id)
        if chunk is None:
            raise ValueError("embedding has no matching chunk record")
        documents.append(RetrievalDocument.from_chunk_and_embedding(chunk, embedding))
    return tuple(sorted(documents, key=lambda document: document.chunk_id))


__all__ = [
    "InMemoryLexicalRetriever",
    "InMemoryVectorRetriever",
    "QueryEmbeddingProvider",
    "RetrievalDocument",
    "RetrievalHit",
    "RetrievalLimits",
    "RetrievalProvider",
    "RetrievalProviderError",
    "RetrievalProviderTimeoutError",
    "RetrievalProviderUnavailableError",
    "RetrievalTenantIsolationError",
    "UnavailableRetrievalProvider",
    "documents_from_chunks_and_embeddings",
]
