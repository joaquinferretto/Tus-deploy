export const API_ERROR_KIND = {
  TIMEOUT: 'timeout',
  OFFLINE: 'offline',
  CLIENT: 'client',
  SERVER: 'server',
  REFRESH: 'refresh',
  UNKNOWN: 'unknown',
} as const;

export type ApiErrorKind = (typeof API_ERROR_KIND)[keyof typeof API_ERROR_KIND];

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequest<TBody = unknown> {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null>;
  body?: TBody;
  timeoutMs?: number;
  correlationId?: string;
  requiresAuth?: boolean;
  allowRefresh?: boolean;
  retry?: ApiRetryPolicy;
}

export interface ApiRetryPolicy {
  maxAttempts: number;
  retryUnsafeMethods?: boolean;
}

export interface ApiSuccess<TData> {
  ok: true;
  data: TData;
  status: number;
  correlationId: string;
  stale?: boolean;
}

export interface ApiFailure {
  ok: false;
  kind: ApiErrorKind;
  retryable: boolean;
  correlationId: string;
  status?: number;
  message?: string;
}

export type ApiResult<TData> = ApiSuccess<TData> | ApiFailure;

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthTokenRefresher {
  refreshTokens(refreshToken: string): Promise<AuthTokenPair>;
}

export interface ApiClient {
  request<TData, TBody = unknown>(input: ApiRequest<TBody>): Promise<ApiResult<TData>>;
}
