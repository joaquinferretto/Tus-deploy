import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.rag.citations import CitationBuilder
from worker.rag.graph import RagQuery, RagRetrievalGraph
from worker.rag.reranking import reciprocal_rank_fusion
from worker.rag.retrieval import (
    InMemoryLexicalRetriever,
    InMemoryVectorRetriever,
    RetrievalDocument,
    RetrievalLimits,
    RetrievalProviderUnavailableError,
)


@dataclass
class FixedQueryEmbedder:
    vectors: dict[str, tuple[float, ...]]

    def embed_documents(self, texts: list[str]) -> list[tuple[float, ...]]:
        return [self.vectors[text] for text in texts]


def document(
    chunk_id: str,
    text: str,
    *,
    tenant_id: str = "tenant-a",
    vector: tuple[float, ...] = (1.0, 0.0),
    source_id: str = "source-a",
) -> RetrievalDocument:
    return RetrievalDocument(
        chunk_id=chunk_id,
        tenant_id=tenant_id,
        workspace_id=f"workspace-{tenant_id}",
        source_id=source_id,
        text=text,
        vector=vector,
        source_uri=f"b2://{tenant_id}/{source_id}.txt",
        source_checksum=chunk_id.ljust(64, "0")[:64],
        chunk_index=0,
        start_offset=0,
        end_offset=len(text),
        embedding_version="fake-embedding.v1",
        index_version="rag-index.v1",
    )


def query(**overrides: object) -> RagQuery:
    values: dict[str, object] = {
        "tenant_id": "tenant-a",
        "workspace_id": "workspace-tenant-a",
        "actor_id": "actor-a",
        "correlation_id": "corr-a",
        "query": "alpha policy",
    }
    values.update(overrides)
    return RagQuery(**values)


def retrievers(*documents: RetrievalDocument):
    embedder = FixedQueryEmbedder(
        {"alpha policy": (1.0, 0.0), "beta policy": (0.0, 1.0)}
    )
    return (
        InMemoryLexicalRetriever(documents),
        InMemoryVectorRetriever(documents, embedder),
    )


def test_retrieval_is_tenant_scoped_and_limits_candidates_before_fusion():
    lexical, vector = retrievers(
        document("a-1", "alpha policy for tenant a", vector=(1.0, 0.0)),
        document("a-2", "alpha policy retention for tenant a", vector=(1.0, 0.0)),
        document(
            "b-1", "alpha policy for tenant b", tenant_id="tenant-b", vector=(1.0, 0.0)
        ),
    )

    lexical_hits = lexical.search("tenant-a", "alpha policy", limit=10)
    vector_hits = vector.search("tenant-a", "alpha policy", limit=10)

    assert [hit.document.chunk_id for hit in lexical_hits] == ["a-1", "a-2"]
    assert [hit.document.tenant_id for hit in vector_hits] == ["tenant-a", "tenant-a"]
    assert all(hit.document.chunk_id != "b-1" for hit in lexical_hits + vector_hits)
    with pytest.raises(ValueError, match="positive"):
        RetrievalLimits(max_candidates=0)


def test_rank_fusion_is_deterministic_and_keeps_channel_traceability():
    lexical, vector = retrievers(
        document("a-1", "alpha policy", vector=(1.0, 0.0)),
        document("a-2", "policy details", vector=(0.8, 0.2)),
    )
    fused = reciprocal_rank_fusion(
        lexical.search("tenant-a", "alpha policy", limit=10),
        vector.search("tenant-a", "alpha policy", limit=10),
        tenant_id="tenant-a",
        limit=2,
    )

    assert [item.document.chunk_id for item in fused] == ["a-1", "a-2"]
    assert fused[0].channels == ("lexical", "vector")
    assert fused[0].ranks == {"lexical": 1, "vector": 1}
    assert fused[0].score > fused[1].score


def test_graph_reranks_with_context_and_citations_without_uncited_text():
    lexical, vector = retrievers(
        document("a-1", "alpha policy requires approval", vector=(1.0, 0.0)),
        document("a-2", "alpha policy has a short retention rule", vector=(0.9, 0.1)),
    )
    graph = RagRetrievalGraph(
        lexical,
        vector,
        limits=RetrievalLimits(
            max_candidates=10, max_results=2, max_context_characters=45
        ),
    )

    result = graph.invoke(query())

    assert result.status == "completed"
    assert result.answer == "[1] alpha policy requires approval"
    assert [citation.marker for citation in result.citations] == ["[1]"]
    assert result.citations[0].chunk_id == "a-1"
    assert result.citations[0].source_uri == "b2://tenant-a/source-a.txt"
    assert result.trace["tenantId"] == "tenant-a"
    assert result.trace["selectedChunkIds"] == ["a-1"]
    CitationBuilder.assert_grounded(result.answer, result.citations)


