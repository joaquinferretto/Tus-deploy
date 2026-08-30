"""Provider-neutral embedding ports with an activation-gated AWS adapter."""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol


class EmbeddingUnavailableError(RuntimeError):
    """Raised when an embedding provider is not activated or configured."""


class EmbeddingProvider(Protocol):
    model: str
    dimensions: int
    embedding_version: str

    def embed_documents(self, texts: Sequence[str]) -> list[tuple[float, ...]]:
        """Return one fixed-width vector for each input text."""


class AwsEmbeddingClient(Protocol):
    def embed_documents(
        self, model: str, texts: Sequence[str], dimensions: int
    ) -> list[tuple[float, ...]]:
        """Provider SDK boundary injected only by an explicitly activated adapter."""


def _validate_texts(texts: Sequence[str]) -> None:
    for text in texts:
        if not isinstance(text, str) or not text.strip():
            raise ValueError("embedding text must be a non-empty string")


def _validate_vectors(
    vectors: Sequence[Sequence[float]], expected_count: int, dimensions: int
) -> list[tuple[float, ...]]:
    if len(vectors) != expected_count:
        raise ValueError("embedding provider returned an unexpected vector count")
    normalized: list[tuple[float, ...]] = []
    for vector in vectors:
        if len(vector) != dimensions or not all(math.isfinite(value) for value in vector):
            raise ValueError("embedding provider returned an invalid vector")
        normalized.append(tuple(float(value) for value in vector))
    return normalized


@dataclass(frozen=True, slots=True)
class DeterministicEmbeddingProvider:
    """Stable local fake; it never reads credentials or calls a provider."""

    model: str = "fake-embedding.v1"
    dimensions: int = 8
    embedding_version: str = "fake-embedding.v1"

    def __post_init__(self) -> None:
        if not self.model.strip() or not self.embedding_version.strip():
            raise ValueError("embedding model and version are required")
        if self.dimensions < 1:
            raise ValueError("embedding dimensions must be positive")

    def embed_documents(self, texts: Sequence[str]) -> list[tuple[float, ...]]:
        _validate_texts(texts)
        vectors: list[tuple[float, ...]] = []
        for text in texts:
            values = [
                (digest_byte / 127.5) - 1.0
                for digest_byte in hashlib.sha256(
                    f"{self.model}\0{text}".encode()
                ).digest()
            ]
            repeated = (values * ((self.dimensions + len(values) - 1) // len(values)))[
                : self.dimensions
            ]
            magnitude = math.sqrt(sum(value * value for value in repeated))
            vectors.append(tuple(value / magnitude for value in repeated))
        return vectors


@dataclass(slots=True)
class AwsEmbeddingProvider:
    """AWS/Bedrock embedding port; SDK access is impossible while the gate is closed."""

    model: str = "amazon.titan-embed-text-v2:0"
    dimensions: int = 1024
    embedding_version: str = "bedrock-embedding.v1"
    activated: bool = False
    client: AwsEmbeddingClient | None = None
    activation_gate: str = "aws-embedding-credentials-region-quota-owner-smoke"

    def __post_init__(self) -> None:
        if not self.model.strip() or not self.embedding_version.strip():
            raise ValueError("embedding model and version are required")
        if self.dimensions < 1:
            raise ValueError("embedding dimensions must be positive")

    def embed_documents(self, texts: Sequence[str]) -> list[tuple[float, ...]]:
        _validate_texts(texts)
        if not self.activated:
            raise EmbeddingUnavailableError(
                f"AWS embeddings are unavailable until the activation gate is satisfied: "
                f"{self.activation_gate}"
            )
        if self.client is None:
            raise EmbeddingUnavailableError("AWS embedding client is unavailable")
        vectors = self.client.embed_documents(self.model, texts, self.dimensions)
        return _validate_vectors(vectors, len(texts), self.dimensions)


BedrockEmbeddingProvider = AwsEmbeddingProvider


__all__ = [
    "AwsEmbeddingClient",
    "AwsEmbeddingProvider",
    "BedrockEmbeddingProvider",
    "DeterministicEmbeddingProvider",
    "EmbeddingProvider",
    "EmbeddingUnavailableError",
]
