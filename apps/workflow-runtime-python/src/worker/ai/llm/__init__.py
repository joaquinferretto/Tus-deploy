"""Typed LLM ports with deterministic fake and activation-gated Groq adapters."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from worker.langgraph.registry import RuntimeContext


class ProviderUnavailableError(RuntimeError):
    """Raised when a provider is not activated or has no injected transport."""


@dataclass(frozen=True, slots=True)
class LineageMetadata:
    tenant_id: str
    actor_id: str
    correlation_id: str
    idempotency_key: str
    lineage: dict[str, str]

    @classmethod
    def from_context(cls, context: RuntimeContext) -> LineageMetadata:
        return cls(
            tenant_id=context.tenant_id,
            actor_id=context.actor_id,
            correlation_id=context.correlation_id,
            idempotency_key=context.idempotency_key,
            lineage=dict(context.lineage),
        )


@dataclass(frozen=True, slots=True)
class UsageMetadata:
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    estimated_cost_usd: float
    currency: str = "USD"

    def __post_init__(self) -> None:
        if self.prompt_tokens < 0 or self.completion_tokens < 0:
            raise ValueError("Token counts cannot be negative")
        if self.total_tokens != self.prompt_tokens + self.completion_tokens:
            raise ValueError("total_tokens must equal prompt plus completion tokens")
        if self.estimated_cost_usd < 0:
            raise ValueError("Estimated cost cannot be negative")

    @classmethod
    def from_text(
        cls,
        prompt: str,
        completion: str,
        *,
        cost_per_1k_tokens: float,
    ) -> UsageMetadata:
        prompt_tokens = _token_count(prompt)
        completion_tokens = _token_count(completion)
        total_tokens = prompt_tokens + completion_tokens
        cost = total_tokens / 1000 * cost_per_1k_tokens
        return cls(prompt_tokens, completion_tokens, total_tokens, round(cost, 8))

    def combine(self, other: UsageMetadata) -> UsageMetadata:
        if self.currency != other.currency:
            raise ValueError("Usage currencies must match")
        return UsageMetadata(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
            estimated_cost_usd=round(
                self.estimated_cost_usd + other.estimated_cost_usd,
                8,
            ),
            currency=self.currency,
        )


@dataclass(frozen=True, slots=True)
class LLMRequest:
    prompt: str
    context: RuntimeContext
    model: str = "llama-3.1-8b-instant"
    max_tokens: int = 256

    def __post_init__(self) -> None:
        if not self.prompt.strip():
            raise ValueError("LLM prompt is required")
        if not self.model.strip():
            raise ValueError("LLM model is required")
        if self.max_tokens < 1:
            raise ValueError("LLM max_tokens must be positive")


@dataclass(frozen=True, slots=True)
class LLMResponse:
    text: str
    provider: str
    model: str
    usage: UsageMetadata
    lineage: LineageMetadata


class LLMClient(Protocol):
    def complete(self, request: LLMRequest) -> LLMResponse: ...


Transport = Callable[[LLMRequest], str]


class DeterministicLLM:
    """A local fake with stable text, token accounting, and no I/O."""

    provider = "fake"

    def complete(self, request: LLMRequest) -> LLMResponse:
        text = f"fake response: {request.prompt.strip()}"
        return LLMResponse(
            text=text,
            provider=self.provider,
            model=request.model,
            usage=UsageMetadata.from_text(request.prompt, text, cost_per_1k_tokens=0.0),
            lineage=LineageMetadata.from_context(request.context),
        )


class GroqLLM:
    """Groq adapter; network access is possible only through an injected transport."""

    provider = "groq"

    def __init__(self, transport: Transport | None = None, *, active: bool = False) -> None:
        self._transport = transport
        self._active = active

    @property
    def active(self) -> bool:
        return self._active

    def complete(self, request: LLMRequest) -> LLMResponse:
        if not self._active:
            raise ProviderUnavailableError(
                "Groq provider is gated until activation evidence exists"
            )
        if self._transport is None:
            raise ProviderUnavailableError("Groq provider is active but transport is unavailable")

        text = self._transport(request)
        if not isinstance(text, str) or not text.strip():
            raise ProviderUnavailableError("Groq transport returned no text")
        return LLMResponse(
            text=text,
            provider=self.provider,
            model=request.model,
            usage=UsageMetadata.from_text(
                request.prompt,
                text,
                cost_per_1k_tokens=0.05,
            ),
            lineage=LineageMetadata.from_context(request.context),
        )


def _token_count(value: str) -> int:
    return len(value.split())


__all__ = [
    "DeterministicLLM",
    "GroqLLM",
    "LLMClient",
    "LLMRequest",
    "LLMResponse",
    "LineageMetadata",
    "ProviderUnavailableError",
    "UsageMetadata",
]
