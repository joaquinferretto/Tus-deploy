export const TELEMETRY_CHANNEL = 'factory.telemetry.v1' as const
export const OPERATIONS_EVIDENCE_SCHEMA = 'factory.operations.v1' as const

const TELEMETRY_LEVEL = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const

const SPAN_STATUS = {
  OK: 'ok',
  ERROR: 'error',
} as const

const EVIDENCE_KIND = {
  NATIVE_SMOKE: 'native-smoke',
  CLOUD_PLAN_VALIDATION: 'cloud-plan-validation',
  AUTHORIZED_CLOUD_SMOKE: 'authorized-cloud-smoke',
  UNAVAILABLE_DEFERRED: 'unavailable-deferred',
} as const

const EVIDENCE_STATUS = {
  PASS: 'pass',
  UNAVAILABLE: 'unavailable',
  DEFERRED: 'deferred',
  FAIL: 'fail',
} as const

const DELIVERY_PROFILE = {
  NATIVE: 'native',
  RENDER_NATIVE: 'render-native',
  AWS_TERRAFORM: 'aws-terraform',
} as const

const CONTROL_STATUS = {
  OK: 'ok',
  WARNING: 'warning',
  EXHAUSTED: 'exhausted',
} as const

type TelemetryLevel = (typeof TELEMETRY_LEVEL)[keyof typeof TELEMETRY_LEVEL]
type SpanStatus = (typeof SPAN_STATUS)[keyof typeof SPAN_STATUS]
type EvidenceKind = (typeof EVIDENCE_KIND)[keyof typeof EVIDENCE_KIND]
type EvidenceStatus = (typeof EVIDENCE_STATUS)[keyof typeof EVIDENCE_STATUS]
type DeliveryProfile = (typeof DELIVERY_PROFILE)[keyof typeof DELIVERY_PROFILE]
type ControlStatus = (typeof CONTROL_STATUS)[keyof typeof CONTROL_STATUS]

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
  setStatus(status: SpanStatus, message?: string): void
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

export interface TusOperationsTelemetryInput {
  name: string
  outcome: 'allowed' | 'denied' | 'success' | 'failure'
  correlationId: string
  tenantId?: string
  actorId?: string
  latencyMs: number
  attributes?: Record<string, string | number | boolean>
}

export interface TusOperationsTelemetry {
  record(input: TusOperationsTelemetryInput): void
}

export interface TelemetryEnvelope {
  channel: typeof TELEMETRY_CHANNEL
  event: TelemetryEvent
}

export interface TraceEvidence {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  status?: SpanStatus
  message?: string
  startedAt?: string
  endedAt?: string
  correlationId?: string
  tenantId?: string
  actorId?: string
  requestId?: string
}

export interface MetricEvidence {
  name: string
  value: number
  attributes: Record<string, string>
  timestamp?: string
}

export interface AuditInput {
  action: string
  outcome: string
  correlationId?: string
  traceId?: string
  tenantId?: string
  actorId?: string
  timestamp?: string
  details?: Record<string, unknown>
}

export interface AuditEvidence extends TelemetryContext {
  action: string
  outcome: string
  timestamp: string
  details: Record<string, unknown>
}

export interface SecurityFinding {
  source: string
  findingId: string
  severity: string
  status: string
  summary: string
}

export interface BudgetInput {
  name: string
  limit: number
  used: number
  warningAt: number
}

export interface BudgetEvidence {
  name: string
  limit: number
  used: number
  remaining: number
  status: ControlStatus
  alert: string | null
}

export interface QuotaInput {
  name: string
  limit: number
  used: number
  warningAt: number
}

export interface QuotaEvidence {
  name: string
  limit: number
  used: number
  remaining: number
  status: ControlStatus
  alert: string | null
}

export interface AlertEvidence {
  name: string
  status: string
  reason: string
}

export interface OperationalEvidenceInput {
  profile: DeliveryProfile
  evidenceKind: EvidenceKind
  traces: TraceEvidence[]
  metrics: MetricEvidence[]
  audits: AuditEvidence[]
  securityFindings: SecurityFinding[]
  budgets: BudgetEvidence[]
  quotas: QuotaEvidence[]
  alerts: AlertEvidence[]
  liveConformance: boolean
  status?: EvidenceStatus
}

export interface OperationalEvidence extends OperationalEvidenceInput {
  schemaVersion: typeof OPERATIONS_EVIDENCE_SCHEMA
  redactions: string[]
}

export interface InMemoryTelemetryOptions {
  idPrefix?: string
  now?: () => string
}

export class InMemoryLogger implements LoggerPort {
  readonly events: TelemetryEvent[] = []

  emit(event: TelemetryEvent): void {
    this.events.push(sanitizeTelemetryEvent(event))
  }
}

