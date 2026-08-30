from __future__ import annotations

from typing import Any

from worker.checkpoint import CheckpointUnavailableError, InMemoryCheckpointStore
from worker.core.config import RuntimeSettings, get_settings


async def build_checkpointer(settings: RuntimeSettings | None = None) -> Any:
    """Return a deterministic local checkpointer or an explicit unavailable adapter error.

    PostgreSQL and Redis checkpoint stores are intentionally not contacted by P3.3.
    Their production wiring belongs to a later infrastructure-enabled slice.
    """

    settings = settings or get_settings()
    backend = settings.checkpoint_backend.lower()

    if backend in {"memory", "local", "fake"}:
        return InMemoryCheckpointStore()
    if backend in {"postgres", "postgresql", "redis"}:
        raise CheckpointUnavailableError(
            f"checkpoint backend {backend!r} is unavailable; no live adapter is enabled"
        )
    raise ValueError(f"Unsupported checkpoint backend {backend!r}")


async def close_checkpointer(checkpointer: Any) -> None:
    close_method = getattr(checkpointer, "aclose", None)
    if callable(close_method):
        await close_method()
