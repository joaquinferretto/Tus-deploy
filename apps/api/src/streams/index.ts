import {
  createStreamCursor,
  parseStreamCursor,
  STREAM_CONTRACT_VERSION,
  STREAM_FRAME_STATUS,
  STREAM_KIND,
  STREAM_PARTIAL_RESULT_POLICY,
  validateStreamFrame,
  type StreamAckRequest,
  type StreamConnectRequest,
  type StreamConnection,
  type StreamContext,
  type StreamCreateInput,
  type StreamFrame,
  type StreamFrameInput,
  type StreamCancelRequest,
  type StreamPollRequest,
  type StreamPollResult,
} from '@factory/contracts/streams'

export {
  STREAM_CONTRACT_VERSION,
  STREAM_FRAME_STATUS,
  STREAM_KIND,
  STREAM_PARTIAL_RESULT_POLICY,
  validateStreamFrame,
}

export class StreamAuthorizationError extends Error {
  constructor() {
    super('Stream context is not authorized')
    this.name = 'StreamAuthorizationError'
  }
}

export class StreamCursorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamCursorError'
  }
}

export class StreamBackpressureError extends Error {
  constructor() {
    super('Stream backpressure window or retention bound is exhausted')
    this.name = 'StreamBackpressureError'
  }
}

export class StreamClosedError extends Error {
  constructor() {
    super('Stream is already terminal')
    this.name = 'StreamClosedError'
  }
}

export class StreamProviderUnavailableError extends Error {
  readonly code = 'STREAM_PROVIDER_UNAVAILABLE'

  constructor(provider = 'websocket') {
    super(`${provider} stream provider is unavailable; use a deterministic fake`)
    this.name = 'StreamProviderUnavailableError'
  }
}

interface StoredStream {
  input: StreamCreateInput
  frames: StreamFrame[]
  terminal: boolean
  nextSequence: number
}

interface StoredConnection extends StreamConnection {
  streamId: string
  ackedSequence: number
  deliveredSequence: number
  maxInFlight: number
}

export class InMemoryStreamTransport {
  private readonly streams = new Map<string, StoredStream>()
  private readonly connections = new Map<string, StoredConnection>()
  private connectionNumber = 0

  createStream(input: StreamCreateInput): void {
    if (this.streams.has(input.streamId)) return
    if (!input.streamId.trim() || !input.runId.trim() || !input.tenantId.trim()) {
      throw new Error('Stream identity is required')
    }
    if (!Object.values(STREAM_PARTIAL_RESULT_POLICY).includes(input.partialResultPolicy)) {
      throw new Error('Unsupported partial-result policy')
    }
    if (
      input.maxBuffer !== undefined &&
      (!Number.isInteger(input.maxBuffer) || input.maxBuffer < 1)
    ) {
      throw new Error('Stream maxBuffer must be positive')
    }
    this.streams.set(input.streamId, {
      input: structuredClone(input),
      frames: [],
      terminal: false,
      nextSequence: 1,
    })
  }

  publish(context: StreamContext, input: StreamFrameInput): StreamFrame {
    const stream = this.authorizedStream(context)
    if (stream.terminal) throw new StreamClosedError()
    this.pruneAcknowledged(stream)
    const frame = this.createFrame(stream, input)
    stream.frames.push(frame)
    if (isTerminalStatus(input.status)) stream.terminal = true
    return structuredClone(frame)
  }

  connect(request: StreamConnectRequest): StreamConnection {
    const stream = this.authorizedStream(request)
    const cursor = request.cursor ? this.parseCursor(stream, request.cursor) : null
    assertPositiveInteger(request.maxInFlight, 'maxInFlight')
    const sequence = cursor?.sequence ?? 0
    this.assertCursorRetained(stream, sequence)
    const connectionId = `connection-${stream.input.streamId}-${++this.connectionNumber}`
    this.connections.set(connectionId, {
      connectionId,
      streamId: stream.input.streamId,
      cursor: request.cursor ?? null,
      ackedSequence: sequence,
      deliveredSequence: sequence,
      maxInFlight: request.maxInFlight,
    })
    return { connectionId, streamId: stream.input.streamId, cursor: request.cursor ?? null }
  }

