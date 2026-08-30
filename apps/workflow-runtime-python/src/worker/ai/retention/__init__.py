"""Encrypted, consent-governed AI retention and deletion propagation fakes."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from enum import StrEnum

from worker.ai.privacy import (
    ConsentPurpose,
    ConsentRecord,
    ConsentRequiredError,
    EncryptionMetadata,
    InMemoryConsentStore,
    LineageMetadata,
    PrivacyAudit,
    redact_text,
)
from worker.langgraph.registry import RuntimeContext


class RetentionStatus(StrEnum):
    RETAINED = "retained"
    DELETED = "deleted"


@dataclass(frozen=True, slots=True)
class DataRetentionPolicy:
    default_retention_seconds: int = 86_400

    def __post_init__(self) -> None:
        if self.default_retention_seconds < 0:
            raise ValueError("default_retention_seconds must be non-negative")


@dataclass(frozen=True, slots=True)
class DeletionPropagation:
    record_id: str
    status: str
    completed_destinations: tuple[str, ...]
    failed_destinations: tuple[str, ...]
    evidence_id: str


@dataclass(frozen=True, slots=True)
class AIDataRecord:
    record_id: str
    tenant_id: str
    actor_id: str
    data_type: str
    purpose: ConsentPurpose
    redacted_content: str
    created_at: int
    expires_at: int
    retention_status: RetentionStatus
    legal_hold: bool
    encryption: EncryptionMetadata
    lineage: LineageMetadata


class InMemoryAIPrivacyStore:
    """A deterministic local store that never keeps raw AI payloads."""

    _DESTINATIONS = ("memory", "search", "trace", "provider-cache")

    def __init__(
        self,
        *,
        retention: DataRetentionPolicy | None = None,
        encryption_key_ref: str,
    ) -> None:
        if not encryption_key_ref.strip():
            raise ValueError("encryption_key_ref is required")
        self._retention = retention or DataRetentionPolicy()
        self._key_ref = encryption_key_ref
        self._consents = InMemoryConsentStore()
        self._records: dict[str, AIDataRecord] = {}
        self._audits: list[PrivacyAudit] = []
        self._sequence = 0

    def grant_consent(
        self, context: RuntimeContext, purpose: ConsentPurpose, *, now: int
    ) -> ConsentRecord:
        record = self._consents.grant(context, purpose, now)
        self._audit(context, "consent.granted", "granted", purpose.value, "consent")
        return record

    def consent(self, context: RuntimeContext, purpose: ConsentPurpose) -> ConsentRecord:
        return self._consents.get(context, purpose)

    def record(
        self,
        context: RuntimeContext,
        data_type: str,
        content: str,
        purpose: ConsentPurpose,
        *,
        now: int = 0,
        legal_hold: bool = False,
        parent_ids: tuple[str, ...] = (),
    ) -> AIDataRecord:
        purpose = ConsentPurpose(purpose)
        if (
            purpose
            in {
                ConsentPurpose.AI_IMPROVEMENT,
                ConsentPurpose.MEMORY,
                ConsentPurpose.TRACE,
            }
            and not self.consent(context, purpose).granted
        ):
            self._audit(context, "record.denied", "denied", purpose.value, "consent-required")
            raise ConsentRequiredError(f"consent is required for {purpose.value}")
        if not data_type.strip() or not content.strip():
            raise ValueError("data_type and content are required")
        self._sequence += 1
        record_id = f"ai-data-{self._sequence}"
        redacted = redact_text(content)
        digest = hashlib.sha256(f"{self._key_ref}:{redacted}".encode()).hexdigest()
        lineage_payload = context.lineage
        record = AIDataRecord(
            record_id=record_id,
            tenant_id=context.tenant_id,
            actor_id=context.actor_id,
            data_type=data_type,
            purpose=purpose,
            redacted_content=redacted,
            created_at=now,
            expires_at=now + self._retention.default_retention_seconds,
            retention_status=RetentionStatus.RETAINED,
            legal_hold=legal_hold,
            encryption=EncryptionMetadata(
                True, "deterministic-local-envelope.v1", self._key_ref, digest
            ),
            lineage=LineageMetadata(
                root_message_id=lineage_payload.get("rootMessageId", context.idempotency_key),
                source=lineage_payload.get("source", "ai"),
                parent_ids=parent_ids,
            ),
        )
        self._records[record_id] = record
        self._audit(context, "record.retained", "retained", purpose.value, record_id)
        return record

    def get(self, context: RuntimeContext, record_id: str) -> AIDataRecord:
        record = self._records.get(record_id)
        if record is None or record.tenant_id != context.tenant_id:
            raise KeyError("No tenant-scoped AI data record")
        return record

    def list_records(self, context: RuntimeContext) -> tuple[AIDataRecord, ...]:
        return tuple(
            record
            for record in self._records.values()
            if record.tenant_id == context.tenant_id
            and record.retention_status is RetentionStatus.RETAINED
        )

    def withdraw_consent(
        self, context: RuntimeContext, purpose: ConsentPurpose, *, now: int
    ) -> DeletionPropagation:
        purpose = ConsentPurpose(purpose)
        self._consents.withdraw(context, purpose, now)
        matching = [
            record
            for record in self._records.values()
            if record.tenant_id == context.tenant_id
            and record.purpose is purpose
            and record.retention_status is RetentionStatus.RETAINED
            and not record.legal_hold
        ]
        last: DeletionPropagation | None = None
        for record in matching:
            last = self._delete(context, record, "consent-withdrawal")
        if last is None:
            last = self._propagation(context, f"consent:{purpose.value}", "consent-withdrawal")
        self._audit(context, "consent.withdrawn", "deleted", purpose.value, last.evidence_id)
        return last

    def opt_out(
        self, context: RuntimeContext, purpose: ConsentPurpose, *, now: int
    ) -> DeletionPropagation:
        return self.withdraw_consent(context, purpose, now=now)

    def purge(self, context: RuntimeContext, *, now: int) -> tuple[str, ...]:
        expired = [
            record
            for record in self._records.values()
            if record.tenant_id == context.tenant_id
            and record.retention_status is RetentionStatus.RETAINED
            and record.expires_at <= now
            and not record.legal_hold
        ]
        for record in expired:
            self._delete(context, record, "retention-expired")
        return tuple(record.record_id for record in expired)

    def audit_log(self, context: RuntimeContext) -> tuple[PrivacyAudit, ...]:
        return tuple(audit for audit in self._audits if audit.tenant_id == context.tenant_id)

    def _delete(
        self, context: RuntimeContext, record: AIDataRecord, reason: str
    ) -> DeletionPropagation:
        self._records[record.record_id] = replace(record, retention_status=RetentionStatus.DELETED)
        propagation = self._propagation(context, record.record_id, reason)
        self._audit(context, "record.deleted", "deleted", reason, record.record_id)
        return propagation

    def _propagation(
        self, context: RuntimeContext, record_id: str, reason: str
    ) -> DeletionPropagation:
        evidence_id = hashlib.sha256(
            f"{context.tenant_id}:{record_id}:{reason}".encode()
        ).hexdigest()[:16]
        return DeletionPropagation(record_id, "completed", self._DESTINATIONS, (), evidence_id)

    def _audit(
        self,
        context: RuntimeContext,
        action: str,
        outcome: str,
        purpose: str,
        resource_id: str,
    ) -> None:
        audit_id = hashlib.sha256(
            f"{context.tenant_id}:{context.idempotency_key}:{action}:{resource_id}".encode()
        ).hexdigest()[:16]
        self._audits.append(
            PrivacyAudit(
                audit_id,
                context.tenant_id,
                context.actor_id,
                context.correlation_id,
                action,
                outcome,
                purpose,
                resource_id,
            )
        )


__all__ = [
    "AIDataRecord",
    "DataRetentionPolicy",
    "DeletionPropagation",
    "InMemoryAIPrivacyStore",
    "RetentionStatus",
]
