"""Immutable source-to-chunk tenant lineage."""

from __future__ import annotations

import re
from dataclasses import dataclass

CHECKSUM_PATTERN = re.compile(r"^[a-f0-9]{64}$")


@dataclass(frozen=True, slots=True)
class TenantLineage:
    tenant_id: str
    workspace_id: str
    actor_id: str
    source_asset_id: str
    source_uri: str
    checksum: str
    root_message_id: str
    correlation_id: str
    parser_version: str
    chunker_version: str

    def __post_init__(self) -> None:
        for field_name in (
            "tenant_id",
            "workspace_id",
            "actor_id",
            "source_asset_id",
            "source_uri",
            "root_message_id",
            "correlation_id",
            "parser_version",
            "chunker_version",
        ):
            if not getattr(self, field_name).strip():
                raise ValueError(f"lineage {field_name} is required")
        if not self.source_uri.startswith("b2://"):
            raise ValueError("lineage source_uri must use the B2 boundary")
        if not CHECKSUM_PATTERN.fullmatch(self.checksum):
            raise ValueError("lineage checksum must be a lowercase SHA-256 digest")

    def as_dict(self) -> dict[str, str]:
        return {
            "tenantId": self.tenant_id,
            "workspaceId": self.workspace_id,
            "actorId": self.actor_id,
            "sourceAssetId": self.source_asset_id,
            "sourceUri": self.source_uri,
            "checksum": self.checksum,
            "rootMessageId": self.root_message_id,
            "correlationId": self.correlation_id,
            "parserVersion": self.parser_version,
            "chunkerVersion": self.chunker_version,
        }
