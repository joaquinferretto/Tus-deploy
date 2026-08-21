export const TELEMETRY_CHANNEL = 'factory.telemetry.v1' as const

export type TelemetryLevel = 'debug' | 'info' | 'warn' | 'error'

export interface TelemetryContext {
  correlationId?: string
  traceId?: string
  tenantId?: string
  actorId?: string
  requestId?: string
}

export interface TelemetryEvent extends TelemetryContext {
  name: string
  level: TelemetryLevel
  timestamp: string
  attributes?: Record<string, string | number | boolean>
}

export interface LoggerPort {
  emit(event: TelemetryEvent): void
}

export interface MetricPort {
  increment(name: string, value?: number, attributes?: Record<string, string>): void
}

export interface SpanPort {
  setStatus(status: 'ok' | 'error', message?: string): void
  end(): void
}

export interface TracerPort {
  startSpan(name: string, context?: TelemetryContext): SpanPort
}

export interface RuntimeTelemetry {
  logger: LoggerPort
  metrics: MetricPort
  tracer: TracerPort
}

export interface TelemetryEnvelope {
  channel: typeof TELEMETRY_CHANNEL
  event: TelemetryEvent
}

export class InMemoryLogger implements LoggerPort {
  readonly events: TelemetryEvent[] = []
  emit(event: TelemetryEvent): void { this.events.push(event) }
}

export class InMemoryMetrics implements MetricPort {
  readonly values = new Map<string, number>()
  increment(name: string, value = 1): void { this.values.set(name, (this.values.get(name) ?? 0) + value) }
}

export function createInMemoryTelemetry(): RuntimeTelemetry & { logs: TelemetryEvent[] } {
  const logger = new InMemoryLogger()
  return {
    logger,
    logs: logger.events,
    metrics: new InMemoryMetrics(),
    tracer: { startSpan: () => ({ setStatus: () => undefined, end: () => undefined }) },
  }
}

export function createContextMiddleware(options: { telemetry: RuntimeTelemetry }) {
  return (request: { headers?: Record<string, string | undefined> }, response: { setHeader: (name: string, value: string) => void }, next: (context: TelemetryContext) => void) => {
    const headers = request.headers ?? {}
    const correlationId = headers['x-correlation-id'] ?? `corr-${Date.now()}`
    const context: TelemetryContext = { correlationId, requestId: headers['x-request-id'] }
    response.setHeader('x-correlation-id', correlationId)
    options.telemetry.logger.emit({ name: 'request.context', level: 'info', timestamp: new Date().toISOString(), ...context })
    next(context)
  }
}

export function createRuntimeTelemetry(logger: LoggerPort = new InMemoryLogger()): RuntimeTelemetry {
  return { logger, metrics: new InMemoryMetrics(), tracer: { startSpan: () => ({ setStatus: () => undefined, end: () => undefined }) } }
}

export function logEvent(telemetry: RuntimeTelemetry, name: string, level: TelemetryLevel, context: TelemetryContext = {}, attributes: Record<string, string | number | boolean> = {}): void {
  telemetry.logger.emit({ name, level, timestamp: new Date().toISOString(), ...safeContext(context), attributes })
}

export function toTelemetryEnvelope(event: TelemetryEvent): TelemetryEnvelope {
  return { channel: TELEMETRY_CHANNEL, event: { ...event, ...safeContext(event) } }
}

function safeContext(context: TelemetryContext): TelemetryContext {
  return Object.fromEntries(Object.entries(context).filter(([key]) => ['correlationId', 'traceId', 'tenantId', 'actorId', 'requestId'].includes(key)))
}
