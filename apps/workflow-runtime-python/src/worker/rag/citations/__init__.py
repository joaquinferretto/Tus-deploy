"""Traceable, tenant-scoped citation construction for grounded RAG answers."""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from worker.rag.reranking import FusedHit


class CitationValidationError(ValueError):
    """Raised when an answer contains an unknown or malformed citation marker."""


@dataclass(frozen=True, slots=True)
class Citation:
    marker: str
    chunk_id: str
    tenant_id: str
    source_id: str
    source_uri: str
    source_checksum: str
    chunk_index: int
    start_offset: int
    end_offset: int
    quote: str
    score: float
    channels: tuple[str, ...]

    def __post_init__(self) -> None:
        if not re.fullmatch(r"\[\d+\]", self.marker):
            raise CitationValidationError("citation marker is invalid")
        if not self.quote.strip() or not self.source_uri.startswith("b2://"):
            raise CitationValidationError("citation source and quote are required")
        if self.end_offset < self.start_offset:
            raise CitationValidationError("citation offsets are invalid")


class CitationBuilder:
    """Build citations from selected fused hits and validate answer grounding."""

    @staticmethod
    def build(
        hits: Iterable[FusedHit],
        *,
        tenant_id: str,
        max_citations: int,
        max_quote_characters: int,
    ) -> tuple[Citation, ...]:
        if not tenant_id.strip() or max_citations < 1 or max_quote_characters < 1:
            raise ValueError("citation tenant and limits are required")
        citations: list[Citation] = []
        seen_chunks: set[str] = set()
        for hit in hits:
            document = hit.document
            if document.tenant_id != tenant_id:
                raise PermissionError("citation candidate crosses tenant boundary")
            if document.chunk_id in seen_chunks:
                continue
            seen_chunks.add(document.chunk_id)
            quote = document.text[:max_quote_characters]
            citations.append(
                Citation(
                    marker=f"[{len(citations) + 1}]",
                    chunk_id=document.chunk_id,
                    tenant_id=document.tenant_id,
                    source_id=document.source_id,
                    source_uri=document.source_uri,
                    source_checksum=document.source_checksum,
                    chunk_index=document.chunk_index,
                    start_offset=document.start_offset,
                    end_offset=document.start_offset + len(quote),
                    quote=quote,
                    score=hit.score,
                    channels=hit.channels,
                )
            )
            if len(citations) >= max_citations:
                break
        return tuple(citations)

    @staticmethod
    def render_grounded_answer(citations: Sequence[Citation]) -> str | None:
        if not citations:
            return None
        return " ".join(f"{citation.marker} {citation.quote}" for citation in citations)

    @staticmethod
    def assert_grounded(answer: str | None, citations: Sequence[Citation]) -> None:
        if answer is None:
            if citations:
                raise CitationValidationError("citations cannot exist without an answer")
            return
        markers = set(re.findall(r"\[\d+\]", answer))
        known = {citation.marker for citation in citations}
        if not markers or markers - known:
            raise CitationValidationError("answer contains an unknown or missing citation")


__all__ = ["Citation", "CitationBuilder", "CitationValidationError"]
