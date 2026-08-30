"""Typed, tenant/actor-scoped tool registration and deny-by-default execution."""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any

from jsonschema import Draft202012Validator

from worker.ai.llm import LineageMetadata
from worker.langgraph.registry import RuntimeContext

ToolHandler = Callable[[Mapping[str, Any], RuntimeContext], Mapping[str, Any]]


class ToolStatus(str, Enum):
    SUCCEEDED = "succeeded"
    DENIED = "denied"
    INVALID = "invalid"


@dataclass(frozen=True, slots=True)
class PermissionedTool:
    name: str
    input_schema: dict[str, Any]
    permission: str
    handler: ToolHandler

    def __post_init__(self) -> None:
        if not self.name.strip() or not self.permission.strip():
            raise ValueError("Tool name and permission are required")
        Draft202012Validator.check_schema(self.input_schema)


@dataclass(frozen=True, slots=True)
class ToolRequest:
    name: str
    arguments: Mapping[str, Any]
    context: RuntimeContext


@dataclass(frozen=True, slots=True)
class ToolAuditMetadata:
    audit_id: str
    event: str
    decision: str
    reason: str
    tenant_id: str
    actor_id: str
    correlation_id: str
    idempotency_key: str
    lineage: dict[str, str]


@dataclass(frozen=True, slots=True)
class ToolResult:
    status: ToolStatus
    output: Mapping[str, Any] | None
    audit: ToolAuditMetadata


class PermissionedToolExecutor:
    def __init__(self) -> None:
        self._tools: dict[str, PermissionedTool] = {}
        self._grants: set[tuple[str, str, str]] = set()
        self._audit: list[ToolAuditMetadata] = []

    def register(self, tool: PermissionedTool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"Tool is already registered: {tool.name}")
        self._tools[tool.name] = tool

    def grant(self, tool_name: str, context: RuntimeContext) -> None:
        tool = self._tools.get(tool_name)
        if tool is None:
            raise KeyError(f"Unknown tool: {tool_name}")
        self._grants.add((context.tenant_id, context.actor_id, tool.permission))

    def invoke(self, request: ToolRequest) -> ToolResult:
        tool = self._tools.get(request.name)
        if tool is None:
            return self._result(request, ToolStatus.DENIED, "unknown tool", "denied")
        if (
            request.context.tenant_id,
            request.context.actor_id,
            tool.permission,
        ) not in self._grants:
            return self._result(request, ToolStatus.DENIED, "deny by default", "denied")

        validation_error = next(
            Draft202012Validator(tool.input_schema).iter_errors(dict(request.arguments)),
            None,
        )
        if validation_error is not None:
            return self._result(request, ToolStatus.INVALID, validation_error.message, "invalid")

        output = dict(tool.handler(request.arguments, request.context))
        return self._result(request, ToolStatus.SUCCEEDED, "explicit grant", "allowed", output)

    def audit_log(self) -> tuple[ToolAuditMetadata, ...]:
        return tuple(self._audit)

    def _result(
        self,
        request: ToolRequest,
        status: ToolStatus,
        reason: str,
        decision: str,
        output: Mapping[str, Any] | None = None,
    ) -> ToolResult:
        lineage = LineageMetadata.from_context(request.context)
        audit_id = hashlib.sha256(
            f"{request.context.idempotency_key}:{request.name}".encode()
        ).hexdigest()[:16]
        audit = ToolAuditMetadata(
            audit_id=audit_id,
            event=f"tool.invocation.{decision}",
            decision=decision,
            reason=reason,
            tenant_id=lineage.tenant_id,
            actor_id=lineage.actor_id,
            correlation_id=lineage.correlation_id,
            idempotency_key=lineage.idempotency_key,
            lineage=lineage.lineage,
        )
        self._audit.append(audit)
        return ToolResult(status=status, output=output, audit=audit)


__all__ = [
    "PermissionedTool",
    "PermissionedToolExecutor",
    "ToolAuditMetadata",
    "ToolHandler",
    "ToolRequest",
    "ToolResult",
    "ToolStatus",
]
