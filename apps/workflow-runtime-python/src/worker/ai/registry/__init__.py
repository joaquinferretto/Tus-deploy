"""Tenant-safe, provider-free prompt and model registry semantics."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass, field, replace
from enum import StrEnum


class RegistryStateError(ValueError):
    """Raised when a registry transition would violate a fail-closed rule."""


class RegistryValidationError(RegistryStateError):
    """Raised when a registry request is incomplete or invalid."""


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVOKED = "revoked"


class ModelAvailabilityStatus(StrEnum):
    AVAILABLE = "available"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"


class PromptVersionStatus(StrEnum):
    DRAFT = "draft"
    APPROVED = "approved"
    DEPRECATED = "deprecated"


class RolloutState(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"
    DEPRECATED = "deprecated"


@dataclass(frozen=True, slots=True)
class RegistryContext:
    tenant_id: str
    actor_id: str
    correlation_id: str

    def __post_init__(self) -> None:
        for field_name in ("tenant_id", "actor_id", "correlation_id"):
            if not getattr(self, field_name).strip():
                raise RegistryValidationError(f"Registry context {field_name} is required")


@dataclass(frozen=True, slots=True)
class PromptDefinition:
    id: str
    tenant_id: str
    key: str
    owner: str
    description: str = ""


@dataclass(frozen=True, slots=True)
class PromptVersion:
    id: str
    tenant_id: str
    prompt_id: str
    version: int
    template: str
    checksum: str
    status: PromptVersionStatus
    created_by: str
    approved_by: str | None = None
    deprecated_reason: str | None = None


@dataclass(frozen=True, slots=True)
class ModelDefinition:
    id: str
    tenant_id: str
    key: str
    provider: str
    model_name: str
    owner: str
    status: str = "registered"


@dataclass(frozen=True, slots=True)
class ModelAvailability:
    id: str
    tenant_id: str
    model_id: str
    status: ModelAvailabilityStatus
    reason: str
    observed_at: int


@dataclass(frozen=True, slots=True)
class Rollout:
    id: str
    tenant_id: str
    prompt_id: str
    prompt_version: int
    model_id: str
    percentage: int
    state: RolloutState
    created_by: str
    rollout_version: int = 1
    previous_rollout_id: str | None = None
    failure_reason: str | None = None


@dataclass(frozen=True, slots=True)
class Approval:
    id: str
    tenant_id: str
    resource_type: str
    resource_id: str
    requested_by: str
    status: ApprovalStatus = ApprovalStatus.PENDING
    approver_id: str | None = None
    reason: str = ""


@dataclass(frozen=True, slots=True)
class RegistryAudit:
    id: str
    tenant_id: str
    actor_id: str
    correlation_id: str
    action: str
    resource_type: str
    resource_id: str
    version: int | None
    outcome: str
    metadata: Mapping[str, object] = field(default_factory=dict)
    occurred_at: int = 0


@dataclass(frozen=True, slots=True)
class EvaluationResult:
    rollout_id: str
    prompt_version: int
    model_id: str
    output: str
    quality: float
    latency_ms: int
    cost_usd: float
    passed: bool = True


class DeterministicFakeEvaluator:
    """Stable local evaluation with no provider, network, or secret access."""

    def evaluate(
        self,
        rollout: Rollout,
        payload: Mapping[str, object],
    ) -> EvaluationResult:
        canonical = json.dumps(_canonicalize(payload), separators=(",", ":"), ensure_ascii=True)
        digest = _deterministic_digest(canonical)
        return EvaluationResult(
            rollout_id=rollout.id,
            prompt_version=rollout.prompt_version,
            model_id=rollout.model_id,
            output=f"fake-evaluation:{digest}",
            quality=1.0,
            latency_ms=17,
            cost_usd=0.0,
        )


class InMemoryAIRegistry:
    """Auditable versioned catalog used by local tests and deterministic fakes."""

    def __init__(self, *, clock: Callable[[], int] | None = None) -> None:
        self._clock = clock or (lambda: 0)
        self._sequence = 0
        self._prompts: dict[str, PromptDefinition] = {}
        self._prompt_versions: dict[str, PromptVersion] = {}
        self._models: dict[str, ModelDefinition] = {}
        self._availability: dict[str, ModelAvailability] = {}
        self._rollouts: dict[str, Rollout] = {}
        self._approvals: dict[str, Approval] = {}
        self._audits: list[RegistryAudit] = []
        self._evaluator = DeterministicFakeEvaluator()

    def register_prompt(
        self, context: RegistryContext, key: str, owner: str, description: str = ""
    ) -> PromptDefinition:
        _require_text(key, "Prompt key")
        _require_text(owner, "Prompt owner")
        if any(
            row.tenant_id == context.tenant_id and row.key == key for row in self._prompts.values()
        ):
            raise RegistryStateError("Prompt key already registered")
        prompt = PromptDefinition(self._id("prompt"), context.tenant_id, key, owner, description)
        self._prompts[prompt.id] = prompt
        self._audit(context, "prompt.registered", "prompt", prompt.id, None, "success")
        return prompt

    def create_prompt_version(
        self,
        context: RegistryContext,
        prompt_id: str,
        template: str,
        *,
        version: int | None = None,
    ) -> PromptVersion:
        prompt = self._get(context, self._prompts, prompt_id)
        _require_text(template, "Prompt template")
        existing = [
            row.version for row in self._prompt_versions.values() if row.prompt_id == prompt.id
        ]
        next_version = version if version is not None else (max(existing, default=0) + 1)
        if (
            not isinstance(next_version, int)
            or isinstance(next_version, bool)
            or next_version < 1
            or next_version in existing
        ):
            raise RegistryStateError("Prompt versions are immutable")
        checksum = _deterministic_digest(template)
        row = PromptVersion(
            self._id("prompt-version"),
            prompt.tenant_id,
            prompt.id,
            next_version,
            template,
            checksum,
            PromptVersionStatus.DRAFT,
            context.actor_id,
        )
        self._prompt_versions[row.id] = row
        self._audit(
            context, "prompt.version.created", "prompt_version", row.id, row.version, "success"
        )
        return row

    def register_model(
        self,
        context: RegistryContext,
        key: str,
        provider: str,
        model_name: str,
        owner: str,
    ) -> ModelDefinition:
        for value, label in (
            (key, "Model key"),
            (provider, "Model provider"),
            (model_name, "Model name"),
            (owner, "Model owner"),
        ):
            _require_text(value, label)
        if any(
            row.tenant_id == context.tenant_id and row.key == key for row in self._models.values()
        ):
            raise RegistryStateError("Model key already registered")
        row = ModelDefinition(
            self._id("model"), context.tenant_id, key, provider, model_name, owner
        )
        self._models[row.id] = row
        self._availability[row.id] = ModelAvailability(
            self._id("availability"),
            row.tenant_id,
            row.id,
            ModelAvailabilityStatus.UNAVAILABLE,
            "availability not approved",
            self._clock(),
        )
        self._audit(context, "model.registered", "model", row.id, None, "success")
        return row

    def set_model_availability(
        self,
        context: RegistryContext,
        model_id: str,
        status: ModelAvailabilityStatus,
        reason: str,
    ) -> ModelAvailability:
        model = self._get(context, self._models, model_id)
        if not isinstance(status, ModelAvailabilityStatus):
            raise RegistryValidationError("Model availability status is unsupported")
        _require_text(reason, "Availability reason")
        row = ModelAvailability(
            self._id("availability"), model.tenant_id, model.id, status, reason, self._clock()
        )
        self._availability[model.id] = row
        self._audit(
            context,
            "model.availability.changed",
            "model",
            model.id,
            None,
            "success",
            {"status": status.value},
        )
        return row

    def request_approval(
        self, context: RegistryContext, resource_type: str, resource_id: str, reason: str = ""
    ) -> Approval:
        self._resource(context, resource_type, resource_id)
        if resource_type not in {"prompt_version", "rollout", "model"}:
            raise RegistryValidationError("Unsupported approval resource")
        row = Approval(
            self._id("approval"),
            context.tenant_id,
            resource_type,
            resource_id,
            context.actor_id,
            reason=reason,
        )
        self._approvals[row.id] = row
        self._audit(context, "approval.requested", "approval", row.id, None, "success")
        return row

    def approve(self, context: RegistryContext, approval_id: str) -> Approval:
        row = self._get(context, self._approvals, approval_id)
        if row.status is not ApprovalStatus.PENDING:
            raise RegistryStateError("Approval is no longer pending")
        if row.requested_by == context.actor_id:
            raise RegistryStateError("Approval requires a distinct actor")
        target = self._resource(context, row.resource_type, row.resource_id)
        updated = replace(row, status=ApprovalStatus.APPROVED, approver_id=context.actor_id)
        self._approvals[row.id] = updated
        if isinstance(target, PromptVersion):
            self._prompt_versions[target.id] = replace(
                target, status=PromptVersionStatus.APPROVED, approved_by=context.actor_id
            )
        self._audit(
            context,
            "approval.approved",
            "approval",
            row.id,
            getattr(target, "version", None),
            "success",
        )
        return updated

    def create_rollout(
        self,
        context: RegistryContext,
        prompt_id: str,
        prompt_version: int,
        model_id: str,
        percentage: int,
    ) -> Rollout:
        prompt = self._get(context, self._prompts, prompt_id)
        version = self._prompt_version(context, prompt.id, prompt_version)
        model = self._get(context, self._models, model_id)
        if version.status is not PromptVersionStatus.APPROVED:
            raise RegistryStateError("Prompt version must be approved before rollout")
        if version.status is PromptVersionStatus.DEPRECATED:
            raise RegistryStateError("Deprecated prompt versions cannot roll out")
        if self._availability[model.id].status not in {
            ModelAvailabilityStatus.AVAILABLE,
            ModelAvailabilityStatus.DEGRADED,
        }:
            raise RegistryStateError("Model is not available for rollout")
        if (
            not isinstance(percentage, int)
            or isinstance(percentage, bool)
            or not 1 <= percentage <= 100
        ):
            raise RegistryValidationError("Rollout percentage must be between 1 and 100")
        row = Rollout(
            self._id("rollout"),
            prompt.tenant_id,
            prompt.id,
            version.version,
            model.id,
            percentage,
            RolloutState.DRAFT,
            context.actor_id,
        )
        self._rollouts[row.id] = row
        self._audit(context, "rollout.created", "rollout", row.id, version.version, "success")
        return row

    def activate_rollout(self, context: RegistryContext, rollout_id: str) -> Rollout:
        row = self._get(context, self._rollouts, rollout_id)
        self._assert_rollout_ready(context, row)
        if not self._has_approved_approval(context, "rollout", row.id):
            raise RegistryStateError("Rollout requires approval before activation")
        for current_id, current in tuple(self._rollouts.items()):
            if (
                current.prompt_id == row.prompt_id
                and current.state is RolloutState.ACTIVE
                and current_id != row.id
            ):
                self._rollouts[current_id] = replace(current, state=RolloutState.PAUSED)
        updated = replace(row, state=RolloutState.ACTIVE)
        self._rollouts[row.id] = updated
        self._audit(context, "rollout.activated", "rollout", row.id, row.prompt_version, "success")
        return updated

    def deprecate_prompt_version(
        self, context: RegistryContext, prompt_id: str, version: int, reason: str
    ) -> PromptVersion:
        row = self._prompt_version(context, prompt_id, version)
        _require_text(reason, "Deprecation reason")
        updated = replace(row, status=PromptVersionStatus.DEPRECATED, deprecated_reason=reason)
        self._prompt_versions[row.id] = updated
        for rollout_id, rollout in tuple(self._rollouts.items()):
            if rollout.prompt_id == prompt_id and rollout.prompt_version == version:
                self._rollouts[rollout_id] = replace(rollout, state=RolloutState.DEPRECATED)
        self._audit(
            context, "prompt.version.deprecated", "prompt_version", row.id, version, "success"
        )
        return updated

    def rollback_rollout(
        self, context: RegistryContext, rollout_id: str, target_version: int, reason: str
    ) -> Rollout:
        current = self._get(context, self._rollouts, rollout_id)
        _require_text(reason, "Rollback reason")
        target = self._prompt_version(context, current.prompt_id, target_version)
        if target.status is not PromptVersionStatus.APPROVED:
            raise RegistryStateError("Rollback target must be approved")
        self._assert_model_available(context, current.model_id)
        self._rollouts[current.id] = replace(current, state=RolloutState.ROLLED_BACK)
        restored = Rollout(
            self._id("rollout"),
            current.tenant_id,
            current.prompt_id,
            target.version,
            current.model_id,
            current.percentage,
            RolloutState.ACTIVE,
            context.actor_id,
            current.rollout_version + 1,
            current.id,
        )
        self._rollouts[restored.id] = restored
        self._audit(
            context,
            "rollout.rolled_back",
            "rollout",
            restored.id,
            target.version,
            "success",
            {"reason": "redacted"},
        )
        return restored

    def record_provider_failure(self, context: RegistryContext, model_id: str, reason: str) -> None:
        self._get(context, self._models, model_id)
        _require_text(reason, "Provider failure reason")
        self._availability[model_id] = ModelAvailability(
            self._id("availability"),
            context.tenant_id,
            model_id,
            ModelAvailabilityStatus.UNAVAILABLE,
            reason,
            self._clock(),
        )
        for rollout_id, rollout in tuple(self._rollouts.items()):
            if rollout.model_id == model_id and rollout.state is not RolloutState.DEPRECATED:
                self._rollouts[rollout_id] = replace(
                    rollout, state=RolloutState.PAUSED, failure_reason="provider unavailable"
                )
        self._audit(
            context, "provider.failure", "model", model_id, None, "failed", {"reason": "redacted"}
        )

    def evaluate(
        self, context: RegistryContext, rollout_id: str, payload: Mapping[str, object]
    ) -> EvaluationResult:
        row = self._get(context, self._rollouts, rollout_id)
        if not isinstance(payload, Mapping):
            raise RegistryValidationError("Evaluation payload is required")
        version = self._prompt_version(context, row.prompt_id, row.prompt_version)
        if version.status is PromptVersionStatus.DEPRECATED or row.state is RolloutState.DEPRECATED:
            raise RegistryStateError("deprecated prompt version cannot be evaluated")
        self._assert_model_available(context, row.model_id)
        if row.state is not RolloutState.ACTIVE:
            raise RegistryStateError("Rollout is not active")
        result = self._evaluator.evaluate(row, payload)
        self._audit(
            context,
            "evaluation.completed",
            "rollout",
            row.id,
            row.prompt_version,
            "success",
            {"input_keys": _safe_input_keys(payload)},
        )
        return result

    def get_prompt_version(self, context: RegistryContext, version_id: str) -> PromptVersion:
        return self._get(context, self._prompt_versions, version_id)

    def get_model(self, context: RegistryContext, model_id: str) -> ModelDefinition:
        return self._get(context, self._models, model_id)

    def get_model_availability(self, context: RegistryContext, model_id: str) -> ModelAvailability:
        self._get(context, self._models, model_id)
        row = self._availability.get(model_id)
        if row is None or row.tenant_id != context.tenant_id:
            raise KeyError("No tenant-scoped model availability")
        return deepcopy(row)

    def list_prompts(self, context: RegistryContext) -> tuple[PromptDefinition, ...]:
        return tuple(
            deepcopy(row) for row in self._prompts.values() if row.tenant_id == context.tenant_id
        )

    def list_models(self, context: RegistryContext) -> tuple[ModelDefinition, ...]:
        return tuple(
            deepcopy(row) for row in self._models.values() if row.tenant_id == context.tenant_id
        )

    def list_rollouts(self, context: RegistryContext) -> tuple[Rollout, ...]:
        return tuple(
            deepcopy(row) for row in self._rollouts.values() if row.tenant_id == context.tenant_id
        )

    def get_rollout(self, context: RegistryContext, rollout_id: str) -> Rollout:
        return self._get(context, self._rollouts, rollout_id)

    def get_active_rollout(self, context: RegistryContext, prompt_id: str) -> Rollout:
        self._get(context, self._prompts, prompt_id)
        for row in self._rollouts.values():
            if row.prompt_id == prompt_id and row.state is RolloutState.ACTIVE:
                return deepcopy(row)
        raise KeyError("No active tenant-scoped rollout")

    def get_approval(self, context: RegistryContext, approval_id: str) -> Approval:
        return self._get(context, self._approvals, approval_id)

    def list_approvals(self, context: RegistryContext) -> tuple[Approval, ...]:
        return tuple(
            deepcopy(row) for row in self._approvals.values() if row.tenant_id == context.tenant_id
        )

    def audit_log(self, context: RegistryContext) -> tuple[RegistryAudit, ...]:
        return tuple(deepcopy(row) for row in self._audits if row.tenant_id == context.tenant_id)

    def _assert_rollout_ready(self, context: RegistryContext, row: Rollout) -> None:
        version = self._prompt_version(context, row.prompt_id, row.prompt_version)
        if version.status is PromptVersionStatus.DEPRECATED:
            raise RegistryStateError("Deprecated prompt versions cannot roll out")
        if version.status is not PromptVersionStatus.APPROVED:
            raise RegistryStateError("Prompt version must be approved before rollout")
        self._assert_model_available(context, row.model_id)

    def _assert_model_available(self, context: RegistryContext, model_id: str) -> None:
        self._get(context, self._models, model_id)
        if self._availability[model_id].status not in {
            ModelAvailabilityStatus.AVAILABLE,
            ModelAvailabilityStatus.DEGRADED,
        }:
            raise RegistryStateError("Model is unavailable")

    def _prompt_version(
        self, context: RegistryContext, prompt_id: str, version: int
    ) -> PromptVersion:
        self._get(context, self._prompts, prompt_id)
        for row in self._prompt_versions.values():
            if (
                row.tenant_id == context.tenant_id
                and row.prompt_id == prompt_id
                and row.version == version
            ):
                return deepcopy(row)
        raise KeyError("No tenant-scoped prompt version")

    def _resource(self, context: RegistryContext, resource_type: str, resource_id: str) -> object:
        stores: dict[str, Mapping[str, object]] = {
            "prompt_version": self._prompt_versions,
            "rollout": self._rollouts,
            "model": self._models,
        }
        try:
            store = stores[resource_type]
        except KeyError as error:
            raise RegistryValidationError("Unsupported registry resource") from error
        return self._get(context, store, resource_id)

    def _get(self, context: RegistryContext, store: Mapping[str, object], key: str) -> object:
        row = store.get(key)
        if row is None or getattr(row, "tenant_id", None) != context.tenant_id:
            raise KeyError("No tenant-scoped registry record")
        return deepcopy(row)

    def _has_approved_approval(
        self, context: RegistryContext, resource_type: str, resource_id: str
    ) -> bool:
        return any(
            row.tenant_id == context.tenant_id
            and row.resource_type == resource_type
            and row.resource_id == resource_id
            and row.status is ApprovalStatus.APPROVED
            for row in self._approvals.values()
        )

    def _id(self, prefix: str) -> str:
        self._sequence += 1
        return f"{prefix}-{self._sequence}"

    def _audit(
        self,
        context: RegistryContext,
        action: str,
        resource_type: str,
        resource_id: str,
        version: int | None,
        outcome: str,
        metadata: Mapping[str, object] | None = None,
    ) -> None:
        self._audits.append(
            RegistryAudit(
                self._id("audit"),
                context.tenant_id,
                context.actor_id,
                context.correlation_id,
                action,
                resource_type,
                resource_id,
                version,
                outcome,
                _redact(metadata or {}),
                self._clock(),
            )
        )


def _require_text(value: str, label: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise RegistryValidationError(f"{label} is required")


def _redact(value: object) -> object:
    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]"
            if any(word in str(key).lower() for word in ("secret", "token", "password", "template"))
            else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return deepcopy(value)


def _canonicalize(value: object) -> object:
    if isinstance(value, Mapping):
        return {str(key): _canonicalize(value[key]) for key in sorted(value, key=str)}
    if isinstance(value, list):
        return [_canonicalize(item) for item in value]
    if isinstance(value, tuple):
        return [_canonicalize(item) for item in value]
    return value


def _deterministic_digest(value: str) -> str:
    hash_value = 2166136261
    for char in value:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return f"{hash_value:08x}"


def _safe_input_keys(payload: Mapping[str, object]) -> list[str]:
    return sorted(
        key
        for key in map(str, payload)
        if not any(word in key.lower() for word in ("secret", "token", "password"))
    )


__all__ = [
    "Approval",
    "ApprovalStatus",
    "DeterministicFakeEvaluator",
    "EvaluationResult",
    "InMemoryAIRegistry",
    "ModelAvailability",
    "ModelAvailabilityStatus",
    "ModelDefinition",
    "PromptDefinition",
    "PromptVersion",
    "PromptVersionStatus",
    "RegistryAudit",
    "RegistryContext",
    "RegistryStateError",
    "RegistryValidationError",
    "Rollout",
    "RolloutState",
]
