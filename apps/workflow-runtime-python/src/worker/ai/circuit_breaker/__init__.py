"""Small deterministic circuit breaker for provider calls."""

from __future__ import annotations

import time
from collections.abc import Callable
from enum import StrEnum


class CircuitState(StrEnum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpenError(RuntimeError):
    """Raised when a provider circuit is open and the call is rejected."""

    def __init__(self, retry_at_ms: float | None = None) -> None:
        self.retry_at_ms = retry_at_ms
        super().__init__("provider circuit is open")


class CircuitBreaker:
    def __init__(
        self,
        *,
        failure_threshold: int = 2,
        reset_timeout_ms: int = 30_000,
        clock: Callable[[], float] | None = None,
    ) -> None:
        if not isinstance(failure_threshold, int) or isinstance(failure_threshold, bool):
            raise TypeError("failure_threshold must be an integer")
        if failure_threshold < 1:
            raise ValueError("failure_threshold must be positive")
        if not isinstance(reset_timeout_ms, int) or isinstance(reset_timeout_ms, bool):
            raise TypeError("reset_timeout_ms must be an integer")
        if reset_timeout_ms < 1:
            raise ValueError("reset_timeout_ms must be positive")
        self.failure_threshold = failure_threshold
        self.reset_timeout_ms = reset_timeout_ms
        self._clock = clock or (lambda: time.monotonic() * 1000)
        self._state = CircuitState.CLOSED
        self._failures = 0
        self._opened_at_ms: float | None = None
        self._half_open_probe = False

    @property
    def state(self) -> CircuitState:
        return self._state

    def before_call(self, now_ms: float | None = None) -> None:
        now = self._now(now_ms)
        if self._state is CircuitState.OPEN:
            assert self._opened_at_ms is not None
            if now - self._opened_at_ms < self.reset_timeout_ms:
                raise CircuitOpenError(self._opened_at_ms + self.reset_timeout_ms)
            self._state = CircuitState.HALF_OPEN
            self._half_open_probe = False
        if self._state is CircuitState.HALF_OPEN:
            if self._half_open_probe:
                raise CircuitOpenError(now + self.reset_timeout_ms)
            self._half_open_probe = True

    def record_success(self) -> None:
        self._state = CircuitState.CLOSED
        self._failures = 0
        self._opened_at_ms = None
        self._half_open_probe = False

    def record_failure(self, now_ms: float | None = None) -> None:
        self._failures += 1
        if self._state is CircuitState.HALF_OPEN or self._failures >= self.failure_threshold:
            self._state = CircuitState.OPEN
            self._opened_at_ms = self._now(now_ms)
            self._half_open_probe = False

    def _now(self, now_ms: float | None) -> float:
        return float(self._clock() if now_ms is None else now_ms)


__all__ = ["CircuitBreaker", "CircuitOpenError", "CircuitState"]
