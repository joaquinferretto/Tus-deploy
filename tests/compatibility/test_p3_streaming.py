import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.streaming import (
    InMemoryStreamRuntime,
    StreamAuthorizationError,
    StreamBackpressureError,
    StreamContractError,
    StreamCursorError,
    StreamProviderUnavailableError,
    UnavailableStreamRuntime,
)


def context(**overrides: object) -> dict[str, object]:
    return {
        "stream_id": "stream-1",
        "run_id": "run-1",
        "tenant_id": "tenant-a",
        "actor_id": "actor-1",
        "correlation_id": "correlation-1",
        **overrides,
    }


def test_stream_contracts_propagate_context_and_resume_in_sequence_order():
    runtime = InMemoryStreamRuntime()
    runtime.create_stream(**context())
    runtime.publish(**context(), kind="token", status="partial", payload={"text": "Hel"})
    runtime.publish(**context(), kind="audio", status="partial", payload={"chunk": "YQ=="})
    runtime.publish(**context(), kind="progress", status="progress", payload={"percent": 50})
    runtime.publish(**context(), kind="event", status="completed", payload={"output": "Hello"})

    connection = runtime.connect(**context(), max_in_flight=2)
    batch = runtime.poll(**context(), connection_id=connection.connection_id)
    assert [frame["kind"] for frame in batch.frames] == ["token", "audio"]
    assert [frame["sequence"] for frame in batch.frames] == [1, 2]
    assert batch.frames[0]["cursor"] == "stream-1:1"
    assert batch.frames[0]["tenantId"] == "tenant-a"
    assert batch.frames[0]["actorId"] == "actor-1"
    assert batch.frames[0]["correlationId"] == "correlation-1"
    runtime.ack(**context(), connection_id=connection.connection_id, cursor="stream-1:2")

    reconnect = runtime.connect(**context(), cursor="stream-1:2", max_in_flight=4)
    resumed = runtime.poll(**context(), connection_id=reconnect.connection_id)
    assert [frame["sequence"] for frame in resumed.frames] == [3, 4]
    assert resumed.status == "completed"


def test_backpressure_is_bounded_until_acknowledgement():
    runtime = InMemoryStreamRuntime()
    runtime.create_stream(**context(), max_buffer=2)
    runtime.publish(**context(), kind="token", status="partial", payload={"text": "a"})
    runtime.publish(**context(), kind="token", status="partial", payload={"text": "b"})
    connection = runtime.connect(**context(), max_in_flight=1)
    runtime.publish(**context(), kind="token", status="partial", payload={"text": "c"})
    with pytest.raises(StreamBackpressureError):
        runtime.poll(**context(), connection_id=connection.connection_id)
    runtime.ack(**context(), connection_id=connection.connection_id, cursor="stream-1:1")
    assert runtime.poll(**context(), connection_id=connection.connection_id).frames[0]["sequence"] == 2


def test_authorization_cursor_and_cancellation_are_enforced():
    runtime = InMemoryStreamRuntime()
    runtime.create_stream(**context(), partial_result_policy="discard-on-cancel")
    runtime.publish(**context(), kind="token", status="partial", payload={"text": "draft"})
    with pytest.raises(StreamAuthorizationError):
        runtime.connect(**context(actor_id="actor-2"), max_in_flight=2)
    connection = runtime.connect(**context(), max_in_flight=2)
    runtime.cancel(**context(), connection_id=connection.connection_id, reason="user requested")
    cancelled = runtime.poll(**context(), connection_id=connection.connection_id)
    assert [frame["status"] for frame in cancelled.frames] == ["cancelled"]
    assert cancelled.frames[0]["payload"]["reason"] == "user requested"
    with pytest.raises(StreamCursorError):
        runtime.connect(**context(), cursor="other-stream:1", max_in_flight=2)


def test_partial_result_policy_holds_until_completion_and_discards_on_cancel():
    held = InMemoryStreamRuntime()
    held.create_stream(**context(), partial_result_policy="hold-until-complete")
    held.publish(**context(), kind="token", status="partial", payload={"text": "hidden"})
    connection = held.connect(**context(), max_in_flight=2)
    assert held.poll(**context(), connection_id=connection.connection_id).frames == []
    held.publish(**context(), kind="event", status="completed", payload={"output": "final"})
    assert [frame["payload"] for frame in held.poll(**context(), connection_id=connection.connection_id).frames] == [
        {"text": "hidden"},
        {"output": "final"},
    ]

    discarded = InMemoryStreamRuntime()
    discarded.create_stream(**context(), partial_result_policy="discard-on-cancel")
    discarded.publish(**context(), kind="audio", status="partial", payload={"chunk": "discard-me"})
    discarded_connection = discarded.connect(**context(), max_in_flight=2)
    discarded.cancel(**context(), connection_id=discarded_connection.connection_id, reason="stop")
    result = discarded.poll(**context(), connection_id=discarded_connection.connection_id)
    assert [frame["status"] for frame in result.frames] == ["cancelled"]


def test_invalid_contract_kind_is_rejected_by_runtime_fake():
    runtime = InMemoryStreamRuntime()
    runtime.create_stream(**context())
    with pytest.raises(StreamContractError):
        runtime.publish(**context(), kind="unknown", status="partial", payload={"value": 1})


def test_live_stream_runtime_is_explicitly_unavailable():
    with pytest.raises(StreamProviderUnavailableError):
        UnavailableStreamRuntime().connect()