  poll(request: StreamPollRequest): StreamPollResult {
    const stream = this.authorizedStream(request)
    const connection = this.authorizedConnection(request)
    this.pruneAcknowledged(stream)
    this.assertCursorRetained(stream, connection.ackedSequence)
    if (
      stream.frames.length > this.maxBuffer(stream) &&
      connection.ackedSequence < this.firstSequence(stream)
    ) {
      throw new StreamBackpressureError()
    }
    const inFlight = connection.deliveredSequence - connection.ackedSequence
    if (inFlight >= connection.maxInFlight) throw new StreamBackpressureError()
    const visible = this.visibleFrames(stream)
    const available = visible.filter((frame) => frame.sequence > connection.deliveredSequence)
    if (available.length === 0)
      return { status: stream.terminal ? terminalStatus(stream) : 'open', frames: [] }
    const frames = available.slice(0, connection.maxInFlight - inFlight)
    const lastFrame = frames.at(-1)
    if (!lastFrame) throw new StreamBackpressureError()
    connection.deliveredSequence = lastFrame.sequence
    connection.cursor = lastFrame.cursor
    const status = toPollStatus(lastFrame.status)
    return { status, frames: frames.map((frame) => structuredClone(frame)) }
  }

  ack(request: StreamAckRequest): void {
    const stream = this.authorizedStream(request)
    const connection = this.authorizedConnection(request)
    const cursor = this.parseCursor(stream, request.cursor)
    if (cursor.sequence > stream.nextSequence - 1 || cursor.sequence < connection.ackedSequence) {
      throw new StreamCursorError('Acknowledgement cursor is outside the delivered window')
    }
    connection.deliveredSequence = Math.max(connection.deliveredSequence, cursor.sequence)
    connection.ackedSequence = cursor.sequence
    connection.cursor = request.cursor
    this.pruneAcknowledged(stream)
  }

  cancel(request: StreamCancelRequest): StreamFrame {
    const stream = this.authorizedStream(request)
    const connection = this.authorizedConnection(request)
    if (!request.reason.trim()) throw new Error('Stream cancellation reason is required')
    if (stream.terminal) {
      const terminal = stream.frames.find((frame) => frame.status === STREAM_FRAME_STATUS.CANCELLED)
      if (terminal) return structuredClone(terminal)
      throw new StreamClosedError()
    }
    if (stream.input.partialResultPolicy === STREAM_PARTIAL_RESULT_POLICY.DISCARD_ON_CANCEL) {
      stream.frames = stream.frames.filter((frame) => frame.status !== STREAM_FRAME_STATUS.PARTIAL)
      this.pruneAcknowledged(stream)
    }
    const frame = this.createFrame(stream, {
      kind: STREAM_KIND.EVENT,
      status: STREAM_FRAME_STATUS.CANCELLED,
      payload: { reason: request.reason },
    })
    stream.frames.push(frame)
    stream.terminal = true
    connection.deliveredSequence = Math.max(connection.deliveredSequence, frame.sequence - 1)
    return structuredClone(frame)
  }

  private authorizedStream(context: StreamContext): StoredStream {
    const stream = this.streams.get(context.streamId)
    if (
      !stream ||
      stream.input.tenantId !== context.tenantId ||
      stream.input.actorId !== context.actorId ||
      stream.input.correlationId !== context.correlationId
    ) {
      throw new StreamAuthorizationError()
    }
    return stream
  }

  private authorizedConnection(
    context: StreamContext & { connectionId: string }
  ): StoredConnection {
    const connection = this.connections.get(context.connectionId)
    if (!connection || connection.streamId !== context.streamId)
      throw new StreamAuthorizationError()
    return connection
  }

