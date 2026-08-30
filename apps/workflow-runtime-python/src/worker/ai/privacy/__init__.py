"""Consent, redaction, and tenant-scoped AI privacy records."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from worker.langgraph.registry import RuntimeContext


class ConsentPurpose(StrEnum):
    AI_IMPROVEMENT = "ai_improvement"
    MEMORY = "memory"
    TRACE = "trace"
    SERVICE_DELIVERY = "service_delivery"


class ConsentRequiredError(PermissionError):
    """Raised when retained AI data lacks purpose-specific consent."""


@dataclass(frozen=True, slots=True)
class ConsentRecord:
    tenant_id: str
    purpose: ConsentPurpose
    granted: bool
    version: str
    recorded_at: int


def redact_text(value: str) -> str:
    patterns = (
        (re.compile(r"(authorization\s*:\s*bearer\s+)[^\s,;]+", re.IGNORECASE), r"\1[REDACTED]"),
        (
            re.compile(
                r"((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+",
                re.IGNORECASE,
            ),
            r"\1[REDACTED]",
        ),
        (re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE), "[REDACTED]"),
    )
    redacted = value
    for pattern, replacement in patterns:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def redact_value(value: object) -> object:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]"
            if any(
                word in str(key).casefold()
                for word in ("secret", "token", "password", "authorization")
            )
            else redact_value(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_value(item) for item in value)
    return value


@dataclass(frozen=True, slots=True)
class EncryptionMetadata:
    encrypted: bool
    algorithm: str
    key_ref: str
    ciphertext_digest: str


@dataclass(frozen=True, slots=True)
class LineageMetadata:
    root_message_id: str
    source: str
    parent_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PrivacyAudit:
    audit_id: str
    tenant_id: str
    actor_id: str
    correlation_id: str
    action: str
    outcome: str
    purpose: str
    resource_id: str
    details: tuple[str, ...] = ()


class InMemoryConsentStore:
    def __init__(self) -> None:
        self._consents: dict[tuple[str, ConsentPurpose], ConsentRecord] = {}

    def grant(self, context: RuntimeContext, purpose: ConsentPurpose, now: int) -> ConsentRecord:
        record = ConsentRecord(context.tenant_id, ConsentPurpose(purpose), True, "1", now)
        self._consents[(context.tenant_id, record.purpose)] = record
        return record

    def withdraw(self, context: RuntimeContext, purpose: ConsentPurpose, now: int) -> ConsentRecord:
        record = ConsentRecord(context.tenant_id, ConsentPurpose(purpose), False, "1", now)
        self._consents[(context.tenant_id, record.purpose)] = record
        return record

    def get(self, context: RuntimeContext, purpose: ConsentPurpose) -> ConsentRecord:
        return self._consents.get(
            (context.tenant_id, ConsentPurpose(purpose)),
            ConsentRecord(context.tenant_id, ConsentPurpose(purpose), False, "1", 0),
        )


__all__ = [
    "ConsentPurpose",
    "ConsentRecord",
    "ConsentRequiredError",
    "EncryptionMetadata",
    "InMemoryConsentStore",
    "LineageMetadata",
    "PrivacyAudit",
    "redact_text",
    "redact_value",
]
