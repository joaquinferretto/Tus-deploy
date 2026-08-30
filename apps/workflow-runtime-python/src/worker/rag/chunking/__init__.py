"""Deterministic bounded character chunking with source offsets."""

from __future__ import annotations

from dataclasses import dataclass

from worker.rag.dedup import checksum_bytes
from worker.rag.parsing import ParsedDocument

CHUNKER_VERSION = "bounded.v1"


@dataclass(frozen=True, slots=True)
class ChunkingConfig:
    max_characters: int = 1200
    overlap_characters: int = 200

    def __post_init__(self) -> None:
        if self.max_characters < 1:
            raise ValueError("max_characters must be positive")
        if self.overlap_characters < 0 or self.overlap_characters >= self.max_characters:
            raise ValueError("overlap_characters must be smaller than max_characters")


@dataclass(frozen=True, slots=True)
class Chunk:
    document_id: str
    chunk_index: int
    text: str
    start_offset: int
    end_offset: int
    checksum: str
    chunker_version: str = CHUNKER_VERSION


class SafeChunker:
    def __init__(self, config: ChunkingConfig | None = None) -> None:
        self.config = config or ChunkingConfig()

    def chunk(self, document: ParsedDocument) -> list[Chunk]:
        if not document.text:
            return []
        chunks: list[Chunk] = []
        start = 0
        text_length = len(document.text)
        while start < text_length:
            end = min(start + self.config.max_characters, text_length)
            if end < text_length:
                boundary = document.text.rfind(" ", start + self.config.max_characters // 2, end)
                if boundary > start:
                    end = boundary
            segment = document.text[start:end]
            if not segment:
                raise ValueError("chunker produced an empty segment")
            chunks.append(
                Chunk(
                    document_id=document.document_id,
                    chunk_index=len(chunks),
                    text=segment,
                    start_offset=start,
                    end_offset=end,
                    checksum=checksum_bytes(segment.encode("utf-8")),
                )
            )
            if end >= text_length:
                break
            next_start = end - self.config.overlap_characters
            if next_start <= start:
                next_start = end
            start = next_start
        return chunks
