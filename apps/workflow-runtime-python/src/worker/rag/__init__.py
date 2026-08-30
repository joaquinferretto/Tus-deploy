"""Provider-free RAG ingestion primitives owned by the Python LangGraph runtime."""

from .chunking import Chunk, ChunkingConfig, SafeChunker
from .citations import Citation, CitationBuilder, CitationValidationError
from .dedup import DeduplicationIndex, checksum_bytes
from .delete import DeletionRequest, DeletionResult, InMemoryDerivedArtifacts, RagDeletionPropagator
from .embeddings import (
    AwsEmbeddingProvider,
    BedrockEmbeddingProvider,
    DeterministicEmbeddingProvider,
    EmbeddingUnavailableError,
)
from .evaluations import (
    DEFAULT_RAG_EVALUATION_FIXTURES,
    DeterministicRagEvaluator,
    RagEvaluationFixture,
    RagEvaluationResult,
)
from .graph import (
    LANGGRAPH_AUTHORITY,
    RAG_GRAPH_VERSION,
    RagQuery,
    RagRetrievalGraph,
    RagRetrievalResult,
)
from .ingest import (
    B2Object,
    IngestRequest,
    IngestResult,
    InMemoryB2Source,
    InMemoryChunkIndex,
    InMemoryIngestLedger,
    InMemoryQuarantineStore,
    RagIngestor,
    SourceAuthorizationError,
)
from .lineage import TenantLineage
from .parsing import (
    DocumentTooLargeError,
    ParsedDocument,
    ParserConfig,
    SafeParser,
    UnsupportedMimeTypeError,
)
from .pgvector import (
    EmbeddingMetadata,
    EmbeddingRecord,
    InMemoryPgVectorIndex,
    PgVectorOwnership,
    PgVectorUnavailableError,
    RagEmbeddingIndexer,
    TenantFilterError,
    UnavailablePgVectorIndex,
)
from .reconciliation import RagReconciliationService, ReconciliationReport
from .reindex import ReindexCoordinator, ReindexResult, RetainedIndexSelector
from .reranking import DeterministicReranker, FusedHit, reciprocal_rank_fusion
from .retrieval import (
    InMemoryLexicalRetriever,
    InMemoryVectorRetriever,
    RetrievalDocument,
    RetrievalHit,
    RetrievalLimits,
    RetrievalProviderError,
    RetrievalProviderTimeoutError,
    RetrievalProviderUnavailableError,
    RetrievalTenantIsolationError,
    UnavailableRetrievalProvider,
    documents_from_chunks_and_embeddings,
)
from .update import RagUpdater, UpdateRequest, UpdateResult

__all__ = [
    "DEFAULT_RAG_EVALUATION_FIXTURES",
    "LANGGRAPH_AUTHORITY",
    "RAG_GRAPH_VERSION",
    "AwsEmbeddingProvider",
    "B2Object",
    "BedrockEmbeddingProvider",
    "Chunk",
    "ChunkingConfig",
    "Citation",
    "CitationBuilder",
    "CitationValidationError",
    "DeduplicationIndex",
    "DeletionRequest",
    "DeletionResult",
    "DeterministicEmbeddingProvider",
    "DeterministicRagEvaluator",
    "DeterministicReranker",
    "DocumentTooLargeError",
    "EmbeddingMetadata",
    "EmbeddingRecord",
    "EmbeddingUnavailableError",
    "FusedHit",
    "InMemoryB2Source",
    "InMemoryChunkIndex",
    "InMemoryDerivedArtifacts",
    "InMemoryIngestLedger",
    "InMemoryLexicalRetriever",
    "InMemoryPgVectorIndex",
    "InMemoryQuarantineStore",
    "InMemoryVectorRetriever",
    "IngestRequest",
    "IngestResult",
    "ParsedDocument",
    "ParserConfig",
    "PgVectorOwnership",
    "PgVectorUnavailableError",
    "RagDeletionPropagator",
    "RagEmbeddingIndexer",
    "RagEvaluationFixture",
    "RagEvaluationResult",
    "RagIngestor",
    "RagQuery",
    "RagReconciliationService",
    "RagRetrievalGraph",
    "RagRetrievalResult",
    "RagUpdater",
    "ReconciliationReport",
    "ReindexCoordinator",
    "ReindexResult",
    "RetainedIndexSelector",
    "RetrievalDocument",
    "RetrievalHit",
    "RetrievalLimits",
    "RetrievalProviderError",
    "RetrievalProviderTimeoutError",
    "RetrievalProviderUnavailableError",
    "RetrievalTenantIsolationError",
    "SafeChunker",
    "SafeParser",
    "SourceAuthorizationError",
    "TenantFilterError",
    "TenantLineage",
    "UnavailablePgVectorIndex",
    "UnavailableRetrievalProvider",
    "UnsupportedMimeTypeError",
    "UpdateRequest",
    "UpdateResult",
    "checksum_bytes",
    "documents_from_chunks_and_embeddings",
    "reciprocal_rank_fusion",
]
