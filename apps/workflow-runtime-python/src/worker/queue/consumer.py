from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from redis.asyncio import Redis

from worker.core.config import get_settings
from worker.core.telemetry import build_logger, traced_operation
from worker.graph.base import build_graph


class WorkflowQueueConsumer:
    """Redis/BullMQ-compatible worker consuming JSON-encoded workflow jobs."""

    def __init__(self, queue_name: str = "workflow-jobs") -> None:
        self.settings = get_settings()
        self.logger = build_logger(self.settings)
        self.redis = Redis.from_url(self.settings.redis_url, decode_responses=True)
        schema_path = self.settings.resolved_contracts_root / "workflow-job.schema.json"
        self.validator = Draft202012Validator(json.loads(Path(schema_path).read_text(encoding="utf-8")))
        self.queue_name = f"bull:{queue_name}:wait"

    async def consume_forever(self, stop_event: asyncio.Event | None = None) -> None:
        stop_event = stop_event or asyncio.Event()
        while not stop_event.is_set():
            result = await self.redis.blpop(self.queue_name, timeout=1)
            if result is None:
                continue
            _, payload = result
            await self.handle_job(json.loads(payload))

    async def close(self) -> None:
        close = getattr(self.redis, "aclose", None)
        if close is None:
            close = getattr(self.redis, "close", None)
        if close is not None:
            result = close()
            if asyncio.iscoroutine(result):
                await result

    async def handle_job(self, job: dict[str, Any]) -> dict[str, Any]:
        self.validator.validate(job)
        with traced_operation("workflow-job.process", {"jobId": job["jobId"], "workflowId": job["workflowId"]}):
            graph = await build_graph()
            state = {
                "job": job,
                "messages": [],
                "current_step": "plan",
                "output": {},
                "updated_at": job["createdAt"],
            }
            result = await graph.ainvoke(state, config={"configurable": {"thread_id": job["runId"]}})
            await self.redis.hset(f"bull:workflow-jobs:results", job["jobId"], json.dumps(result))
            self.logger.info("job.completed", extra={"job_id": job["jobId"], "run_id": job["runId"]})
            return result


async def main() -> None:
    await WorkflowQueueConsumer().consume_forever()


if __name__ == "__main__":
    asyncio.run(main())
