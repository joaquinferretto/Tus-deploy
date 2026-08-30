"""LangGraph-owned retrieval workflow with bounded provider degradation."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from worker.langgraph.registry.authority import LANGGRAPH_AUTHORITY
from worker.rag.citations import Citation, CitationBuilder
from worker.rag.reranking import DeterministicReranker, reciprocal_rank_fusion
from worker.rag.retrieval import (
    RetrievalHit,
    RetrievalLimits,
    RetrievalProvider,
    RetrievalProviderError,
    RetrievalProviderUnavailableError,
    RetrievalTenantIsolationError,
)

RAG_GRAPH_VERSION = "rag-retrieval.v1"


@dataclass(frozen=True, slots=True)
class RagQuery:
    tenant_id: str
    workspace_id: str
    actor_id: str
    correlation_id: str
    query: str
    idempotency_key: str = "rag-query"

    def __post_init__(self) -> None:
        for name in (
            "tenant_id",
            "workspace_id",
            "actor_id",
            "correlation_id",
            "query",
            "idempotency_key",
        ):
            if not isinstance(getattr(self, name), str) or not getattr(self, name).strip():
                raise ValueError(f"RAG query {name} is required")


@dataclass(frozen=True, slots=True)
class RagRetrievalResult:
    status: str
    answer: str | None
    citations: tuple[Citation, ...]
    trace: Mapping[str, object]
    reason: str | None = None

    def as_payload(self) -> dict[str, object]:
        return {
            "graphAuthority": LANGGRAPH_AUTHORITY,
            "graphVersion": RAG_GRAPH_VERSION,
            "status": self.status,
            "answer": self.answer,
            "reason": self.reason,
            "citations": [
                {
                    "marker": citation.marker,
                    "chunkId": citation.chunk_id,
                    "tenantId": citation.tenant_id,
                    "sourceId": citation.source_id,
                    "sourceUri": citation.source_uri,
                    "sourceChecksum": citation.source_checksum,
                    "chunkIndex": citation.chunk_index,
                    "startOffset": citation.start_offset,
                    "endOffset": citation.end_offset,
                    "quote": citation.quote,
                    "score": citation.score,
                    "channels": list(citation.channels),
                }
                for citation in self.citations
            ],
            "trace": dict(self.trace),
        }


class RagRetrievalGraph:
    """Orchestrate lexical/vector retrieval, fusion, reranking, and citations."""

    authority = LANGGRAPH_AUTHORITY
    version = RAG_GRAPH_VERSION

    def __init__(
        self,
        lexical: RetrievalProvider,
        vector: RetrievalProvider,
        *,
        limits: RetrievalLimits | None = None,
        max_retries: int = 1,
        reranker: DeterministicReranker | None = None,
    ) -> None:
        if max_retries < 0:
            raise ValueError("max_retries cannot be negative")
        self.lexical = lexical
        self.vector = vector
        self.limits = limits or RetrievalLimits()
        self.max_retries = max_retries
        self.reranker = reranker or DeterministicReranker()

    def invoke(self, request: RagQuery) -> RagRetrievalResult:
        provider_hits: dict[str, list[RetrievalHit]] = {}
        provider_status: dict[str, str] = {}
        attempts: dict[str, int] = {}
        errors: dict[str, str] = {}

        for name, provider in (("lexical", self.lexical), ("vector", self.vector)):
            outcome = self._retrieve_provider(name, provider, request)
            provider_hits[name] = outcome[0]
            provider_status[name] = outcome[1]
            attempts[name] = outcome[2]
            if outcome[3] is not None:
                errors[name] = outcome[3]

        trace: dict[str, object] = {
            "tenantId": request.tenant_id,
            "workspaceId": request.workspace_id,
            "correlationId": request.correlation_id,
            "graphAuthority": self.authority,
            "graphVersion": self.version,
            "providerStatus": provider_status,
            "attempts": attempts,
            "errors": errors,
        }
        if all(status == "unavailable" for status in provider_status.values()):
            return RagRetrievalResult(
                "unavailable", None, (), trace, "all retrieval providers unavailable"
            )

        try:
            fused = reciprocal_rank_fusion(
                provider_hits["lexical"],
                provider_hits["vector"],
                tenant_id=request.tenant_id,
                limit=self.limits.max_candidates,
            )
            reranked = self.reranker.rerank(
                fused,
                request.query,
                tenant_id=request.tenant_id,
                limit=self.limits.max_results,
            )
        except RetrievalTenantIsolationError:
            trace["providerStatus"] = {name: "unavailable" for name in provider_status}
            return RagRetrievalResult(
                "unavailable", None, (), trace, "tenant isolation rejected retrieval output"
            )

        selected = self._select_context(reranked)
        selected_context_characters = sum(len(hit.document.text) for hit in selected)
        trace["maxContextCharacters"] = self.limits.max_context_characters
        trace["selectedContextCharacters"] = selected_context_characters
        if reranked and not selected:
            trace["contextLimitExceeded"] = True
            return RagRetrievalResult(
                "partial",
                None,
                (),
                trace,
                "context_limit_exceeded",
            )

        citations = CitationBuilder.build(
            selected,
            tenant_id=request.tenant_id,
            max_citations=self.limits.max_results,
            max_quote_characters=self.limits.max_citation_characters,
        )
        answer = CitationBuilder.render_grounded_answer(citations)
        trace["selectedChunkIds"] = [citation.chunk_id for citation in citations]
        trace["channels"] = sorted({channel for hit in selected for channel in hit.channels})
        if answer is None:
            status = "partial" if "unavailable" in provider_status.values() else "completed"
            reason = "no_grounded_context"
        else:
            status = "partial" if "unavailable" in provider_status.values() else "completed"
            reason = None
        return RagRetrievalResult(status, answer, citations, trace, reason)

    run = invoke

    def _retrieve_provider(
        self,
        name: str,
        provider: RetrievalProvider,
        request: RagQuery,
    ) -> tuple[list[RetrievalHit], str, int, str | None]:
        last_error: str | None = None
        attempts = 0
        for attempt in range(1, self.max_retries + 2):
            attempts = attempt
            try:
                hits = provider.search(
                    request.tenant_id,
                    request.query,
                    limit=self.limits.max_candidates,
                )
                self._assert_tenant_hits(hits, request.tenant_id)
                return hits, "completed", attempt, None
            except RetrievalTenantIsolationError:
                return [], "unavailable", attempt, "tenant isolation rejected provider output"
            except (TimeoutError, RetrievalProviderError) as error:
                last_error = self._safe_error(name, error)
                if isinstance(error, RetrievalProviderUnavailableError):
                    break
        return [], "unavailable", attempts, last_error or f"{name} unavailable"

    @staticmethod
    def _assert_tenant_hits(hits: list[RetrievalHit], tenant_id: str) -> None:
        if any(hit.document.tenant_id != tenant_id for hit in hits):
            raise RetrievalTenantIsolationError("provider output crossed tenant boundary")

    @staticmethod
    def _safe_error(provider: str, error: Exception) -> str:
        if isinstance(error, RetrievalTenantIsolationError):
            return "tenant isolation rejected provider output"
        message = str(error).strip()
        return f"{provider} unavailable" if not message else message

    def _select_context(self, hits: list) -> list:
        selected = []
        used_characters = 0
        for hit in hits:
            text_length = len(hit.document.text)
            if text_length > self.limits.max_context_characters:
                continue
            if selected and used_characters + text_length > self.limits.max_context_characters:
                continue
            selected.append(hit)
            used_characters += text_length
            if len(selected) >= self.limits.max_results:
                break
        return selected


__all__ = [
    "LANGGRAPH_AUTHORITY",
    "RAG_GRAPH_VERSION",
    "RagQuery",
    "RagRetrievalGraph",
    "RagRetrievalResult",
]
