"""Deny-by-default policy ports for tools and human approvals."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

from worker.langgraph.registry import RuntimeContext


class PolicyDeniedError(PermissionError):
    """Raised when a tool or HITL action has no explicit grant."""


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    allowed: bool
    kind: str
    resource: str
    tenant_id: str
    actor_id: str
    reason: str


class ToolInvoker(Protocol):
    def invoke(
        self,
        name: str,
        context: RuntimeContext,
        request: Mapping[str, object],
    ) -> dict[str, object]: ...


class DenyByDefaultPolicy:
    def __init__(self) -> None:
        self._tool_grants: set[tuple[str, str, str]] = set()
        self._hitl_grants: set[tuple[str, str, str]] = set()
        self._decisions: list[PolicyDecision] = []

    def allow_tool(self, tenant_id: str, tool_name: str, actor_id: str) -> None:
        self._tool_grants.add((tenant_id, actor_id, tool_name))

    def allow_hitl(self, tenant_id: str, action: str, actor_id: str) -> None:
        self._hitl_grants.add((tenant_id, actor_id, action))

    def evaluate_tool(self, context: RuntimeContext, tool_name: str) -> PolicyDecision:
        return self._evaluate(
            context,
            kind="tool",
            resource=tool_name,
            grants=self._tool_grants,
        )

    def evaluate_hitl(self, context: RuntimeContext, action: str) -> PolicyDecision:
        return self._evaluate(
            context,
            kind="hitl",
            resource=action,
            grants=self._hitl_grants,
        )

    def require_tool(self, context: RuntimeContext, tool_name: str) -> PolicyDecision:
        return self._require(self.evaluate_tool(context, tool_name))

    def require_hitl(self, context: RuntimeContext, action: str) -> PolicyDecision:
        return self._require(self.evaluate_hitl(context, action))

    def decisions(self) -> tuple[PolicyDecision, ...]:
        return tuple(self._decisions)

    def _evaluate(
        self,
        context: RuntimeContext,
        *,
        kind: str,
        resource: str,
        grants: set[tuple[str, str, str]],
    ) -> PolicyDecision:
        _require_context(context)
        allowed = (context.tenant_id, context.actor_id, resource) in grants
        decision = PolicyDecision(
            allowed=allowed,
            kind=kind,
            resource=resource,
            tenant_id=context.tenant_id,
            actor_id=context.actor_id,
            reason="explicit grant" if allowed else "deny by default",
        )
        self._decisions.append(decision)
        return decision

    def _require(self, decision: PolicyDecision) -> PolicyDecision:
        if not decision.allowed:
            raise PolicyDeniedError(
                f"{decision.kind} {decision.resource!r} denied for tenant {decision.tenant_id!r}"
            )
        return decision


class PolicyEnforcedToolExecutor:
    """The only local tool execution boundary exposed by P3.3 policy tests."""

    def __init__(self, invoker: ToolInvoker, policy: DenyByDefaultPolicy) -> None:
        self._invoker = invoker
        self._policy = policy

    def invoke(
        self,
        name: str,
        context: RuntimeContext,
        request: Mapping[str, object],
    ) -> dict[str, object]:
        self._policy.require_tool(context, name)
        return self._invoker.invoke(name, context, request)


def _require_context(context: RuntimeContext) -> None:
    if not isinstance(context, RuntimeContext):
        raise TypeError("Runtime context is required")


__all__ = [
    "DenyByDefaultPolicy",
    "PolicyDecision",
    "PolicyDeniedError",
    "PolicyEnforcedToolExecutor",
]
