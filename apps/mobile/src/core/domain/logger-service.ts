export const LOG_LEVEL = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
} as const;

export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];

export type SafeLogValue =
  | string
  | number
  | boolean
  | null
  | SafeLogValue[]
  | { readonly [key: string]: SafeLogValue };

export interface SafeLogContext {
  correlationId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, SafeLogValue>;
}

export interface LoggerBreadcrumb {
  category: string;
  message: string;
  level?: Exclude<LogLevel, 'fatal'>;
  data?: Record<string, SafeLogValue>;
}

export interface LoggerUser {
  id: string;
  tenantId?: string;
}

export interface LoggerService {
  debug(message: string, context?: SafeLogContext): void;
  info(message: string, context?: SafeLogContext): void;
  warn(message: string, context?: SafeLogContext): void;
  error(message: string, context?: SafeLogContext): void;
  fatal(message: string, context?: SafeLogContext): void;
  captureException(error: unknown, context?: SafeLogContext): void;
  addBreadcrumb(breadcrumb: LoggerBreadcrumb): void;
  setUser(user: LoggerUser | null): void;
  flush(timeoutMs?: number): Promise<boolean>;
}
