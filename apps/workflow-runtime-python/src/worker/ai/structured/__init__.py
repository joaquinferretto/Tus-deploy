"""Bounded JSON-schema structured-output execution."""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum
from typing import Any

from jsonschema import Draft202012Validator

from worker.ai.chat import ChatClient, ChatMessage, ChatRequest
from worker.ai.llm import LineageMetadata, UsageMetadata
from worker.langgraph.registry import RuntimeContext

MAX_STRUCTURED_ATTEMPTS = 3


class StructuredOutputStatus(str, Enum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class StructuredOutputRequest:
    prompt: str
    schema: dict[str, Any]
    context: RuntimeContext
    model: str = "llama-3.1-8b-instant"
    max_attempts: int = MAX_STRUCTURED_ATTEMPTS

    def __post_init__(self) -> None:
        if not self.prompt.strip():
            raise ValueError("Structured-output prompt is required")
        if self.max_attempts < 1:
            raise ValueError("Structured-output max_attempts must be positive")
        Draft202012Validator.check_schema(self.schema)


@dataclass(frozen=True, slots=True)
class StructuredOutputResult:
    status: StructuredOutputStatus
    output: Any
    raw_text: str
    attempts: int
    errors: tuple[str, ...]
    usage: UsageMetadata
    lineage: LineageMetadata


class StructuredOutputExecutor:
    def __init__(self, chat: ChatClient) -> None:
        self._chat = chat

    def complete(self, request: StructuredOutputRequest) -> StructuredOutputResult:
        attempts = min(request.max_attempts, MAX_STRUCTURED_ATTEMPTS)
        total_usage = UsageMetadata(0, 0, 0, 0.0)
        errors: list[str] = []
        raw_text = ""
        for attempt in range(1, attempts + 1):
            prompt = _attempt_prompt(request.prompt, attempt)
            response = self._chat.complete(
                ChatRequest(
                    messages=(ChatMessage("user", prompt),),
                    context=request.context,
                    model=request.model,
                )
            )
            total_usage = total_usage.combine(response.usage)
            raw_text = response.text
            try:
                output = json.loads(raw_text)
            except json.JSONDecodeError:
                errors.append("invalid JSON")
                continue
            validation_error = next(
                Draft202012Validator(request.schema).iter_errors(output),
                None,
            )
            if validation_error is not None:
                errors.append(validation_error.message)
                continue
            return StructuredOutputResult(
                status=StructuredOutputStatus.SUCCEEDED,
                output=output,
                raw_text=raw_text,
                attempts=attempt,
                errors=tuple(errors),
                usage=total_usage,
                lineage=LineageMetadata.from_context(request.context),
            )

        return StructuredOutputResult(
            status=StructuredOutputStatus.FAILED,
            output=None,
            raw_text=raw_text,
            attempts=attempts,
            errors=tuple(errors),
            usage=total_usage,
            lineage=LineageMetadata.from_context(request.context),
        )


def _attempt_prompt(prompt: str, attempt: int) -> str:
    if attempt == 1:
        return f"{prompt}\nReturn only JSON matching the supplied schema."
    return (
        f"{prompt}\nRepair attempt {attempt}: return only valid JSON matching the supplied schema."
    )


__all__ = [
    "MAX_STRUCTURED_ATTEMPTS",
    "StructuredOutputExecutor",
    "StructuredOutputRequest",
    "StructuredOutputResult",
    "StructuredOutputStatus",
]
