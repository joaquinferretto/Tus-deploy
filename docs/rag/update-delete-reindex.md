# RAG source lifecycle

P3.10 keeps B2 as the source of truth and treats chunks, vectors, caches, staged
objects, and citations as rebuildable derived state. Every lifecycle operation is
tenant-scoped and carries an idempotency key.

## Update

An authorized update validates the B2 source boundary, removes the old source's
derived chunks and vectors, ingests the new checksum, and writes new embeddings
with the new lineage. A failed parse or commit is reported as `partial`; no new
chunks or vectors become tenant-visible until ingestion and indexing complete.
The B2 object is never deleted as part of a failed reindex.

## Delete and privacy propagation

Deletion is recorded once in the tenant-scoped ledger. It propagates to chunk
records, PGVector rows, retrieval caches, staged objects, and citation artifacts.
Repeating the same idempotency key returns the recorded outcome. Privacy deletion
and retention expiry use the same propagation boundary; a legal hold or failed
adapter leaves a recoverable ledger state instead of silently claiming completion.

## Stale detection and reconciliation

The reconciler compares B2-derived chunk lineage with current index rows. Missing
vectors, parser/chunker/embedding or index-version mismatches, and orphan rows are
reported with explicit reasons. Repair removes the affected source's derived rows
and rebuilds them from authorized chunks. The source asset is not removed.

## Reindex and rollback

Reindexing writes a new version beside the selected version. Evaluation quality
must meet the configured threshold before the retained selector promotes it. If
quality, latency, cost, or isolation degrades, the new version remains unselected,
the last-passing index remains selectable, and in-flight work is reconciled. Rollback
never deletes the B2 source or neutral contracts.

The local implementation uses deterministic fakes. PostgreSQL/PGVector, B2,
embeddings, caches, queues, cloud services, credentials, and providers are explicit
unavailable adapters unless separately activated; no live conformance is claimed.
