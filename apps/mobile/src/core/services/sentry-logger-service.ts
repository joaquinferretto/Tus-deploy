import * as Sentry from '@sentry/react-native';

import {
  LOG_LEVEL,
  type LoggerBreadcrumb,
  type LoggerService,
  type LoggerUser,
  type LogLevel,
  type SafeLogContext,
  type SafeLogValue,
} from '@core/domain';

type SentrySeverityLevel = Sentry.SeverityLevel;

export interface SentryLoggerServiceOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  enabled?: boolean;
  tracesSampleRate?: number;
  consoleEnabled?: boolean;
}

const SENSITIVE_KEY_PATTERN = /(access|refresh)?token|authorization|password|secret|cookie|email/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const REDACTED = '[REDACTED]';

interface LoggerScope {
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
}

export class SentryLoggerService implements LoggerService {
  private readonly sentryEnabled: boolean;
  private readonly consoleEnabled: boolean;

  constructor(options: SentryLoggerServiceOptions = {}) {
    this.sentryEnabled = options.enabled === true && options.dsn !== undefined && options.dsn.length > 0;
    this.consoleEnabled = options.consoleEnabled ?? true;

    if (this.sentryEnabled) {
      const sentryOptions: Parameters<typeof Sentry.init>[0] = {
        tracesSampleRate: options.tracesSampleRate ?? 0,
        beforeSend: (event) => redactUnknown(event) as typeof event,
      };

      if (options.dsn !== undefined) sentryOptions.dsn = options.dsn;
      if (options.environment !== undefined) sentryOptions.environment = options.environment;
      if (options.release !== undefined) sentryOptions.release = options.release;

      Sentry.init(sentryOptions);
    }
  }

  debug(message: string, context?: SafeLogContext): void {
    this.log(LOG_LEVEL.DEBUG, message, context);
  }

  info(message: string, context?: SafeLogContext): void {
    this.log(LOG_LEVEL.INFO, message, context);
  }

  warn(message: string, context?: SafeLogContext): void {
    this.log(LOG_LEVEL.WARN, message, context);
  }

  error(message: string, context?: SafeLogContext): void {
    this.log(LOG_LEVEL.ERROR, message, context);
  }

  fatal(message: string, context?: SafeLogContext): void {
    this.log(LOG_LEVEL.FATAL, message, context);
  }

  captureException(error: unknown, context?: SafeLogContext): void {
    const safeContext = redactContext(context);

    if (this.consoleEnabled) {
      console.error('[fatal]', error, safeContext);
    }

    if (!this.sentryEnabled) return;

    Sentry.withScope((scope) => {
      applyScope(scope, safeContext);
      Sentry.captureException(error);
    });
  }

  addBreadcrumb(breadcrumb: LoggerBreadcrumb): void {
    const safeBreadcrumb = redactBreadcrumb(breadcrumb);

    if (this.consoleEnabled && safeBreadcrumb.level !== LOG_LEVEL.DEBUG) {
      console.info('[breadcrumb]', safeBreadcrumb.category, safeBreadcrumb.message, safeBreadcrumb.data ?? {});
    }

    if (!this.sentryEnabled) return;

    const sentryBreadcrumb: Parameters<typeof Sentry.addBreadcrumb>[0] = {
      category: safeBreadcrumb.category,
      message: safeBreadcrumb.message,
    };

    if (safeBreadcrumb.level !== undefined) sentryBreadcrumb.level = toSentrySeverityLevel(safeBreadcrumb.level);
    if (safeBreadcrumb.data !== undefined) sentryBreadcrumb.data = safeBreadcrumb.data;

    Sentry.addBreadcrumb(sentryBreadcrumb);
  }

  setUser(user: LoggerUser | null): void {
    if (!this.sentryEnabled) return;
    if (user === null) {
      Sentry.setUser(null);
      return;
    }

    const sentryUser: Parameters<typeof Sentry.setUser>[0] = { id: user.id };
    if (user.tenantId !== undefined) sentryUser.segment = user.tenantId;
    Sentry.setUser(sentryUser);
  }

  async flush(_timeoutMs = 2_000): Promise<boolean> {
    if (!this.sentryEnabled) return true;
    return Sentry.flush();
  }

  private log(level: LogLevel, message: string, context?: SafeLogContext): void {
    const safeMessage = redactString(message);
    const safeContext = redactContext(context);

    if (this.consoleEnabled) {
      writeConsole(level, safeMessage, safeContext);
    }

    if (!this.sentryEnabled || level === LOG_LEVEL.DEBUG) return;

    Sentry.withScope((scope) => {
      applyScope(scope, safeContext);
      Sentry.captureMessage(safeMessage, toSentrySeverityLevel(level));
    });
  }
}

function toSentrySeverityLevel(level: LogLevel): SentrySeverityLevel {
  if (level === LOG_LEVEL.WARN) return 'warning';
  return level;
}

function writeConsole(level: LogLevel, message: string, context?: SafeLogContext): void {
  const payload = context ?? {};
  if (level === LOG_LEVEL.ERROR || level === LOG_LEVEL.FATAL) {
    console.error(`[${level}]`, message, payload);
    return;
  }

  if (level === LOG_LEVEL.WARN) {
    console.warn(`[${level}]`, message, payload);
    return;
  }

  if (level === LOG_LEVEL.DEBUG) {
    console.debug(`[${level}]`, message, payload);
    return;
  }

  console.info(`[${level}]`, message, payload);
}

function applyScope(scope: LoggerScope, context?: SafeLogContext): void {
  if (context?.correlationId !== undefined) {
    scope.setTag('correlationId', context.correlationId);
  }

  for (const [key, value] of Object.entries(context?.tags ?? {})) {
    scope.setTag(key, value);
  }

  for (const [key, value] of Object.entries(context?.extra ?? {})) {
    scope.setExtra(key, value);
  }
}

function redactContext(context?: SafeLogContext): SafeLogContext | undefined {
  if (context === undefined) return undefined;

  const next: SafeLogContext = {};
  if (context.correlationId !== undefined) next.correlationId = redactString(context.correlationId);
  if (context.tags !== undefined) next.tags = redactRecord(context.tags) as Record<string, string>;
  if (context.extra !== undefined) next.extra = redactRecord(context.extra);
  return next;
}

function redactBreadcrumb(breadcrumb: LoggerBreadcrumb): LoggerBreadcrumb {
  const next: LoggerBreadcrumb = {
    category: redactString(breadcrumb.category),
    message: redactString(breadcrumb.message),
  };
  if (breadcrumb.level !== undefined) next.level = breadcrumb.level;
  if (breadcrumb.data !== undefined) next.data = redactRecord(breadcrumb.data);
  return next;
}

function redactRecord(record: Record<string, SafeLogValue>): Record<string, SafeLogValue> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, redactValue(key, value)]),
  );
}

function redactValue(key: string, value: SafeLogValue): SafeLogValue {
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item));
  if (typeof value === 'object' && value !== null) return redactRecord(value as Record<string, SafeLogValue>);
  return value;
}

function redactString(value: string): string {
  return value.replace(BEARER_PATTERN, `Bearer ${REDACTED}`).replace(EMAIL_PATTERN, REDACTED);
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactUnknown(nested),
    ]),
  );
}
