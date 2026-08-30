"""Privacy-aware deletion propagation for RAG derived state."""

from __future__ import annotations

from dataclasses import dataclass

from worker.rag.ingest import InMemoryB2Source, InMemoryChunkIndex
from worker.rag.pgvector import InMemoryPgVectorIndex


@dataclass(frozen=True, slots=True)
class DeletionRequest:
    tenant_id: str
    source_id: str
    actor_id: str
    idempotency_key: str
    workspace_id: str | None = None

    def __post_init__(self) -> None:
        for name in ("tenant_id", "source_id", "actor_id", "idempotency_key"):
            if not getattr(self, name).strip():
                raise ValueError(f"deletion {name} is required")


@dataclass(frozen=True, slots=True)
class DeletionResult:
    status: str
    tenant_id: str
    source_id: str
    removed_chunks: int
    removed_vectors: int
    removed_artifacts: int
    idempotent: bool = False
    ledger_id: str | None = None


class InMemoryDerivedArtifacts:
    """Deterministic cache/staging/citation fake used by deletion tests."""

    def __init__(self) -> None:
        self._artifacts: dict[tuple[str, str], set[str]] = {}

    def add(self, tenant_id: str, source_id: str, kind: str) -> None:
        self._artifacts.setdefault((tenant_id, source_id), set()).add(kind)

    def remove_source(self, tenant_id: str, source_id: str) -> int:
        return len(self._artifacts.pop((tenant_id, source_id), set()))

    def remaining(self, tenant_id: str, source_id: str) -> list[str]:
        return sorted(self._artifacts.get((tenant_id, source_id), set()))

    def tenants_for_source(self, source_id: str) -> set[str]:
        return {
            tenant_id for tenant_id, stored_source in self._artifacts if stored_source == source_id
        }


class RagDeletionPropagator:
    """Delete or invalidate all derived RAG state exactly once per request."""

    def __init__(
        self,
        chunks: InMemoryChunkIndex,
        vectors: InMemoryPgVectorIndex,
        artifacts: InMemoryDerivedArtifacts,
        *,
        source: InMemoryB2Source | None = None,
    ) -> None:
        self.chunks = chunks
        self.vectors = vectors
        self.artifacts = artifacts
        self.source = source
        self.ledger: dict[tuple[str, str], DeletionResult] = {}

    def delete(self, request: DeletionRequest) -> DeletionResult:
        key = (request.tenant_id, request.idempotency_key)
        existing = self.ledger.get(key)
        if existing is not None:
            return DeletionResult(
                status=existing.status,
                tenant_id=existing.tenant_id,
                source_id=existing.source_id,
                removed_chunks=existing.removed_chunks,
                removed_vectors=existing.removed_vectors,
                removed_artifacts=existing.removed_artifacts,
                idempotent=True,
                ledger_id=existing.ledger_id,
            )
        known_tenants = (
            self.chunks.tenants_for_source(request.source_id)
            | self.vectors.tenants_for_source(request.source_id)
            | self.artifacts.tenants_for_source(request.source_id)
        )
        if known_tenants and request.tenant_id not in known_tenants:
            raise PermissionError("RAG deletion is tenant-scoped")
        if self.source is not None:
            self.source.delete(
                source_id=request.source_id,
                tenant_id=request.tenant_id,
                actor_id=request.actor_id,
                workspace_id=request.workspace_id,
            )
        removed_chunks = self.chunks.delete_source(request.tenant_id, request.source_id)
        removed_vectors = self.vectors.delete_all_versions(request.tenant_id, request.source_id)
        removed_artifacts = self.artifacts.remove_source(request.tenant_id, request.source_id)
        result = DeletionResult(
            status="completed",
            tenant_id=request.tenant_id,
            source_id=request.source_id,
            removed_chunks=removed_chunks,
            removed_vectors=removed_vectors,
            removed_artifacts=removed_artifacts,
            ledger_id=f"delete:{request.tenant_id}:{request.idempotency_key}",
        )
        self.ledger[key] = result
        return result


__all__ = ["DeletionRequest", "DeletionResult", "InMemoryDerivedArtifacts", "RagDeletionPropagator"]
