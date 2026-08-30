"""Provider-free reciprocal-rank fusion and deterministic reranking."""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass

from worker.rag.retrieval import RetrievalDocument, RetrievalHit, RetrievalTenantIsolationError


@dataclass(frozen=True, slots=True)
class FusedHit:
    document: RetrievalDocument
    score: float
    channels: tuple[str, ...]
    ranks: dict[str, int]

    @property
    def chunk_id(self) -> str:
        return self.document.chunk_id


def reciprocal_rank_fusion(
    lexical_hits: Iterable[RetrievalHit],
    vector_hits: Iterable[RetrievalHit],
    *,
    tenant_id: str,
    limit: int,
    rank_constant: int = 60,
) -> list[FusedHit]:
    """Fuse independent rankings while rejecting any cross-tenant candidate."""

    if not tenant_id.strip():
        raise RetrievalTenantIsolationError("rank fusion requires a non-empty tenant filter")
    if limit < 1 or rank_constant < 1:
        raise ValueError("fusion limits must be positive")

    grouped: dict[str, tuple[RetrievalDocument, float, dict[str, int]]] = {}
    for hit in (*tuple(lexical_hits), *tuple(vector_hits)):
        document = hit.document
        if document.tenant_id != tenant_id:
            raise RetrievalTenantIsolationError("rank fusion received a cross-tenant candidate")
        current = grouped.get(document.chunk_id)
        ranks = dict(current[2]) if current else {}
        ranks[hit.channel] = min(hit.rank, ranks.get(hit.channel, hit.rank))
        score = sum(1 / (rank_constant + rank) for rank in ranks.values())
        grouped[document.chunk_id] = (current[0] if current else document, score, ranks)

    fused = [
        FusedHit(
            document=hit,
            score=score,
            channels=tuple(sorted(ranks)),
            ranks=ranks,
        )
        for hit, score, ranks in grouped.values()
    ]
    fused.sort(key=lambda item: (-item.score, item.chunk_id))
    return fused[:limit]


class DeterministicReranker:
    """A transparent reranker that boosts exact query-token coverage."""

    def rerank(self, hits: Iterable[FusedHit], query: str, *, tenant_id: str, limit: int) -> list[FusedHit]:
        if not query.strip() or not tenant_id.strip():
            raise ValueError("reranking query and tenant are required")
        if limit < 1:
            raise ValueError("reranking limit must be positive")
        query_tokens = {token.casefold() for token in query.split() if token.strip()}
        reranked: list[tuple[float, FusedHit]] = []
        for hit in hits:
            if hit.document.tenant_id != tenant_id:
                raise RetrievalTenantIsolationError("reranking received a cross-tenant candidate")
            text_tokens = {token.casefold() for token in hit.document.text.split()}
            coverage = len(query_tokens & text_tokens) / max(len(query_tokens), 1)
            score = hit.score + (coverage * 0.01)
            if not math.isfinite(score):
                raise ValueError("reranking score is invalid")
            reranked.append((score, hit))
        reranked.sort(key=lambda item: (-item[0], item[1].chunk_id))
        return [hit for _, hit in reranked[:limit]]


__all__ = ["DeterministicReranker", "FusedHit", "reciprocal_rank_fusion"]
