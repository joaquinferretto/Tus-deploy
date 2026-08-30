"""Tenant-authorized, transactional, provider-free RAG ingestion."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from worker.rag.chunking import Chunk, ChunkingConfig, SafeChunker
from worker.rag.dedup import DeduplicationIndex, checksum_bytes
from worker.rag.lineage import TenantLineage
from worker.rag.parsing import (
    DocumentTooLargeError,
    SafeParser,
    UnsupportedMimeTypeError,
)

INGEST_CONTRACT_VERSION: Final = "1.0.0"
DEFAULT_INGESTED_AT: Final = "2026-01-01T00:00:00.000Z"


class SourceAuthorizationError(PermissionError):
    """Raised without disclosing whether another tenant's source exists."""


@dataclass(frozen=True, slots=True)
class B2Object:
    source_id: str
    tenant_id: str
    workspace_id: str
    object_key: str
    mime_type: str
    content: bytes
    allowed_actor_ids: frozenset[str] = frozenset()
    checksum: str | None = None

    def __post_init__(self) -> None:
        for field_name in ("source_id", "tenant_id", "workspace_id", "object_key", "mime_type"):
            if not getattr(self, field_name).strip():
                raise ValueError(f"B2 object {field_name} is required")
        key_parts = self.object_key.split("/")
        if (
            not self.object_key.startswith(f"{self.tenant_id}/")
            or "\\" in self.object_key
            or any(part in {"", ".", ".."} for part in key_parts)
        ):
            raise ValueError("B2 object key must remain under the tenant prefix")
        computed = checksum_bytes(self.content)
        if self.checksum is not None and self.checksum != computed:
            raise ValueError("B2 object checksum does not match content")
        object.__setattr__(self, "checksum", computed)

    @property
    def uri(self) -> str:
        return f"b2://{self.object_key}"


class InMemoryB2Source:
    def __init__(self) -> None:
        self._objects: dict[str, B2Object] = {}
        self._available = True

    @classmethod
    def unavailable(cls) -> InMemoryB2Source:
        source = cls()
        source._available = False
        return source

    def put(self, source: B2Object) -> None:
        self._objects[source.source_id] = source

    def fetch(
        self, *, source_id: str, tenant_id: str, workspace_id: str, actor_id: str
    ) -> B2Object:
        if not self._available:
            raise RuntimeError("B2 source provider is unavailable; use a deterministic fake")
        source = self._objects.get(source_id)
        if (
            source is None
            or source.tenant_id != tenant_id
            or source.workspace_id != workspace_id
            or (source.allowed_actor_ids and actor_id not in source.allowed_actor_ids)
        ):
            raise SourceAuthorizationError("B2 source is not authorized")
        return source

    def delete(
        self,
        *,
        source_id: str,
        tenant_id: str,
        actor_id: str,
        workspace_id: str | None = None,
    ) -> None:
        source = self._objects.get(source_id)
        if (
            source is None
            or source.tenant_id != tenant_id
            or (workspace_id is not None and source.workspace_id != workspace_id)
            or (source.allowed_actor_ids and actor_id not in source.allowed_actor_ids)
        ):
            raise SourceAuthorizationError("B2 source is not authorized")
        del self._objects[source_id]


@dataclass(frozen=True, slots=True)
class IngestRequest:
    tenant_id: str
    workspace_id: str
    actor_id: str
    correlation_id: str
    root_message_id: str
    source_id: str
    idempotency_key: str
    retention_until: int | None
    mime_type: str | None = None

    def __post_init__(self) -> None:
        for field_name in (
            "tenant_id",
            "workspace_id",
            "actor_id",
            "correlation_id",
            "root_message_id",
            "source_id",
            "idempotency_key",
        ):
            if not getattr(self, field_name).strip():
                raise ValueError(f"ingest request {field_name} is required")
        if self.retention_until is not None and self.retention_until < 0:
            raise ValueError("retention_until must be non-negative or null")


@dataclass(frozen=True, slots=True)
class ChunkRecord:
    chunk_id: str
    source_id: str
    tenant_id: str
    workspace_id: str
    chunk_index: int
    text: str
    checksum: str
    start_offset: int
    end_offset: int
    lineage: TenantLineage
    retention_until: int | None


