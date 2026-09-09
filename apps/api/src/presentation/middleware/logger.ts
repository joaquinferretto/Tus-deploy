import { redactText } from '@factory/errors'

const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[_-]?key|credential/iu

export interface SafeLogEvent {
  level: 'info' | 'warn' | 'error'
  message: string
  correlationId?: string
  tenantId?: string
  actorId?: string
  details?: unknown
  timestamp: string
}

export interface SafeLogger {
  info(message: string, context?: Omit<SafeLogEvent, 'level' | 'message' | 'timestamp'>): void
  warn(message: string, context?: Omit<SafeLogEvent, 'level' | 'message' | 'timestamp'>): void
  error(message: string, context?: Omit<SafeLogEvent, 'level' | 'message' | 'timestamp'>): void
}

export function createSafeLogger(sink: (event: SafeLogEvent) => void = (event) => {
  console.error(JSON.stringify(event))
}): SafeLogger {
  return {
    info: (message, context) => emit(sink, 'info', message, context),
    warn: (message, context) => emit(sink, 'warn', message, context),
    error: (message, context) => emit(sink, 'error', message, context),
  }
}

function emit(
  sink: (event: SafeLogEvent) => void,
  level: SafeLogEvent['level'],
  message: string,
  context?: Omit<SafeLogEvent, 'level' | 'message' | 'timestamp'>,
): void {
  const event: SafeLogEvent = {
    level,
    message: redactText(message),
    timestamp: new Date().toISOString(),
    ...(context?.correlationId ? { correlationId: redactText(context.correlationId) } : {}),
    ...(context?.tenantId ? { tenantId: redactText(context.tenantId) } : {}),
    ...(context?.actorId ? { actorId: redactText(context.actorId) } : {}),
    ...(context?.details !== undefined ? { details: redactValue(context.details) } : {}),
  }
  sink(event)
}

function redactValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]))
  }
  return value
}
