from __future__ import annotations

from typing import Any

from langgraph.checkpoint.memory import MemorySaver

from worker.core.config import RuntimeSettings, get_settings


async def build_checkpointer(settings: RuntimeSettings | None = None) -> Any:
    """Provision a durable LangGraph checkpointer with sane fallbacks."""

    settings = settings or get_settings()
    backend = settings.checkpoint_backend.lower()

    if backend == "postgres":
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        saver = AsyncPostgresSaver.from_conn_string(settings.postgres_dsn)
        await saver.setup()
        return saver

    if backend == "redis":
        from langgraph.checkpoint.redis.aio import AsyncRedisSaver

        saver = AsyncRedisSaver.from_conn_string(settings.redis_url)
        await saver.asetup()
        return saver

    return MemorySaver()


async def close_checkpointer(checkpointer: Any) -> None:
    close_method = getattr(checkpointer, "aclose", None)
    if callable(close_method):
        await close_method()
