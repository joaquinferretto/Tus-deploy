"""Provider-free Bedrock boundary with explicit paid/live activation gates."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from worker.ai.llm import LineageMetadata, ProviderUnavailableError
from worker.langgraph.registry import RuntimeContext


@dataclass(frozen=True, slots=True)
class BedrockActivationRequirements:
    """Evidence required before an injected transport may represent live use."""

    credits: bool = False
    credentials: bool = False
    region: bool = False
    quota: bool = False
    owner_approval: bool = False
    live_conformance: bool = False

    def missing(self, *, region: str) -> tuple[str, ...]:
        missing: list[str] = []
        if not self.credits:
            missing.append("credits")
        if not self.credentials:
            missing.append("credentials")
        if not self.region or not region.strip():
            missing.append("region")
        if not self.quota:
            missing.append("quota")
        if not self.owner_approval:
            missing.append("owner_approval")
        if not self.live_conformance:
            missing.append("live_conformance")
        return tuple(missing)


class BedrockActivationGate:
    """Fail-closed gate for Bedrock and its specialized AWS service ports."""

    def __init__(
        self,
        *,
        requirements: BedrockActivationRequirements | None = None,
        region: str = "",
        config_ref: str = "aws-secret-store:bedrock",
    ) -> None:
        if not config_ref.strip():
            raise ValueError("Bedrock config reference is required")
        self.requirements = requirements or BedrockActivationRequirements()
        self.region = region.strip()
        self.config_ref = config_ref

    @property
    def missing_requirements(self) -> tuple[str, ...]:
        return self.requirements.missing(region=self.region)

    @property
    def active(self) -> bool:
        return not self.missing_requirements

    def assert_active(self) -> None:
        if not self.active:
            raise ProviderUnavailableError(
                "Bedrock activation is gated until required evidence exists"
            )


@dataclass(frozen=True, slots=True)
class BedrockRequest:
    service: str
    operation: str
    payload: Mapping[str, object]
    context: RuntimeContext

    def __post_init__(self) -> None:
        if not self.service.strip() or not self.operation.strip():
            raise ValueError("Bedrock service and operation are required")
        if not isinstance(self.context, RuntimeContext):
            raise TypeError("runtime context is required")


@dataclass(frozen=True, slots=True)
class BedrockUsage:
    input_units: int
    output_units: int
    estimated_cost_usd: float
    currency: str = "USD"


@dataclass(frozen=True, slots=True)
class BedrockResponse:
    output: str
    provider: str
    service: str
    operation: str
    usage: BedrockUsage
    lineage: LineageMetadata


BedrockTransport = Callable[[BedrockRequest], str]


class DeterministicBedrock:
    """Stable local fake; it never imports an SDK or performs network I/O."""

    provider = "fake"

    def invoke(self, request: BedrockRequest) -> BedrockResponse:
        encoded = _canonical_payload(request.payload)
        digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:16]
        return BedrockResponse(
            output=f"fake-{request.service}-{digest}",
            provider=self.provider,
            service=request.service,
            operation=request.operation,
            usage=BedrockUsage(input_units=len(encoded), output_units=1, estimated_cost_usd=0.0),
            lineage=LineageMetadata.from_context(request.context),
        )


class BedrockAdapter:
    """Injected Bedrock transport with no implicit credential or cloud discovery."""

    provider = "bedrock"

    def __init__(
        self,
        transport: BedrockTransport | None = None,
        *,
        requirements: BedrockActivationRequirements | None = None,
        region: str = "",
        config_ref: str = "aws-secret-store:bedrock",
        cost_per_unit_usd: float = 0.01,
    ) -> None:
        if cost_per_unit_usd < 0:
            raise ValueError("Bedrock cost must be non-negative")
        self._transport = transport
        self._gate = BedrockActivationGate(
            requirements=requirements,
            region=region,
            config_ref=config_ref,
        )
        self._cost_per_unit_usd = cost_per_unit_usd

    @property
    def active(self) -> bool:
        return self._gate.active and self._transport is not None

    @property
    def gate(self) -> BedrockActivationGate:
        return self._gate

    def invoke(self, request: BedrockRequest) -> BedrockResponse:
        self._gate.assert_active()
        if self._transport is None:
            raise ProviderUnavailableError(
                "Bedrock provider is active but transport is unavailable"
            )
        try:
            output = self._transport(request)
        except Exception as error:
            raise RuntimeError("Bedrock provider request failed") from error
        if not isinstance(output, str) or not output.strip():
            raise RuntimeError("Bedrock provider returned no output")
        return BedrockResponse(
            output=output.strip(),
            provider=self.provider,
            service=request.service,
            operation=request.operation,
            usage=BedrockUsage(
                input_units=len(_canonical_payload(request.payload)),
                output_units=len(output.split()),
                estimated_cost_usd=round(max(1, len(output.split())) * self._cost_per_unit_usd, 8),
            ),
            lineage=LineageMetadata.from_context(request.context),
        )


def _canonical_payload(payload: Mapping[str, object]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


__all__ = [
    "BedrockActivationGate",
    "BedrockActivationRequirements",
    "BedrockAdapter",
    "BedrockRequest",
    "BedrockResponse",
    "BedrockTransport",
    "BedrockUsage",
    "DeterministicBedrock",
    "ProviderUnavailableError",
]