def test_graph_never_admits_an_oversized_first_chunk_into_context():
    lexical, vector = retrievers(
        document("a-1", "alpha policy requires approval", vector=(1.0, 0.0)),
        document("a-2", "alpha", vector=(1.0, 0.0)),
    )
    graph = RagRetrievalGraph(
        lexical,
        vector,
        limits=RetrievalLimits(
            max_candidates=10, max_results=2, max_context_characters=5
        ),
    )

    result = graph.invoke(query())

    assert result.status == "completed"
    assert result.answer == "[1] alpha"
    assert [citation.chunk_id for citation in result.citations] == ["a-2"]
    assert result.trace["selectedContextCharacters"] == len("alpha")
    assert result.trace["selectedContextCharacters"] <= 5


def test_graph_returns_bounded_partial_when_every_chunk_exceeds_context_limit():
    lexical, vector = retrievers(
        document("a-1", "alpha policy requires approval", vector=(1.0, 0.0)),
    )
    graph = RagRetrievalGraph(
        lexical,
        vector,
        limits=RetrievalLimits(
            max_candidates=10, max_results=2, max_context_characters=5
        ),
    )

    result = graph.invoke(query())

    assert result.status == "partial"
    assert result.answer is None
    assert result.citations == ()
    assert result.reason == "context_limit_exceeded"
    assert result.trace["selectedContextCharacters"] == 0
    assert result.trace["maxContextCharacters"] == 5
    assert result.trace["contextLimitExceeded"] is True


def test_graph_retries_timeout_and_returns_partial_when_one_channel_fails():
    lexical, vector = retrievers(document("a-1", "alpha policy requires approval"))
    flaky_vector = TimeoutOnceRetriever(vector)
    graph = RagRetrievalGraph(lexical, flaky_vector, max_retries=1)

    result = graph.invoke(query())

    assert result.status == "completed"
    assert result.answer == "[1] alpha policy requires approval"
    assert result.trace["attempts"]["vector"] == 2
    assert result.trace["providerStatus"] == {
        "lexical": "completed",
        "vector": "completed",
    }

    failed_graph = RagRetrievalGraph(
        lexical, AlwaysUnavailableRetriever("vector"), max_retries=1
    )
    partial = failed_graph.invoke(query())
    assert partial.status == "partial"
    assert partial.answer == "[1] alpha policy requires approval"
    assert partial.trace["providerStatus"] == {
        "lexical": "completed",
        "vector": "unavailable",
    }
    assert partial.trace["errors"]["vector"] == "vector unavailable"


def test_graph_returns_explicit_unavailable_when_no_provider_can_retrieve():
    graph = RagRetrievalGraph(
        AlwaysUnavailableRetriever("lexical"),
        AlwaysUnavailableRetriever("vector"),
        max_retries=1,
    )

    result = graph.invoke(query())

    assert result.status == "unavailable"
    assert result.answer is None
    assert result.citations == ()
    assert result.trace["providerStatus"] == {
        "lexical": "unavailable",
        "vector": "unavailable",
    }


def test_graph_rejects_malicious_cross_tenant_provider_output_without_leaking_citations():
    lexical = MaliciousRetriever(
        document("b-1", "secret tenant b", tenant_id="tenant-b")
    )
    vector = AlwaysUnavailableRetriever("vector")
    result = RagRetrievalGraph(lexical, vector).invoke(query())

    assert result.status == "unavailable"
    assert result.answer is None
    assert result.citations == ()
    assert "b-1" not in str(result.trace)


class TimeoutOnceRetriever:
    def __init__(self, delegate: object) -> None:
        self.delegate = delegate
        self.calls = 0

    def search(self, tenant_id: str, query_text: str, *, limit: int):
        self.calls += 1
        if self.calls == 1:
            raise TimeoutError("vector timeout")
        return self.delegate.search(tenant_id, query_text, limit=limit)


class AlwaysUnavailableRetriever:
    def __init__(self, name: str) -> None:
        self.name = name

    def search(self, tenant_id: str, query_text: str, *, limit: int):
        del tenant_id, query_text, limit
        raise RetrievalProviderUnavailableError(f"{self.name} unavailable")


class MaliciousRetriever:
    def __init__(self, result: RetrievalDocument) -> None:
        self.result = result

    def search(self, tenant_id: str, query_text: str, *, limit: int):
        del tenant_id, query_text, limit
        return [self.result.as_hit(score=1.0, channel="lexical", rank=1)]
