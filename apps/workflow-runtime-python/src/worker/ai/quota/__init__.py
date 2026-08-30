"""Hard, tenant-isolated AI request, token, and cost quotas."""

from __future__ import annotations

from dataclasses import dataclass


class QuotaExceededError(RuntimeError):
    """Raised before or during a request that would exceed a tenant quota."""


@dataclass(frozen=True, slots=True)
class TenantQuota:
    max_requests: int
    max_tokens: int
    max_cost_usd: float

    def __post_init__(self) -> None:
        if self.max_requests < 1 or self.max_tokens < 0 or self.max_cost_usd < 0:
            raise ValueError("Tenant quota limits must be non-negative and request limit positive")


@dataclass(frozen=True, slots=True)
class QuotaUsage:
    requests: int = 0
    tokens: int = 0
    cost_usd: float = 0.0


@dataclass(frozen=True, slots=True)
class QuotaReservation:
    reservation_id: str
    tenant_id: str
    requests: int
    tokens: int
    cost_usd: float


class HardTenantQuota:
    """In-memory quota authority; every reservation is scoped to one tenant."""

    def __init__(self) -> None:
        self._limits: dict[str, TenantQuota] = {}
        self._usage: dict[str, QuotaUsage] = {}
        self._reserved: dict[str, QuotaUsage] = {}
        self._reservations: dict[str, QuotaReservation] = {}
        self._sequence = 0

    def configure(self, tenant_id: str, quota: TenantQuota) -> None:
        _require_tenant(tenant_id)
        self._limits[tenant_id] = quota
        self._usage.setdefault(tenant_id, QuotaUsage())
        self._reserved.setdefault(tenant_id, QuotaUsage())

    def reserve(
        self, tenant_id: str, *, requests: int = 1, tokens: int = 0, cost_usd: float = 0.0
    ) -> QuotaReservation:
        self._require_configured(tenant_id)
        if requests < 1 or tokens < 0 or cost_usd < 0:
            raise ValueError("Quota reservation amounts are invalid")
        limit = self._limits[tenant_id]
        usage = self._usage[tenant_id]
        reserved = self._reserved[tenant_id]
        self._assert_available(
            limit,
            requests=usage.requests + reserved.requests + requests,
            tokens=usage.tokens + reserved.tokens + tokens,
            cost_usd=usage.cost_usd + reserved.cost_usd + cost_usd,
        )
        reservation = QuotaReservation(
            reservation_id=self._next_id(),
            tenant_id=tenant_id,
            requests=requests,
            tokens=tokens,
            cost_usd=round(cost_usd, 8),
        )
        self._reservations[reservation.reservation_id] = reservation
        self._reserved[tenant_id] = _add(reserved, reservation)
        return reservation

    def commit(self, reservation: QuotaReservation, *, tokens: int, cost_usd: float) -> QuotaUsage:
        current = self._reservations.get(reservation.reservation_id)
        if current is None or current != reservation:
            raise KeyError("Unknown quota reservation")
        if tokens < 0 or cost_usd < 0:
            raise ValueError("Committed quota amounts are invalid")
        limit = self._limits[reservation.tenant_id]
        usage = self._usage[reservation.tenant_id]
        self._assert_available(
            limit,
            requests=usage.requests + current.requests,
            tokens=usage.tokens + tokens,
            cost_usd=usage.cost_usd + cost_usd,
        )
        self._take(reservation)
        updated = QuotaUsage(
            requests=usage.requests + current.requests,
            tokens=usage.tokens + tokens,
            cost_usd=round(usage.cost_usd + cost_usd, 8),
        )
        self._usage[reservation.tenant_id] = updated
        return updated

    def release(self, reservation: QuotaReservation) -> None:
        self._take(reservation)

    def usage(self, tenant_id: str) -> QuotaUsage:
        self._require_configured(tenant_id)
        return self._usage[tenant_id]

    def _take(self, reservation: QuotaReservation) -> QuotaReservation:
        current = self._reservations.pop(reservation.reservation_id, None)
        if current is None or current != reservation:
            raise KeyError("Unknown quota reservation")
        reserved = self._reserved[reservation.tenant_id]
        self._reserved[reservation.tenant_id] = QuotaUsage(
            requests=reserved.requests - reservation.requests,
            tokens=reserved.tokens - reservation.tokens,
            cost_usd=round(reserved.cost_usd - reservation.cost_usd, 8),
        )
        return current

    def _require_configured(self, tenant_id: str) -> None:
        _require_tenant(tenant_id)
        if tenant_id not in self._limits:
            raise QuotaExceededError("tenant quota is not configured")

    @staticmethod
    def _assert_available(
        limit: TenantQuota, *, requests: int, tokens: int, cost_usd: float
    ) -> None:
        if requests > limit.max_requests:
            raise QuotaExceededError("tenant requests quota exceeded")
        if tokens > limit.max_tokens:
            raise QuotaExceededError("tenant tokens quota exceeded")
        if cost_usd > limit.max_cost_usd:
            raise QuotaExceededError("tenant cost quota exceeded")

    def _next_id(self) -> str:
        self._sequence += 1
        return f"quota-{self._sequence}"


def _add(usage: QuotaUsage, reservation: QuotaReservation) -> QuotaUsage:
    return QuotaUsage(
        requests=usage.requests + reservation.requests,
        tokens=usage.tokens + reservation.tokens,
        cost_usd=round(usage.cost_usd + reservation.cost_usd, 8),
    )


def _require_tenant(tenant_id: str) -> None:
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("tenant_id is required")


__all__ = [
    "HardTenantQuota",
    "QuotaExceededError",
    "QuotaReservation",
    "QuotaUsage",
    "TenantQuota",
]