  private createFrame(stream: StoredStream, input: StreamFrameInput): StreamFrame {
    const frame: StreamFrame = {
      contractVersion: STREAM_CONTRACT_VERSION,
      streamId: stream.input.streamId,
      runId: stream.input.runId,
      tenantId: stream.input.tenantId,
      actorId: stream.input.actorId,
      correlationId: stream.input.correlationId,
      sequence: stream.nextSequence++,
      cursor: createStreamCursor(stream.input.streamId, stream.nextSequence - 1),
      kind: input.kind,
      status: input.status,
      payload: structuredClone(input.payload),
      emittedAt: '2026-01-01T00:00:00.000Z',
    }
    validateStreamFrame(frame)
    return frame
  }

  private parseCursor(
    stream: StoredStream,
    cursor: string
  ): { streamId: string; sequence: number } {
    let parsed: { streamId: string; sequence: number }
    try {
      parsed = parseStreamCursor(cursor)
    } catch {
      throw new StreamCursorError('Invalid stream cursor')
    }
    if (parsed.streamId !== stream.input.streamId)
      throw new StreamCursorError('Cursor belongs to another stream')
    return parsed
  }

  private assertCursorRetained(stream: StoredStream, sequence: number): void {
    const first = this.firstSequence(stream)
    const last = stream.nextSequence - 1
    if ((sequence !== 0 && sequence < first - 1) || sequence > last) {
      throw new StreamCursorError('Cursor is outside retained stream history')
    }
  }

  private visibleFrames(stream: StoredStream): StreamFrame[] {
    const completed =
      stream.terminal &&
      stream.frames.some((frame) => frame.status === STREAM_FRAME_STATUS.COMPLETED)
    if (
      stream.input.partialResultPolicy === STREAM_PARTIAL_RESULT_POLICY.HOLD_UNTIL_COMPLETE &&
      !completed
    ) {
      return stream.frames.filter((frame) => frame.status !== STREAM_FRAME_STATUS.PARTIAL)
    }
    return stream.frames
  }

  private pruneAcknowledged(stream: StoredStream): void {
    const connections = [...this.connections.values()].filter(
      (connection) => connection.streamId === stream.input.streamId
    )
    if (connections.length === 0) return
    const acknowledged = Math.min(...connections.map((connection) => connection.ackedSequence))
    if (acknowledged > 0)
      stream.frames = stream.frames.filter((frame) => frame.sequence > acknowledged)
  }

  private maxBuffer(stream: StoredStream): number {
    return stream.input.maxBuffer ?? 100
  }

  private firstSequence(stream: StoredStream): number {
    return stream.frames[0]?.sequence ?? stream.nextSequence
  }
}

export class UnavailableStreamTransport {
  createStream(_input: StreamCreateInput): never {
    throw new StreamProviderUnavailableError()
  }

  publish(_context: StreamContext, _input: StreamFrameInput): never {
    throw new StreamProviderUnavailableError()
  }

  connect(_request: StreamConnectRequest): never {
    throw new StreamProviderUnavailableError()
  }

  poll(_request: StreamPollRequest): never {
    throw new StreamProviderUnavailableError()
  }

  ack(_request: StreamAckRequest): never {
    throw new StreamProviderUnavailableError()
  }

  cancel(_request: StreamCancelRequest): never {
    throw new StreamProviderUnavailableError()
  }
}

function terminalStatus(stream: StoredStream): 'completed' | 'failed' | 'cancelled' {
  const terminal = [...stream.frames].reverse().find((frame) => isTerminalStatus(frame.status))
  return terminal?.status === 'completed' ||
    terminal?.status === 'failed' ||
    terminal?.status === 'cancelled'
    ? terminal.status
    : 'completed'
}

function isTerminalStatus(status: string): status is 'completed' | 'failed' | 'cancelled' {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function toPollStatus(status: StreamFrame['status']): StreamPollResult['status'] {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status
  return 'open'
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`Stream ${field} must be positive`)
}

export default { InMemoryStreamTransport, UnavailableStreamTransport }