export class InMemoryMetrics implements MetricPort {
  readonly values = new Map<string, number>()
  readonly samples: MetricEvidence[] = []
  private readonly now: () => string

  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now
  }

  increment(name: string, value = 1, attributes: Record<string, string> = {}): void {
    const safeAttributes = sanitizeStringRecord(attributes)
    this.values.set(name, (this.values.get(name) ?? 0) + value)
    this.samples.push({ name, value, attributes: safeAttributes, timestamp: this.now() })
  }
}

class InMemorySpan implements SpanPort {
  private status: SpanStatus = SPAN_STATUS.OK
  private message: string | undefined
  private endedAt: string | undefined
  private readonly record: TraceEvidence
  private readonly now: () => string

  constructor(record: TraceEvidence, now: () => string) {
    this.record = record
    this.now = now
  }

  setStatus(status: SpanStatus, message?: string): void {
    this.status = status
    this.message = message
  }

  end(): void {
    this.endedAt = this.now()
  }

  snapshot(): TraceEvidence {
    return omitUndefined({
      ...this.record,
      status: this.status,
      message: this.message,
      endedAt: this.endedAt,
    })
  }
}

class InMemoryTracer implements TracerPort {
  readonly spans: InMemorySpan[] = []
  private sequence = 0
  private readonly idPrefix: string
  private readonly now: () => string

  constructor(idPrefix: string, now: () => string) {
    this.idPrefix = idPrefix
    this.now = now
  }

  startSpan(name: string, context: TelemetryContext = {}): SpanPort {
    this.sequence += 1
    const traceId = context.traceId ?? `${this.idPrefix}-trace-${this.sequence}`
    const span = new InMemorySpan(
      {
        traceId,
        spanId: `${this.idPrefix}-span-${this.sequence}`,
        name,
        startedAt: this.now(),
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        actorId: context.actorId,
        requestId: context.requestId,
      },
      this.now
    )
    this.spans.push(span)
    return span
  }

  snapshots(): TraceEvidence[] {
    return this.spans.map((span) => span.snapshot())
  }
}

export interface InMemoryTelemetry extends RuntimeTelemetry {
  logs: TelemetryEvent[]
  traces: TraceEvidence[]
  metricSamples: MetricEvidence[]
}

export function createInMemoryTelemetry(options: InMemoryTelemetryOptions = {}): InMemoryTelemetry {
  const now = options.now ?? (() => new Date().toISOString())
  const logger = new InMemoryLogger()
  const metrics = new InMemoryMetrics(now)
  const tracer = new InMemoryTracer(options.idPrefix ?? 'runtime', now)
  return {
    logger,
    logs: logger.events,
    metrics,
    metricSamples: metrics.samples,
    tracer,
    get traces() {
      return tracer.snapshots()
    },
  }
}

export function createContextMiddleware(options: { telemetry: RuntimeTelemetry }) {
  return (
    request: { headers?: Record<string, string | undefined> },
    response: { setHeader: (name: string, value: string) => void },
    next: (context: TelemetryContext) => void
  ) => {
    const headers = request.headers ?? {}
    const correlationId = headers['x-correlation-id'] ?? `corr-${Date.now()}`
    const context: TelemetryContext = { correlationId, requestId: headers['x-request-id'] }
    response.setHeader('x-correlation-id', correlationId)
    logEvent(options.telemetry, 'request.context', TELEMETRY_LEVEL.INFO, context)
    next(context)
  }
}

export function createRuntimeTelemetry(
  logger: LoggerPort = new InMemoryLogger()
): RuntimeTelemetry {
  return {
    logger,
    metrics: new InMemoryMetrics(),
    tracer: new InMemoryTracer('runtime', () => new Date().toISOString()),
  }
}

export function logEvent(
  telemetry: RuntimeTelemetry,
  name: string,
  level: TelemetryLevel,
  context: TelemetryContext = {},
  attributes: Record<string, string | number | boolean> = {}
): void {
  telemetry.logger.emit({
    name,
    level,
    timestamp: new Date().toISOString(),
    ...safeContext(context),
    attributes: sanitizeAttributes(attributes),
  })
}

export function createTusOperationsTelemetry(telemetry: RuntimeTelemetry): TusOperationsTelemetry {
  return {
    record(input) {
      const context: TelemetryContext = {
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        actorId: input.actorId,
      }
      const failed = input.outcome === 'denied' || input.outcome === 'failure'
      const span = telemetry.tracer.startSpan(input.name, context)
      span.setStatus(failed ? SPAN_STATUS.ERROR : SPAN_STATUS.OK, failed ? input.outcome : undefined)
      span.end()
      logEvent(telemetry, input.name, failed ? TELEMETRY_LEVEL.WARN : TELEMETRY_LEVEL.INFO, context, {
        outcome: input.outcome,
        latencyMs: input.latencyMs,
        ...input.attributes,
      })
      telemetry.metrics.increment(input.name, 1, {
        outcome: input.outcome,
        tenantId: input.tenantId ?? 'unknown',
      })
      if (failed && input.name.includes('authorization')) {
        telemetry.metrics.increment('tus.security.boundary_violation', 1, {
          tenantId: input.tenantId ?? 'unknown',
        })
      }
    },
  }
}

