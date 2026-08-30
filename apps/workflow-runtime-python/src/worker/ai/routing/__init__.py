"""Explicit tenant/provider/model AI routing with bounded failure handling."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field, replace
from typing import Protocol

from worker.ai.circuit_breaker import CircuitBreaker, CircuitOpenError
from worker.ai.cost import ModelPricing, calculate_cost
from worker.ai.llm import LLMRequest, LLMResponse, ProviderUnavailableError
from worker.ai.quota import HardTenantQuota, QuotaReservation
from worker.ai.retry import ProviderTimeoutError, RetryPolicy, failure_reason
from worker.ai.usage import InMemoryUsageLedger

RouteKey = tuple[str, str]


class ProviderClient(Protocol):
    def complete(self, request: LLMRequest) -> LLMResponse: ...


ProviderOperation = Callable[[LLMRequest], LLMResponse]


@dataclass(slots=True)
class ProviderRoute:
    provider: str
    model: str
    client: ProviderClient | ProviderOperation
    pricing: ModelPricing = field(default_factory=ModelPricing)
    failure_threshold: int = 2
    reset_timeout_ms: int = 30_000
    breaker: CircuitBreaker = field(init=False)

    def __post_init__(self) -> None:
        if not self.provider.strip() or not self.model.strip():
            raise ValueError("Provider and model are required")
        self.breaker = CircuitBreaker(
            failure_threshold=self.failure_threshold,
            reset_timeout_ms=self.reset_timeout_ms,
        )

    @property
    def key(self) -> RouteKey:
        return (self.provider, self.model)


@dataclass(frozen=True, slots=True)
class RoutingPolicy:
    tenant_routes: dict[str, tuple[RouteKey, ...]]
    max_attempts: int = 2
    timeout_ms: int = 3_000

    def __post_init__(self) -> None:
        RetryPolicy(self.max_attempts)
        if self.timeout_ms < 1:
            raise ValueError("timeout_ms must be positive")
        if any(not tenant.strip() for tenant in self.tenant_routes):
            raise ValueError("tenant route keys are required")


@dataclass(frozen=True, slots=True)
class AttemptMetadata:
    provider: str
    model: str
    outcome: str
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class RoutingMetadata:
    tenant_id: str
    requested_provider: str | None
    requested_model: str
    selected_provider: str | None
    selected_model: str | None
    attempt_count: int
    retry_count: int
    timeout_count: int
    circuit_open_count: int
    fallback_used: bool
    fallback_reason: str | None
    cost_usd: float
    attempts: tuple[AttemptMetadata, ...]


@dataclass(frozen=True, slots=True)
class RoutedResponse:
    response: LLMResponse
    metadata: RoutingMetadata


class RoutingError(RuntimeError):
    """A route failed without hiding provider-switch or failure metadata."""

    def __init__(self, message: str, metadata: RoutingMetadata) -> None:
        self.metadata = metadata
        super().__init__(message)


class ProviderRouter:
    def __init__(
        self,
        *,
        routes: tuple[ProviderRoute, ...],
        policy: RoutingPolicy,
        quota: HardTenantQuota | None = None,
        usage: InMemoryUsageLedger | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._routes = {route.key: route for route in routes}
        if len(self._routes) != len(routes):
            raise ValueError("Provider/model routes must be unique")
        self._policy = policy
        self._quota = quota
        self._usage = usage or InMemoryUsageLedger()
        self._clock = clock
        self._validate_policy_routes()

    def complete(self, request: LLMRequest, *, provider: str | None = None) -> RoutedResponse:
        tenant_id = request.context.tenant_id
        keys = self._policy.tenant_routes.get(tenant_id)
        if not keys:
            raise RoutingError(
                "no tenant route is configured",
                self._empty_metadata(request, provider),
            )
        if provider is not None:
            keys = tuple(key for key in keys if key[0] == provider)
        if not keys:
            raise RoutingError(
                "no tenant route matches the requested provider",
                self._empty_metadata(request, provider),
            )

        reservation: QuotaReservation | None = None
        if self._quota is not None:
            reservation = self._quota.reserve(tenant_id)
        attempts: list[AttemptMetadata] = []
        retry_count = 0
        timeout_count = 0
        circuit_open_count = 0
        fallback_reason: str | None = None
        try:
            for route_index, key in enumerate(keys):
                route = self._routes[key]
                for attempt_index in range(self._policy.max_attempts):
                    try:
                        route.breaker.before_call(self._now())
                    except CircuitOpenError:
                        circuit_open_count += 1
                        fallback_reason = fallback_reason or "circuit_open"
                        attempts.append(AttemptMetadata(*route.key, "skipped", "circuit_open"))
                        break
                    try:
                        response = self._call(route, replace(request, model=route.model))
                        self._validate_response(route, response)
                    except (ProviderTimeoutError, TimeoutError) as error:
                        route.breaker.record_failure(self._now())
                        timeout_count += 1
                        retry_count += int(attempt_index < self._policy.max_attempts - 1)
                        fallback_reason = fallback_reason or "timeout"
                        attempts.append(
                            AttemptMetadata(*route.key, "failed", failure_reason(error))
                        )
                        continue
                    except (
                        ConnectionError,
                        OSError,
                        ProviderUnavailableError,
                        RuntimeError,
                        ValueError,
                    ) as error:
                        route.breaker.record_failure(self._now())
                        retry_count += int(attempt_index < self._policy.max_attempts - 1)
                        fallback_reason = fallback_reason or "provider_error"
                        attempts.append(
                            AttemptMetadata(*route.key, "failed", failure_reason(error))
                        )
                        continue

                    route.breaker.record_success()
                    cost_usd = self._cost(route, response)
                    if reservation is not None:
                        self._quota.commit(
                            reservation,
                            tokens=response.usage.total_tokens,
                            cost_usd=cost_usd,
                        )
                        reservation = None
                    self._usage.record(tenant_id, response, cost_usd)
                    metadata = RoutingMetadata(
                        tenant_id=tenant_id,
                        requested_provider=provider,
                        requested_model=request.model,
                        selected_provider=route.provider,
                        selected_model=route.model,
                        attempt_count=len(attempts) + 1,
                        retry_count=retry_count,
                        timeout_count=timeout_count,
                        circuit_open_count=circuit_open_count,
                        fallback_used=route_index > 0,
                        fallback_reason=fallback_reason if route_index > 0 else None,
                        cost_usd=cost_usd,
                        attempts=tuple(attempts + [AttemptMetadata(*route.key, "succeeded")]),
                    )
                    return RoutedResponse(response, metadata)
                if route_index < len(keys) - 1:
                    fallback_reason = fallback_reason or "provider_error"
            metadata = RoutingMetadata(
                tenant_id=tenant_id,
                requested_provider=provider,
                requested_model=request.model,
                selected_provider=None,
                selected_model=None,
                attempt_count=len(attempts),
                retry_count=retry_count,
                timeout_count=timeout_count,
                circuit_open_count=circuit_open_count,
                fallback_used=len(keys) > 1,
                fallback_reason=fallback_reason if len(keys) > 1 else None,
                cost_usd=0.0,
                attempts=tuple(attempts),
            )
            raise RoutingError("all configured provider routes failed", metadata)
        finally:
            if reservation is not None:
                self._quota.release(reservation)

    def _call(self, route: ProviderRoute, request: LLMRequest) -> LLMResponse:
        executor = ThreadPoolExecutor(max_workers=1)
        operation = route.client.complete if hasattr(route.client, "complete") else route.client
        future = executor.submit(operation, request)
        try:
            return future.result(timeout=self._policy.timeout_ms / 1000)
        except FutureTimeoutError as error:
            future.cancel()
            raise ProviderTimeoutError("provider request timed out") from error
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    @staticmethod
    def _validate_response(route: ProviderRoute, response: LLMResponse) -> None:
        if response.provider != route.provider or response.model != route.model:
            raise ProviderUnavailableError("provider returned an unexpected route identity")

    @staticmethod
    def _cost(route: ProviderRoute, response: LLMResponse) -> float:
        calculated = calculate_cost(
            response.usage.prompt_tokens,
            response.usage.completion_tokens,
            route.pricing,
        )
        return calculated if calculated > 0 else response.usage.estimated_cost_usd

    def _empty_metadata(self, request: LLMRequest, provider: str | None) -> RoutingMetadata:
        return RoutingMetadata(
            tenant_id=request.context.tenant_id,
            requested_provider=provider,
            requested_model=request.model,
            selected_provider=None,
            selected_model=None,
            attempt_count=0,
            retry_count=0,
            timeout_count=0,
            circuit_open_count=0,
            fallback_used=False,
            fallback_reason=None,
            cost_usd=0.0,
            attempts=(),
        )

    def _now(self) -> float | None:
        return self._clock() if self._clock is not None else None

    def _validate_policy_routes(self) -> None:
        for keys in self._policy.tenant_routes.values():
            if not keys:
                raise ValueError("tenant route lists cannot be empty")
            for key in keys:
                if key not in self._routes:
                    raise ValueError(f"unknown provider route: {key!r}")


__all__ = [
    "AttemptMetadata",
    "ProviderRoute",
    "ProviderRouter",
    "RoutedResponse",
    "RoutingError",
    "RoutingMetadata",
    "RoutingPolicy",
]
