"""Tenant-scoped usage ledger for AI requests."""

from __future__ import annotations

from dataclasses import dataclass

from worker.ai.llm import LLMResponse


@dataclass(frozen=True, slots=True)
class UsageEvent:
    tenant_id: str
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float


class UsageTotal:
    def __init__(self) -> None:
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.total_tokens = 0
        self.cost_usd = 0.0


class InMemoryUsageLedger:
    """Deterministic append-and-aggregate usage ledger keyed by tenant."""

    def __init__(self) -> None:
        self._events: list[UsageEvent] = []

    def record(self, tenant_id: str, response: LLMResponse, cost_usd: float) -> UsageEvent:
        event = UsageEvent(
            tenant_id=tenant_id,
            provider=response.provider,
            model=response.model,
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
            total_tokens=response.usage.total_tokens,
            cost_usd=round(cost_usd, 8),
        )
        self._events.append(event)
        return event

    def total_for(self, tenant_id: str) -> UsageTotal:
        total = UsageTotal()
        for event in self._events:
            if event.tenant_id == tenant_id:
                total.prompt_tokens += event.prompt_tokens
                total.completion_tokens += event.completion_tokens
                total.total_tokens += event.total_tokens
                total.cost_usd = round(total.cost_usd + event.cost_usd, 8)
        return total

    def events_for(self, tenant_id: str) -> tuple[UsageEvent, ...]:
        return tuple(event for event in self._events if event.tenant_id == tenant_id)


__all__ = ["InMemoryUsageLedger", "UsageEvent", "UsageTotal"]
