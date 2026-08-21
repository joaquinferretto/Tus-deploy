"""Vendor-neutral telemetry ports for the Python runtime."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

SENSITIVE_KEYS = {"authorization", "password", "secret", "token", "api_key", "credential"}


@dataclass(frozen=True, slots=True)
class TelemetryContext:
    correlation_id: str
    trace_id: str | None = None
    tenant_id: str | None = None
    actor_id: str | None = None


class TelemetryPort(Protocol):
    def log(self, name: str, context: TelemetryContext, attributes: dict[str, Any] | None = None) -> None: ...

    def increment(self, name: str, value: int = 1) -> None: ...


def redact_attributes(attributes: dict[str, Any] | None) -> dict[str, Any]:
    return {
        key: "[REDACTED]" if key.lower() in SENSITIVE_KEYS else value
        for key, value in (attributes or {}).items()
    }


@dataclass(slots=True)
class InMemoryTelemetry:
    logs: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, int] = field(default_factory=dict)

    def log(self, name: str, context: TelemetryContext, attributes: dict[str, Any] | None = None) -> None:
        self.logs.append(
            {
                "channel": "factory.telemetry.v1",
                "name": name,
                "correlationId": context.correlation_id,
                "traceId": context.trace_id,
                "tenantId": context.tenant_id,
                "actorId": context.actor_id,
                "attributes": redact_attributes(attributes),
            }
        )

    def increment(self, name: str, value: int = 1) -> None:
        self.metrics[name] = self.metrics.get(name, 0) + value
