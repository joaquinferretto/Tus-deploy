"""Bounded retry primitives shared by provider-neutral AI adapters."""

from __future__ import annotations

from dataclasses import dataclass


class ProviderTimeoutError(TimeoutError):
    """A provider did not complete inside the configured timeout."""


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    max_attempts: int = 2

    def __post_init__(self) -> None:
        if not isinstance(self.max_attempts, int) or isinstance(self.max_attempts, bool):
            raise TypeError("max_attempts must be an integer")
        if not 1 <= self.max_attempts <= 5:
            raise ValueError("max_attempts must be between 1 and 5")


def failure_reason(error: BaseException) -> str:
    if isinstance(error, (ProviderTimeoutError, TimeoutError)):
        return "timeout"
    return "provider_error"


__all__ = ["ProviderTimeoutError", "RetryPolicy", "failure_reason"]