export function toTelemetryEnvelope(event: TelemetryEvent): TelemetryEnvelope {
  return { channel: TELEMETRY_CHANNEL, event: sanitizeTelemetryEvent(event) }
}

export function recordAudit(input: AuditInput): AuditEvidence {
  return {
    action: input.action,
    outcome: input.outcome,
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...safeContext(input),
    details: redactObject(input.details ?? {}),
  }
}

export function evaluateBudget(input: BudgetInput): BudgetEvidence {
  const remaining = Math.max(0, input.limit - input.used)
  const exhausted = input.used >= input.limit
  const warning = !exhausted && input.used >= input.warningAt
  return {
    name: input.name,
    limit: input.limit,
    used: input.used,
    remaining,
    status: exhausted
      ? CONTROL_STATUS.EXHAUSTED
      : warning
        ? CONTROL_STATUS.WARNING
        : CONTROL_STATUS.OK,
    alert: exhausted ? 'budget.exhausted' : warning ? 'budget.warning' : null,
  }
}

export function evaluateQuota(input: QuotaInput): QuotaEvidence {
  const remaining = Math.max(0, input.limit - input.used)
  const exhausted = input.used >= input.limit
  const warning = !exhausted && input.used >= input.warningAt
  return {
    name: input.name,
    limit: input.limit,
    used: input.used,
    remaining,
    status: exhausted
      ? CONTROL_STATUS.EXHAUSTED
      : warning
        ? CONTROL_STATUS.WARNING
        : CONTROL_STATUS.OK,
    alert: exhausted ? 'quota.exhausted' : warning ? 'quota.warning' : null,
  }
}

export function createOperationalEvidence(input: OperationalEvidenceInput): OperationalEvidence {
  const status = input.status ?? EVIDENCE_STATUS.PASS
  return {
    schemaVersion: OPERATIONS_EVIDENCE_SCHEMA,
    profile: input.profile,
    evidenceKind: input.evidenceKind,
    status,
    liveConformance: input.liveConformance,
    traces: input.traces.map((trace) => redactObject(trace) as unknown as TraceEvidence),
    metrics: input.metrics.map((metric) => ({
      ...metric,
      attributes: sanitizeStringRecord(metric.attributes),
    })),
    audits: input.audits.map((audit) => recordAudit(audit)),
    securityFindings: input.securityFindings.map((finding) => ({
      ...finding,
      summary: redactString(finding.summary),
    })),
    budgets: input.budgets.map((budget) => ({ ...budget })),
    quotas: input.quotas.map((quota) => ({ ...quota })),
    alerts: input.alerts.map((alert) => ({ ...alert, reason: redactString(alert.reason) })),
    redactions: [
      'credentials',
      'authorization headers',
      'provider payloads',
      'secret-like attributes',
    ],
  }
}

function safeContext(context: TelemetryContext): TelemetryContext {
  return {
    correlationId: context.correlationId,
    traceId: context.traceId,
    tenantId: context.tenantId,
    actorId: context.actorId,
    requestId: context.requestId,
  }
}

function sanitizeTelemetryEvent(event: TelemetryEvent): TelemetryEvent {
  return {
    ...safeContext(event),
    name: event.name,
    level: event.level,
    timestamp: event.timestamp,
    attributes: sanitizeAttributes(event.attributes ?? {}),
  }
}

function sanitizeAttributes(
  attributes: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactPrimitive(value),
    ])
  )
}

function sanitizeStringRecord(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactString(value),
    ])
  )
}

function redactObject(values: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactUnknown(value),
    ])
  )
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactUnknown(entry))
  if (typeof value === 'object' && value !== null)
    return redactObject(value as Record<string, unknown>)
  if (typeof value === 'string') return redactString(value)
  return value
}

function redactPrimitive(value: string | number | boolean): string | number | boolean {
  return typeof value === 'string' ? redactString(value) : value
}

function redactString(value: string): string {
  return /bearer\s+|api[_-]?key\s*[:=]|secret|token|password|private[_-]?key/i.test(value)
    ? '[REDACTED]'
    : value
}

function isSensitiveKey(key: string): boolean {
  return /authorization|api[_-]?key|secret|token|password|private[_-]?key|credential/i.test(key)
}

function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}
