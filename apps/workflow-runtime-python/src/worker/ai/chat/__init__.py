"""Typed chat messages over the worker's LLM port."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from worker.ai.llm import LineageMetadata, LLMClient, LLMRequest, LLMResponse, UsageMetadata
from worker.langgraph.registry import RuntimeContext

CHAT_ROLES = frozenset({"system", "user", "assistant", "tool"})


@dataclass(frozen=True, slots=True)
class ChatMessage:
    role: str
    content: str

    def __post_init__(self) -> None:
        if self.role not in CHAT_ROLES:
            raise ValueError(f"Unsupported chat role: {self.role}")
        if not self.content.strip():
            raise ValueError("Chat message content is required")


@dataclass(frozen=True, slots=True)
class ChatRequest:
    messages: tuple[ChatMessage, ...]
    context: RuntimeContext
    model: str = "llama-3.1-8b-instant"
    max_tokens: int = 256

    def __post_init__(self) -> None:
        if not self.messages:
            raise ValueError("At least one chat message is required")
        if self.max_tokens < 1:
            raise ValueError("Chat max_tokens must be positive")


@dataclass(frozen=True, slots=True)
class ChatResponse:
    text: str
    provider: str
    model: str
    usage: UsageMetadata
    lineage: LineageMetadata


class ChatClient(Protocol):
    def complete(self, request: ChatRequest) -> ChatResponse: ...


class DeterministicChat:
    """Chat adapter that delegates to a provider port without owning orchestration."""

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    def complete(self, request: ChatRequest) -> ChatResponse:
        prompt = "\n".join(f"{message.role}: {message.content}" for message in request.messages)
        response: LLMResponse = self._llm.complete(
            LLMRequest(
                prompt=prompt,
                context=request.context,
                model=request.model,
                max_tokens=request.max_tokens,
            )
        )
        return ChatResponse(
            text=response.text,
            provider=response.provider,
            model=response.model,
            usage=response.usage,
            lineage=response.lineage,
        )


def chat_request(
    messages: Sequence[ChatMessage],
    context: RuntimeContext,
    *,
    model: str = "llama-3.1-8b-instant",
    max_tokens: int = 256,
) -> ChatRequest:
    return ChatRequest(tuple(messages), context, model, max_tokens)


__all__ = [
    "CHAT_ROLES",
    "ChatClient",
    "ChatMessage",
    "ChatRequest",
    "ChatResponse",
    "DeterministicChat",
    "chat_request",
]
