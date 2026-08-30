"""Bounded, dependency-light document parsing for authorized B2 content."""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from typing import Final

PARSER_VERSION: Final = "safe-text.v1"
DEFAULT_MAX_BYTES: Final = 5 * 1024 * 1024
SUPPORTED_MIME_TYPES: Final = frozenset(
    {"text/plain", "text/markdown", "text/csv", "application/json"}
)


class UnsupportedMimeTypeError(ValueError):
    """Raised when a source type is outside the safe parser allow-list."""


class DocumentTooLargeError(ValueError):
    """Raised before decoding when a source exceeds the configured byte limit."""


@dataclass(frozen=True, slots=True)
class ParserConfig:
    max_bytes: int = DEFAULT_MAX_BYTES
    allowed_mime_types: frozenset[str] = SUPPORTED_MIME_TYPES

    def __post_init__(self) -> None:
        if self.max_bytes < 1:
            raise ValueError("max_bytes must be positive")
        if not self.allowed_mime_types:
            raise ValueError("allowed_mime_types must not be empty")


@dataclass(frozen=True, slots=True)
class ParsedDocument:
    document_id: str
    mime_type: str
    text: str
    byte_size: int
    parser_version: str = PARSER_VERSION


class SafeParser:
    """Parse only bounded UTF-8 text formats; no URLs, paths, or code execution."""

    def __init__(self, config: ParserConfig | None = None) -> None:
        self.config = config or ParserConfig()

    def parse(self, content: bytes, mime_type: str, document_id: str) -> ParsedDocument:
        if not isinstance(content, bytes):
            raise TypeError("document content must be bytes")
        if not document_id.strip():
            raise ValueError("document_id is required")
        normalized_mime = mime_type.split(";", 1)[0].strip().lower()
        if normalized_mime not in self.config.allowed_mime_types:
            raise UnsupportedMimeTypeError(f"unsupported MIME type: {normalized_mime}")
        if len(content) > self.config.max_bytes:
            raise DocumentTooLargeError(
                f"document exceeds {self.config.max_bytes} byte limit"
            )
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("document is not valid UTF-8") from error
        if "\x00" in text:
            raise ValueError("NUL byte is not allowed in document content")
        if any(ord(char) < 32 and char not in "\n\r\t" for char in text):
            raise ValueError("unsafe control character is not allowed")

        text = text.replace("\r\n", "\n").replace("\r", "\n")
        if normalized_mime == "application/json":
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as error:
                raise ValueError("invalid JSON document") from error
            text = json.dumps(parsed, ensure_ascii=False, indent=2, sort_keys=True)
        elif normalized_mime == "text/csv":
            try:
                list(csv.reader(io.StringIO(text)))
            except csv.Error as error:
                raise ValueError("invalid CSV document") from error

        return ParsedDocument(document_id, normalized_mime, text, len(content))