@dataclass(frozen=True, slots=True)
class IngestResult:
    status: str
    ingest_id: str
    source_id: str
    tenant_id: str
    idempotency_key: str
    chunk_count: int
    checksum: str | None = None
    reason: str | None = None
    retryable: bool = False
    resume_token: str | None = None

    def as_payload(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "contractVersion": INGEST_CONTRACT_VERSION,
            "ingestId": self.ingest_id,
            "sourceId": self.source_id,
            "tenantId": self.tenant_id,
            "idempotencyKey": self.idempotency_key,
            "status": self.status,
            "chunkCount": self.chunk_count,
            "checksum": self.checksum,
            "retryable": self.retryable,
        }
        if self.reason is not None:
            payload["reason"] = self.reason
        if self.resume_token is not None:
            payload["resumeToken"] = self.resume_token
        return payload


@dataclass(slots=True)
class IngestLedgerRecord:
    request: IngestRequest
    status: str
    checksum: str | None = None
    chunk_count: int = 0
    reason: str | None = None
    attempts: int = 0


class InMemoryIngestLedger:
    def __init__(self) -> None:
        self._records: dict[tuple[str, str], IngestLedgerRecord] = {}

    def get(self, tenant_id: str, idempotency_key: str) -> IngestLedgerRecord:
        return self._records[(tenant_id, idempotency_key)]

    def begin(self, request: IngestRequest) -> IngestLedgerRecord:
        key = (request.tenant_id, request.idempotency_key)
        existing = self._records.get(key)
        if existing is not None:
            if existing.request.source_id != request.source_id:
                raise ValueError("idempotency key is bound to another source")
            if existing.status in {"completed", "duplicate", "quarantined"}:
                return existing
            existing.attempts += 1
            return existing
        record = IngestLedgerRecord(request=request, status="started", attempts=1)
        self._records[key] = record
        return record


class InMemoryChunkIndex:
    def __init__(self) -> None:
        self._chunks: dict[tuple[str, str, int], ChunkRecord] = {}
        self.fail_next_commit = False

    def commit(self, chunks: list[ChunkRecord]) -> None:
        if self.fail_next_commit:
            self.fail_next_commit = False
            raise RuntimeError("deterministic chunk index commit failure")
        if not chunks:
            raise ValueError("cannot commit an empty chunk batch")
        tenant_ids = {chunk.tenant_id for chunk in chunks}
        if len(tenant_ids) != 1:
            raise ValueError("chunk batch must contain one tenant")
        pending = {(chunk.tenant_id, chunk.source_id, chunk.chunk_index): chunk for chunk in chunks}
        if len(pending) != len(chunks):
            raise ValueError("duplicate chunk index in batch")
        self._chunks.update(pending)

    def list_for_tenant(self, tenant_id: str) -> list[ChunkRecord]:
        return [chunk for key, chunk in self._chunks.items() if key[0] == tenant_id]

    def list_for_source(self, tenant_id: str, source_id: str) -> list[ChunkRecord]:
        return [
            chunk
            for (stored_tenant, stored_source, _), chunk in self._chunks.items()
            if stored_tenant == tenant_id and stored_source == source_id
        ]

    def delete_source(self, tenant_id: str, source_id: str) -> int:
        keys = [key for key in self._chunks if key[0] == tenant_id and key[1] == source_id]
        for key in keys:
            del self._chunks[key]
        return len(keys)

    def tenants_for_source(self, source_id: str) -> set[str]:
        return {key[0] for key in self._chunks if key[1] == source_id}


@dataclass(frozen=True, slots=True)
class QuarantineRecord:
    source_id: str
    tenant_id: str
    checksum: str | None
    reason: str
    retention_until: int | None


class InMemoryQuarantineStore:
    def __init__(self) -> None:
        self.records: list[QuarantineRecord] = []

    def add(self, record: QuarantineRecord) -> None:
        self.records.append(record)


