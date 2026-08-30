"""Explicit provider-free adapters used until durable integrations are enabled."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .types import RuntimeContext


class UnavailableCapabilityError(RuntimeError):
    """Raised instead of silently invoking an unavailable external capability."""


@dataclass(frozen=True, slots=True)
class UnavailableAdapter:
    capability: str
    reason: str

    def invoke(
        self,
        context: RuntimeContext,
        request: Mapping[str, object],
    ) -> Mapping[str, object]:
        del context, request
        raise UnavailableCapabilityError(
            f"{self.capability} capability unavailable: {self.reason}"
        )
