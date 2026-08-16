from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator

from langchain_core.callbacks import BaseCallbackHandler
from langsmith import Client
from pythonjsonlogger.json import JsonFormatter

from worker.core.config import RuntimeSettings, get_settings


class WorkerTraceCallback(BaseCallbackHandler):
    """Thin callback bridge for graph runs and tool errors."""

    def __init__(self, logger: logging.Logger) -> None:
        self.logger = logger

    def on_chain_start(self, serialized: dict[str, Any], inputs: dict[str, Any], **_: Any) -> None:
        self.logger.info("chain.start", extra={"serialized": serialized, "inputs": inputs})

    def on_chain_error(self, error: BaseException, **_: Any) -> None:
        self.logger.exception("chain.error", extra={"error": str(error)})

    def on_tool_error(self, error: BaseException, **_: Any) -> None:
        self.logger.exception("tool.error", extra={"error": str(error)})


def build_logger(settings: RuntimeSettings | None = None) -> logging.Logger:
    settings = settings or get_settings()
    logger = logging.getLogger(settings.service_name)
    if logger.handlers:
        return logger
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(settings.log_level.upper())
    logger.propagate = False
    return logger


def create_langsmith_client(settings: RuntimeSettings | None = None) -> Client | None:
    settings = settings or get_settings()
    if not settings.langsmith_api_key:
        return None
    return Client(api_key=settings.langsmith_api_key, api_url=str(settings.langsmith_endpoint))


def build_callbacks(settings: RuntimeSettings | None = None) -> list[BaseCallbackHandler]:
    logger = build_logger(settings)
    return [WorkerTraceCallback(logger)]


@contextmanager
def traced_operation(name: str, metadata: dict[str, Any] | None = None) -> Iterator[dict[str, Any]]:
    settings = get_settings()
    logger = build_logger(settings)
    client = create_langsmith_client(settings)
    metadata = metadata or {}
    logger.info("operation.start", extra={"operation": name, "metadata": metadata})
    run = None
    if client is not None:
        run = client.create_run(name=name, run_type="chain", project_name=settings.langsmith_project, inputs=metadata)
    try:
        yield {"callbacks": build_callbacks(settings), "run_id": getattr(run, "id", None)}
        if client is not None and run is not None:
            client.update_run(run.id, outputs={"status": "ok"}, end_time=None)
    except Exception as exc:
        logger.exception("operation.failed", extra={"operation": name, "metadata": metadata})
        if client is not None and run is not None:
            client.update_run(run.id, error=str(exc), outputs={"status": "failed"}, end_time=None)
        raise
