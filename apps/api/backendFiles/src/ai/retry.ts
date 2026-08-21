export const RETRY_ERROR_KIND = {
  ABORTED: 'aborted',
  PERMANENT: 'permanent',
  RATE_LIMITED: 'rate_limited',
  TRANSIENT: 'transient',
  NETWORK: 'network',
  UNKNOWN: 'unknown',
} as const;

export type RetryErrorKind = (typeof RETRY_ERROR_KIND)[keyof typeof RETRY_ERROR_KIND];

export interface RetryClassification {
  retryable: boolean;
  kind: RetryErrorKind;
  status?: number;
  code?: string;
  reason?: string;
}

export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  elapsedMs: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
  signal?: AbortSignal;
  classifyError?: (error: unknown) => RetryClassification;
  delayForRetry?: (error: unknown, context: RetryContext, backoffDelayMs: number) => number | undefined;
}

interface ErrorDetails {
  message: string;
  code?: string;
  status?: number;
  name?: string;
}

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

function asErrorDetails(error: unknown): ErrorDetails {
  if (typeof error !== 'object' || error === null) return { message: String(error) };
  const value = error as Record<string, unknown>;
  const response = typeof value.response === 'object' && value.response !== null
    ? value.response as Record<string, unknown>
    : undefined;
  const statusValue = value.status ?? value.statusCode ?? response?.status;
  const status = typeof statusValue === 'number' ? statusValue : undefined;
  return {
    message: typeof value.message === 'string' ? value.message : 'Operation failed',
    code: typeof value.code === 'string' ? value.code : undefined,
    status,
    name: typeof value.name === 'string' ? value.name : undefined,
  };
}

function isAbortError(error: unknown): boolean {
  const details = asErrorDetails(error);
  return details.name === 'AbortError' || details.code === 'ABORT_ERR' || details.code === 'HTTP_ABORTED';
}

export function classifyRetryError(error: unknown): RetryClassification {
  const details = asErrorDetails(error);
  const searchable = `${details.code ?? ''} ${details.message}`.toLowerCase();

  if (isAbortError(error)) return { retryable: false, kind: RETRY_ERROR_KIND.ABORTED, status: details.status, code: details.code, reason: 'Operation was aborted' };
  if (/validation|invalid|schema|parse|malformed|bad_request/.test(searchable)) {
    return { retryable: false, kind: RETRY_ERROR_KIND.PERMANENT, status: details.status, code: details.code, reason: 'Validation errors are not retryable' };
  }
  if (details.status !== undefined && details.status >= 400 && details.status < 500) {
    if (details.status === 429 && !/quota|exhaust|permanent|daily limit/.test(searchable)) {
      return { retryable: true, kind: RETRY_ERROR_KIND.RATE_LIMITED, status: details.status, code: details.code, reason: 'Request was rate limited' };
    }
    if (RETRYABLE_STATUSES.has(details.status) && details.status !== 429) {
      return { retryable: true, kind: RETRY_ERROR_KIND.TRANSIENT, status: details.status, code: details.code, reason: 'Request may succeed later' };
    }
    return { retryable: false, kind: RETRY_ERROR_KIND.PERMANENT, status: details.status, code: details.code, reason: 'Permanent client error' };
  }
  if (details.status !== undefined && details.status >= 500) {
    return { retryable: true, kind: RETRY_ERROR_KIND.TRANSIENT, status: details.status, code: details.code, reason: 'Server error' };
  }
  if (/network|fetch|timeout|timed out|econn|socket|dns/.test(searchable)) {
    return { retryable: true, kind: RETRY_ERROR_KIND.NETWORK, status: details.status, code: details.code, reason: 'Network or timeout failure' };
  }
  return { retryable: false, kind: RETRY_ERROR_KIND.UNKNOWN, status: details.status, code: details.code, reason: 'Error was not classified as retryable' };
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === 'string' ? reason : 'Operation aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function calculateBackoff(attempt: number, initialDelay: number, maxDelay: number, jitter: boolean): number {
  const exponential = Math.min(maxDelay, initialDelay * (2 ** Math.max(0, attempt - 1)));
  return jitter ? Math.floor(Math.random() * (exponential + 1)) : exponential;
}

function wait(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(abortError(signal as AbortSignal));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function retryWithBackoff<T>(operation: (context: RetryContext) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const initialDelay = Math.max(0, options.initialDelay ?? 250);
  const maxDelay = Math.max(initialDelay, options.maxDelay ?? 30_000);
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    const context: RetryContext = { attempt, maxAttempts, delayMs: 0, elapsedMs: Date.now() - startedAt };
    try {
      return await operation(context);
    } catch (error) {
      const classification = (options.classifyError ?? classifyRetryError)(error);
      if (!classification.retryable || attempt >= maxAttempts) throw error;
      const backoffDelayMs = calculateBackoff(attempt, initialDelay, maxDelay, options.jitter ?? false);
      const requestedDelay = options.delayForRetry?.(error, { ...context, delayMs: backoffDelayMs }, backoffDelayMs);
      const delayMs = Math.min(maxDelay, Math.max(0, requestedDelay ?? backoffDelayMs));
      await wait(delayMs, options.signal);
    }
  }

  throw new Error('Retry loop exhausted unexpectedly');
}
