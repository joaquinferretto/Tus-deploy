import asyncio
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.lifecycle import (  # noqa: E402
    LifecycleState,
    WorkerLifecycle,
    WorkerShutdownError,
)


def test_worker_lifecycle_stops_in_reverse_resource_order_and_is_idempotent():
    async def scenario():
        events = []
        lifecycle = WorkerLifecycle(shutdown_timeout=1, on_event=events.append)
        lifecycle.register("database", lambda: events.append("database-closed"))
        lifecycle.register("queue", lambda: events.append("queue-closed"))
        lifecycle.start()

        await lifecycle.shutdown("signal")
        await lifecycle.shutdown("duplicate")

        assert lifecycle.state is LifecycleState.STOPPED
        assert events == [
            "started",
            "stopping:signal",
            "queue-closed",
            "closed:queue",
            "database-closed",
            "closed:database",
            "stopped",
        ]

    asyncio.run(scenario())


def test_worker_loop_exits_after_stop_request():
    async def scenario():
        lifecycle = WorkerLifecycle(shutdown_timeout=1)
        lifecycle.start()
        calls = 0

        async def step():
            nonlocal calls
            calls += 1
            lifecycle.request_stop("drained")

        await lifecycle.run(step)
        assert calls == 1
        assert lifecycle.stop_reason == "drained"
        await lifecycle.shutdown("drained")

    asyncio.run(scenario())


def test_worker_shutdown_timeout_stops_state_and_reports_failure():
    async def scenario():
        lifecycle = WorkerLifecycle(shutdown_timeout=0.001)
        lifecycle.start()

        async def hangs():
            await asyncio.sleep(1)

        lifecycle.register("queue", hangs)
        with pytest.raises(WorkerShutdownError, match="shutdown timeout"):
            await lifecycle.shutdown("timeout")
        assert lifecycle.state is LifecycleState.STOPPED

    asyncio.run(scenario())
