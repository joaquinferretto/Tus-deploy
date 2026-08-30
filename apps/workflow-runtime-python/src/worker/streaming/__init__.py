"""Deterministic, provider-free stream runtime for token/audio/event/progress output."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

STREAM_CONTRACT_VERSION = "1.0.0"
STREAM_KINDS = frozenset({"token", "audio", "event", "progress"})
STREAM_STATUSES = frozenset({"partial", "progress", "completed", "failed", "cancelled"})
PARTIAL_POLICIES = frozenset({"emit-partial", "hold-until-complete", "discard-on-cancel"})
TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})


class StreamContractError(ValueError):
    """Raised when a stream frame or control value violates the contract."""


class StreamAuthorizationError(PermissionError):
    """Raised when tenant, actor, or correlation context does not match."""


class StreamCursorError(ValueError):
    """Raised when a cursor is malformed, expired, or from another stream."""


class StreamBackpressureError(RuntimeError):
    """Raised when an unacknowledged delivery window or retention bound is full."""


class StreamProviderUnavailableError(RuntimeError):
    """Raised by the explicit unavailable provider adapter."""


@dataclass(frozen=True)
class StreamConnection:
    connection_id: str
    stream_id: str
    cursor: str | None


@dataclass(frozen=True)
class StreamBatch:
    status: str
    frames: list[dict[str, object]]


@dataclass
class _ConnectionState:
    connection_id: str
    stream_id: str
    acked_sequence: int
    delivered_sequence: int
    max_in_flight: int


@dataclass
class _StreamState:
    stream_id: str
    run_id: str
    tenant_id: str
    actor_id: str
    correlation_id: str
    partial_result_policy: str
    max_buffer: int
    frames: list[dict[str, object]]
    next_sequence: int = 1
    terminal: bool = False


class InMemoryStreamRuntime:
    def __init__(self) -> None:
        self._streams: dict[str, _StreamState] = {}
        self._connections: dict[str, _ConnectionState] = {}
        self._connection_number = 0

    def create_stream(
        self,
        *,
        stream_id: str,
        run_id: str,
        tenant_id: str,
        actor_id: str,
        correlation_id: str,
        partial_result_policy: str = "emit-partial",
        max_buffer: int = 100,
    ) -> None:
        if stream_id in self._streams:
            return
        if not all(isinstance(value, str) and value.strip() for value in (stream_id, run_id, tenant_id, actor_id, correlation_id)):
            raise StreamContractError("stream identity is required")
        if partial_result_policy not in PARTIAL_POLICIES:
            raise StreamContractError("unsupported partial-result policy")
        if not isinstance(max_buffer, int) or max_buffer < 1:
            raise StreamContractError("max_buffer must be positive")
        self._streams[stream_id] = _StreamState(
            stream_id=stream_id,
            run_id=run_id,
            tenant_id=tenant_id,
            actor_id=actor_id,
            correlation_id=correlation_id,
            partial_result_policy=partial_result_policy,
            max_buffer=max_buffer,
            frames=[],
        )

    def publish(
        self,
        *,
        stream_id: str,
        run_id: str,
        tenant_id: str,
        actor_id: str,
        correlation_id: str,
        kind: str,
        status: str,
        payload: Mapping[str, object],
    ) -> dict[str, object]:
        stream = self._authorized_stream(stream_id, run_id, tenant_id, actor_id, correlation_id)
        if stream.terminal:
            raise StreamContractError("stream is already terminal")
        frame = self._create_frame(stream, kind, status, payload)
        stream.frames.append(frame)
        if status in TERMINAL_STATUSES:
            stream.terminal = True
        return dict(frame)

    def connect(
        self,
        *,
        stream_id: str,
        run_id: str,
        tenant_id: str,
        actor_id: str,
        correlation_id: str,
        max_in_flight: int,
        cursor: str | None = None,
    ) -> StreamConnection:
        stream = self._authorized_stream(stream_id, run_id, tenant_id, actor_id, correlation_id)
        if not isinstance(max_in_flight, int) or max_in_flight < 1:
            raise StreamContractError("max_in_flight must be positive")
        sequence = self._parse_cursor(stream, cursor)[1] if cursor else 0
        self._assert_cursor_retained(stream, sequence)
        self._connection_number += 1
        connection_id = f"connection-{stream_id}-{self._connection_number}"
        self._connections[connection_id] = _ConnectionState(connection_id, stream_id, sequence, sequence, max_in_flight)
        return StreamConnection(connection_id, stream_id, cursor)

    def poll(
        self,
        *,
        stream_id: str,
        run_id: str,
        tenant_id: str,
        actor_id: str,
        correlation_id: str,
        connection_id: str,
    ) -> StreamBatch:
        stream = self._authorized_stream(stream_id, run_id, tenant_id, actor_id, correlation_id)
        connection = self._authorized_connection(connection_id, stream_id)
        self._prune_acknowledged(stream)
        self._assert_cursor_retained(stream, connection.acked_sequence)
        if len(stream.frames) > stream.max_buffer and connection.acked_sequence < self._first_sequence(stream):
            raise StreamBackpressureError("stream retention bound is exhausted")
        in_flight = connection.delivered_sequence - connection.acked_sequence
        if in_flight >= connection.max_in_flight:
            raise StreamBackpressureError("stream delivery window is exhausted")
        visible = self._visible_frames(stream)
        available = [frame for frame in visible if int(frame["sequence"]) > connection.delivered_sequence]
        if not available:
            return StreamBatch(self._terminal_status(stream) if stream.terminal else "open", [])
        frames = available[: connection.max_in_flight - in_flight]
        connection.delivered_sequence = int(frames[-1]["sequence"])
        status = str(frames[-1]["status"]) if str(frames[-1]["status"]) in TERMINAL_STATUSES else "open"
        return StreamBatch(status, [dict(frame) for frame in frames])

    def ack(
        self,
        *,
        stream_id: str,
        run_id: str,
        tenant_id: str,
        actor_id: str,
        correlation_id: str,
        connection_id: str,
        cursor: str,
    ) -> None:
        self._authorized_stream(stream_id, run_id, tenant_id, actor_id, correlation_id)
        stream = self._streams[stream_id]
        connection = self._authorized_connection(connection_id, stream_id)
        _, sequence = self._parse_cursor(stream, cursor)
        if sequence > stream.next_sequence - 1 or sequence < connection.acked_sequence:
            raise StreamCursorError("acknowledgement cursor is outside the delivered window")
        connection.delivered_sequence = max(connection.delivered_sequence, sequence)
        connection.acked_sequence = sequence
        self._prune_acknowledged(stream)

    def cancel(
        self,
        *,
        stream_id: str,
        run_id: str,
        tenant_id: str,
        actor_id: str,
        correlation_id: str,
        connection_id: str,
        reason: str,
    ) -> dict[str, object]:
        stream = self._authorized_stream(stream_id, run_id, tenant_id, actor_id, correlation_id)
        connection = self._authorized_connection(connection_id, stream_id)
        if not reason.strip():
            raise StreamContractError("stream cancellation reason is required")
        if stream.terminal:
            for frame in reversed(stream.frames):
                if frame["status"] == "cancelled":
                    return dict(frame)
            raise StreamContractError("stream is already terminal")
        if stream.partial_result_policy == "discard-on-cancel":
            stream.frames = [frame for frame in stream.frames if frame["status"] != "partial"]
        frame = self._create_frame(stream, "event", "cancelled", {"reason": reason})
        stream.frames.append(frame)
        stream.terminal = True
        connection.delivered_sequence = max(connection.delivered_sequence, int(frame["sequence"]) - 1)
        return dict(frame)

    def _authorized_stream(self, stream_id: str, run_id: str, tenant_id: str, actor_id: str, correlation_id: str) -> _StreamState:
        stream = self._streams.get(stream_id)
        if stream is None or (stream.run_id, stream.tenant_id, stream.actor_id, stream.correlation_id) != (run_id, tenant_id, actor_id, correlation_id):
            raise StreamAuthorizationError("stream context is not authorized")
        return stream

    def _authorized_connection(self, connection_id: str, stream_id: str) -> _ConnectionState:
        connection = self._connections.get(connection_id)
        if connection is None or connection.stream_id != stream_id:
            raise StreamAuthorizationError("stream connection is not authorized")
        return connection

    def _create_frame(self, stream: _StreamState, kind: str, status: str, payload: Mapping[str, object]) -> dict[str, object]:
        if kind not in STREAM_KINDS or status not in STREAM_STATUSES or not isinstance(payload, Mapping):
            raise StreamContractError("invalid stream frame")
        sequence = stream.next_sequence
        stream.next_sequence += 1
        frame: dict[str, object] = {
            "contractVersion": STREAM_CONTRACT_VERSION,
            "streamId": stream.stream_id,
            "runId": stream.run_id,
            "tenantId": stream.tenant_id,
            "actorId": stream.actor_id,
            "correlationId": stream.correlation_id,
            "sequence": sequence,
            "cursor": f"{stream.stream_id}:{sequence}",
            "kind": kind,
            "status": status,
            "payload": dict(payload),
            "emittedAt": "2026-01-01T00:00:00.000Z",
        }
        self._validate_frame(frame)
        return frame

    @staticmethod
    def _validate_frame(frame: Mapping[str, object]) -> None:
        required = ("contractVersion", "streamId", "runId", "tenantId", "actorId", "correlationId", "cursor", "emittedAt")
        if any(not isinstance(frame.get(field), str) or not str(frame[field]).strip() for field in required):
            raise StreamContractError("stream frame context is required")
        if frame.get("contractVersion") != STREAM_CONTRACT_VERSION or frame.get("kind") not in STREAM_KINDS or frame.get("status") not in STREAM_STATUSES:
            raise StreamContractError("stream frame contract value is unsupported")
        if not isinstance(frame.get("sequence"), int) or isinstance(frame.get("sequence"), bool) or int(frame["sequence"]) < 1:
            raise StreamContractError("stream frame sequence is invalid")
        if frame.get("cursor") != f"{frame['streamId']}:{frame['sequence']}":
            raise StreamContractError("stream frame cursor does not match sequence")
        if not isinstance(frame.get("payload"), Mapping):
            raise StreamContractError("stream frame payload is invalid")

    def _parse_cursor(self, stream: _StreamState, cursor: str) -> tuple[str, int]:
        parts = cursor.rsplit(":", 1)
        if len(parts) != 2 or parts[0] != stream.stream_id or not parts[1].isdigit() or int(parts[1]) < 1:
            raise StreamCursorError("invalid stream cursor")
        return parts[0], int(parts[1])

    @staticmethod
    def _first_sequence(stream: _StreamState) -> int:
        return int(stream.frames[0]["sequence"]) if stream.frames else stream.next_sequence

    def _assert_cursor_retained(self, stream: _StreamState, sequence: int) -> None:
        if (sequence != 0 and sequence < self._first_sequence(stream) - 1) or sequence > stream.next_sequence - 1:
            raise StreamCursorError("cursor is outside retained stream history")

    def _visible_frames(self, stream: _StreamState) -> list[dict[str, object]]:
        completed = stream.terminal and any(frame["status"] == "completed" for frame in stream.frames)
        if stream.partial_result_policy == "hold-until-complete" and not completed:
            return [frame for frame in stream.frames if frame["status"] != "partial"]
        return stream.frames

    def _prune_acknowledged(self, stream: _StreamState) -> None:
        connections = [connection for connection in self._connections.values() if connection.stream_id == stream.stream_id]
        if not connections:
            return
        acknowledged = min(connection.acked_sequence for connection in connections)
        if acknowledged > 0:
            stream.frames = [frame for frame in stream.frames if int(frame["sequence"]) > acknowledged]

    @staticmethod
    def _terminal_status(stream: _StreamState) -> str:
        for frame in reversed(stream.frames):
            if frame["status"] in TERMINAL_STATUSES:
                return str(frame["status"])
        return "completed"


class UnavailableStreamRuntime:
    def __getattr__(self, _name: str):
        def unavailable(*_args: object, **_kwargs: object) -> None:
            raise StreamProviderUnavailableError("websocket stream provider is unavailable; use a deterministic fake")

        return unavailable
