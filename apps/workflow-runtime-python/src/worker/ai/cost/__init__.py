"""Provider-neutral deterministic model cost calculations."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ModelPricing:
    prompt_usd_per_1k: float = 0.0
    completion_usd_per_1k: float = 0.0

    def __post_init__(self) -> None:
        if self.prompt_usd_per_1k < 0 or self.completion_usd_per_1k < 0:
            raise ValueError("Model pricing cannot be negative")


def calculate_cost(
    prompt_tokens: int,
    completion_tokens: int,
    pricing: ModelPricing,
) -> float:
    if prompt_tokens < 0 or completion_tokens < 0:
        raise ValueError("Token counts cannot be negative")
    return round(
        prompt_tokens / 1000 * pricing.prompt_usd_per_1k
        + completion_tokens / 1000 * pricing.completion_usd_per_1k,
        8,
    )


__all__ = ["ModelPricing", "calculate_cost"]
