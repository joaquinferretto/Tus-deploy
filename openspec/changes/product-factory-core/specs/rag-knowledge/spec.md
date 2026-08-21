# RAG and Knowledge Specification

## Purpose

Provide complete multi-tenant knowledge retrieval, governed by LangGraph, with B2 as source of truth and PostgreSQL/PGVector as the baseline index.

## Requirements

### Requirement: Governed B2 ingestion and lineage

The system MUST ingest tenant-authorized B2 assets through parsing, safe chunking, deduplication, metadata, lineage, retention, and AWS embedding ports; MUST persist owned index records in PostgreSQL/PGVector; and MUST never treat transient S3 as a permanent source. Rationale: retrieval quality and deletion depend on traceable source ownership.

#### Scenario: Ingestion success
- GIVEN an authorized B2 document and consent policy
- WHEN ingestion completes
- THEN chunks, embedding version, source lineage, tenant, checksum, and retention metadata are queryable

#### Scenario: Invalid or duplicate document
- GIVEN an unreadable, oversized, unsafe, or duplicate asset
- WHEN ingestion runs or retries
- THEN it is rejected/quarantined idempotently, no partial tenant-visible index remains, and the reason is auditable

#### Scenario: Tenant isolation
- GIVEN documents for tenants A and B with overlapping text
- WHEN tenant A retrieves knowledge
- THEN only A-authorized chunks and citations can be returned

### Requirement: Hybrid retrieval and LangGraph citations

LangGraph MUST orchestrate lexical/vector retrieval, tenant filters, rank fusion/reranking, context limits, citations, and answer generation; PostgreSQL/PGVector MUST be the baseline; Bedrock Knowledge Bases MAY provide retrieval only and MUST NOT own generation or orchestration. Rationale: citations and authority must remain portable.

#### Scenario: Grounded answer
- GIVEN indexed tenant documents and a valid question
- WHEN the graph retrieves and generates
- THEN the response includes source citations, retrieval metadata, and no unscoped context

#### Scenario: Retrieval/provider retry
- GIVEN embedding or retrieval timeout
- WHEN the graph retries
- THEN bounded retry preserves idempotency and returns an explicit unavailable/partial status rather than fabricated uncited content

### Requirement: Update, delete, reindex, and evaluation evidence

The system MUST support source update/delete, index reprocessing, stale-version detection, reconciliation, and evaluation fixtures for recall, tenant isolation, citation correctness, quality, latency, and cost; MUST propagate privacy deletion to derived indexes. Rationale: a static index is not a governed knowledge system.

#### Scenario: Source deletion
- GIVEN a tenant-authorized deletion or retention expiry
- WHEN cleanup runs
- THEN B2 metadata, chunks, vectors, caches, staged objects, and citations are removed or invalidated and the ledger proves completion

#### Scenario: Reindex rollback
- GIVEN a new parser or embedding version produces degraded evaluation results
- WHEN operators roll back the index version
- THEN the last passing index remains selectable, in-flight work is reconciled, and no source asset is deleted