class RagIngestor:
    def __init__(
        self,
        source: InMemoryB2Source,
        index: InMemoryChunkIndex,
        ledger: InMemoryIngestLedger,
        quarantine: InMemoryQuarantineStore,
        *,
        parser: SafeParser | None = None,
        chunker: SafeChunker | None = None,
        deduplication: DeduplicationIndex | None = None,
    ) -> None:
        self.source = source
        self.index = index
        self.ledger = ledger
        self.quarantine = quarantine
        self.parser = parser or SafeParser()
        self.chunker = chunker or SafeChunker(ChunkingConfig())
        self.deduplication = deduplication or DeduplicationIndex()

    def ingest(self, request: IngestRequest) -> IngestResult:
        ledger_record = self.ledger.begin(request)
        if ledger_record.status in {"completed", "duplicate", "quarantined"}:
            return self._result_from_record(ledger_record)
        source = self.source.fetch(
            source_id=request.source_id,
            tenant_id=request.tenant_id,
            workspace_id=request.workspace_id,
            actor_id=request.actor_id,
        )
        if (
            request.mime_type is not None
            and request.mime_type.split(";", 1)[0].lower() != source.mime_type
        ):
            return self._quarantine(request, source.checksum, "mime_mismatch")
        content_checksum = checksum_bytes(source.content)
        if content_checksum != source.checksum:
            return self._quarantine(request, content_checksum, "checksum_mismatch")
        try:
            parsed = self.parser.parse(source.content, source.mime_type, source.source_id)
        except (DocumentTooLargeError, UnsupportedMimeTypeError, ValueError) as error:
            reason = self._reason_for(error)
            return self._quarantine(request, content_checksum, reason)

        chunks = self.chunker.chunk(parsed)
        if not chunks:
            return self._quarantine(request, content_checksum, "empty_document")
        if not self.deduplication.reserve(request.tenant_id, content_checksum):
            ledger_record.status = "duplicate"
            ledger_record.checksum = content_checksum
            ledger_record.chunk_count = len(chunks)
            return self._result_from_record(ledger_record)

        lineage = TenantLineage(
            tenant_id=request.tenant_id,
            workspace_id=request.workspace_id,
            actor_id=request.actor_id,
            source_asset_id=source.source_id,
            source_uri=source.uri,
            checksum=content_checksum,
            root_message_id=request.root_message_id,
            correlation_id=request.correlation_id,
            parser_version=parsed.parser_version,
            chunker_version=chunks[0].chunker_version,
        )
        records = [self._record_for(request, source.source_id, chunk, lineage) for chunk in chunks]
        try:
            self.index.commit(records)
        except Exception as error:  # noqa: BLE001 - recovery boundary records every adapter failure.
            self.deduplication.release(request.tenant_id, content_checksum)
            ledger_record.status = "partial"
            ledger_record.checksum = content_checksum
            ledger_record.chunk_count = 0
            ledger_record.reason = str(error)
            return self._result_from_record(ledger_record, retryable=True)
        ledger_record.status = "completed"
        ledger_record.checksum = content_checksum
        ledger_record.chunk_count = len(records)
        ledger_record.reason = None
        return self._result_from_record(ledger_record)

    def _record_for(
        self,
        request: IngestRequest,
        source_id: str,
        chunk: Chunk,
        lineage: TenantLineage,
    ) -> ChunkRecord:
        return ChunkRecord(
            chunk_id=f"{source_id}:{chunk.chunk_index}",
            source_id=source_id,
            tenant_id=request.tenant_id,
            workspace_id=request.workspace_id,
            chunk_index=chunk.chunk_index,
            text=chunk.text,
            checksum=chunk.checksum,
            start_offset=chunk.start_offset,
            end_offset=chunk.end_offset,
            lineage=lineage,
            retention_until=request.retention_until,
        )

    def _quarantine(
        self, request: IngestRequest, checksum: str | None, reason: str
    ) -> IngestResult:
        record = self.ledger.begin(request)
        record.status = "quarantined"
        record.checksum = checksum
        record.reason = reason
        self.quarantine.add(
            QuarantineRecord(
                request.source_id, request.tenant_id, checksum, reason, request.retention_until
            )
        )
        return self._result_from_record(record)

    @staticmethod
    def _reason_for(error: Exception) -> str:
        if isinstance(error, DocumentTooLargeError):
            return "oversized"
        if isinstance(error, UnsupportedMimeTypeError):
            return "unsupported_mime_type"
        if "NUL" in str(error):
            return "unsafe_content"
        if "UTF-8" in str(error):
            return "invalid_encoding"
        if "JSON" in str(error):
            return "invalid_document"
        return "unsafe_content"

    @staticmethod
    def _result_from_record(record: IngestLedgerRecord, *, retryable: bool = False) -> IngestResult:
        return IngestResult(
            status=record.status,
            ingest_id=f"{record.request.tenant_id}:{record.request.idempotency_key}",
            source_id=record.request.source_id,
            tenant_id=record.request.tenant_id,
            idempotency_key=record.request.idempotency_key,
            chunk_count=record.chunk_count,
            checksum=record.checksum,
            reason=record.reason,
            retryable=retryable,
            resume_token=record.request.idempotency_key if retryable else None,
        )
