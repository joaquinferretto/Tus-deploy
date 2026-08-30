"""Tenant-scoped content checksums and deterministic duplicate reservations."""

from __future__ import annotations

import hashlib
import re

CHECKSUM_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def checksum_bytes(content: bytes) -> str:
    if not isinstance(content, bytes):
        raise TypeError("checksum content must be bytes")
    return hashlib.sha256(content).hexdigest()


class DeduplicationIndex:
    def __init__(self) -> None:
        self._checksums: set[tuple[str, str]] = set()

    def reserve(self, tenant_id: str, checksum: str) -> bool:
        if not tenant_id.strip():
            raise ValueError("tenant_id is required")
        if not CHECKSUM_PATTERN.fullmatch(checksum):
            raise ValueError("checksum must be a lowercase SHA-256 digest")
        key = (tenant_id, checksum)
        if key in self._checksums:
            return False
        self._checksums.add(key)
        return True

    def release(self, tenant_id: str, checksum: str) -> None:
        self._checksums.discard((tenant_id, checksum))

    def contains(self, tenant_id: str, checksum: str) -> bool:
        return (tenant_id, checksum) in self._checksums
