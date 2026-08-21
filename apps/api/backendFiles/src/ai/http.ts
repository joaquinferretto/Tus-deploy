import { classifyRetryError, RETRY_ERROR_KIND, retryWithBackoff, type RetryClassification, type RetryContext } from './retry.js';

export interface FetchFunction {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface CombinedAbortSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

export interface FetchTimeoutOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  fetcher?: FetchFunction;
}

export interface FetchRetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetcher?: FetchFunction;
}

export interface HttpErrorInit {
  status: number;
  statusText?: string;
  headers?: Headers;
  body?: string;
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly headers: Headers;
  public readonly body: string;

  public constructor(init: HttpErrorInit) {
    super(`HTTP ${init.status}${init.statusText ? ` ${init.statusText}` : ''}`);
    this.name = 'HttpError';
    this.status = init.status;
    this.statusText = init.statusText ?? '';
    this.headers = init.headers ?? new Headers();
    this.body = init.body ?? '';
  }
}

function createTimeoutError(): Error {
  const error = new Error('HTTP request timed out') as Error & { code?: string };
  error.name = 'TimeoutError';
  error.code = 'HTTP_TIMEOUT';
  return error;
}

function createAbortError(): Error {
  const error = new Error('HTTP request aborted') as Error & { code?: string };
  error.name = 'AbortError';
  error.code = 'HTTP_ABORTED';
  return error;
}

export function createCombinedAbortSignal(externalSignal?: AbortSignal, timeoutMs?: number): CombinedAbortSignal {
  if (!externalSignal && !(timeoutMs !== undefined && timeoutMs > 0)) {
    return { signal: new AbortController().signal, cleanup: () => undefined };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortFromExternal = (): void => controller.abort(externalSignal?.reason ?? createAbortError());
  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal();
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }
  if (timeoutMs !== undefined && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(createTimeoutError()), timeoutMs);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
}

export function parseRetryAfter(value: string | null | undefined, nowMs = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.max(0, Math.ceil(Number(trimmed) * 1000));
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - nowMs);
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, options: FetchTimeoutOptions = {}): Promise<Response> {
  const externalSignal = options.signal ?? init.signal ?? undefined;
  const combined = createCombinedAbortSignal(externalSignal, options.timeoutMs);
  const requestInit: RequestInit = { ...init, signal: combined.signal };
  try {
    return await (options.fetcher ?? fetch)(input, requestInit);
  } catch (error) {
    if (combined.signal.aborted && combined.signal.reason instanceof Error) throw combined.signal.reason;
    throw error;
  } finally {
    combined.cleanup();
  }
}

async function responseBody(response: Response): Promise<string> {
  return response.text().catch(() => '');
}

function classifyHttpError(error: unknown): RetryClassification {
  if (error instanceof HttpError && error.status === 429 && /quota|exhaust|daily limit/i.test(error.body)) {
    return { retryable: false, kind: RETRY_ERROR_KIND.PERMANENT, status: error.status, reason: 'Provider quota is exhausted' };
  }
  return classifyRetryError(error);
}

function retryDelay(error: unknown, _context: RetryContext, backoffDelayMs: number): number | undefined {
  if (!(error instanceof HttpError)) return backoffDelayMs;
  return parseRetryAfter(error.headers.get('retry-after')) ?? backoffDelayMs;
}

export async function fetchRetryable(input: RequestInfo | URL, init: RequestInit = {}, options: FetchRetryOptions = {}): Promise<Response> {
  return retryWithBackoff(
    async () => {
      const response = await fetchWithTimeout(input, init, {
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        fetcher: options.fetcher,
      });
      if (!response.ok) {
        throw new HttpError({
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: await responseBody(response),
        });
      }
      return response;
    },
    {
      maxAttempts: options.maxAttempts,
      initialDelay: options.initialDelay,
      maxDelay: options.maxDelay,
      jitter: options.jitter,
      signal: options.signal,
      classifyError: classifyHttpError,
      delayForRetry: retryDelay,
    },
  );
}
