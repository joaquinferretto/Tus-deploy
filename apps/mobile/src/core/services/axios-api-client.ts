import axios from 'axios';
import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
  Method,
} from 'axios';

import {
  API_ERROR_KIND,
  type ApiClient,
  type ApiFailure,
  type ApiRequest,
  type ApiResult,
  type AuthTokenRefresher,
  type HttpMethod,
} from '@core/domain';
import type { LoggerService } from '@core/domain';

import type { CredentialStore, TokenPair } from './secure-credential-store';
import { parseMobileRuntimeConfig, type MobileRuntimeConfig } from '../config/runtime-profile.ts';

interface AxiosApiClientOptions {
  runtime: MobileRuntimeConfig;
  baseUrl?: string;
  credentialStore: CredentialStore;
  tokenRefresher: AuthTokenRefresher;
  logger: LoggerService;
  timeoutMs?: number;
  createCorrelationId?: () => string;
  onRefreshFailure?: () => Promise<void> | void;
}

interface AlquiAxiosMetadata {
  requiresAuth: boolean;
  allowRefresh: boolean;
  replayed: boolean;
  retryCount: number;
  maxRetries: number;
  method: HttpMethod;
  correlationId: string;
}

declare module 'axios' {
  interface AxiosRequestConfig {
    alqui?: Partial<AlquiAxiosMetadata>;
  }

  interface InternalAxiosRequestConfig {
    alqui?: Partial<AlquiAxiosMetadata>;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_ATTEMPTS = 1;
const SAFE_RETRY_METHODS = new Set<HttpMethod>(['GET', 'DELETE']);

export class AxiosApiClient implements ApiClient {
  private readonly instance: AxiosInstance;
  private readonly credentialStore: CredentialStore;
  private readonly tokenRefresher: AuthTokenRefresher;
  private readonly logger: LoggerService;
  private readonly createCorrelationId: () => string;
  private readonly onRefreshFailure: (() => Promise<void> | void) | undefined;
  private refreshInFlight: Promise<TokenPair> | null = null;

  constructor(options: AxiosApiClientOptions) {
    const runtime = parseMobileRuntimeConfig(options.runtime);
    if (options.baseUrl !== undefined && options.baseUrl.replace(/\/$/, '') !== runtime.apiUrl) {
      throw new Error('AxiosApiClient rejects a baseUrl that differs from the resolved mobile runtime.');
    }

    this.credentialStore = options.credentialStore;
    this.tokenRefresher = options.tokenRefresher;
    this.logger = options.logger;
    this.createCorrelationId = options.createCorrelationId ?? createDefaultCorrelationId;
    this.onRefreshFailure = options.onRefreshFailure;
    this.instance = axios.create({
      baseURL: runtime.apiUrl,
      allowAbsoluteUrls: false,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    this.installInterceptors();
  }

  async request<TData, TBody = unknown>(input: ApiRequest<TBody>): Promise<ApiResult<TData>> {
    const method = input.method ?? 'GET';
    const correlationId = input.correlationId ?? this.createCorrelationId();
    const retryCount = input.retry?.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS;
    const config = this.createRequestConfig(input, method, correlationId, retryCount);

    try {
      const response = await this.instance.request<TData>(config);
      return {
        ok: true,
        data: response.data,
        status: response.status,
        correlationId,
      };
    } catch (error: unknown) {
      return this.toApiFailure(error, correlationId);
    }
  }

  private createRequestConfig<TBody>(
    input: ApiRequest<TBody>,
    method: HttpMethod,
    correlationId: string,
    maxRetries: number,
  ): AxiosRequestConfig<TBody> {
    const config: AxiosRequestConfig<TBody> = {
      url: input.url,
      method: method as Method,
      alqui: {
        requiresAuth: input.requiresAuth ?? true,
        allowRefresh: input.allowRefresh ?? true,
        replayed: false,
        retryCount: 0,
        maxRetries,
        method,
        correlationId,
      },
    };

    if (input.headers !== undefined) config.headers = input.headers;
    if (input.query !== undefined) config.params = input.query;
    if (input.body !== undefined) config.data = input.body;
    if (input.timeoutMs !== undefined) config.timeout = input.timeoutMs;

    return config;
  }

  private installInterceptors(): void {
    this.instance.interceptors.request.use(async (config) => this.attachRequestHeaders(config));
    this.instance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => this.handleResponseError(error),
    );
  }

  private async attachRequestHeaders(
    config: InternalAxiosRequestConfig,
  ): Promise<InternalAxiosRequestConfig> {
    const metadata = config.alqui;
    const correlationId = metadata?.correlationId ?? this.createCorrelationId();

    config.headers.set('Accept', 'application/json');
    config.headers.set('X-Correlation-Id', correlationId);

    if (metadata?.requiresAuth !== false) {
      const token = await this.credentialStore.getAccessToken();
      if (token !== null && token.length > 0) {
        config.headers.set('Authorization', `Bearer ${token}`);
      }
    }

    this.logger.addBreadcrumb({
      category: 'api.request',
      level: 'info',
      message: `${String(config.method ?? 'GET').toUpperCase()} ${config.url ?? '/'}`,
      data: { correlationId },
    });

    return config;
  }

  private async handleResponseError(error: AxiosError): Promise<AxiosResponse> {
    const originalRequest = error.config;
    const status = error.response?.status;

    if (originalRequest === undefined) {
      return Promise.reject(error);
    }

    if (status === 401 && this.shouldAttemptRefresh(originalRequest)) {
      return this.refreshAndReplay(originalRequest, error);
    }

    if (this.shouldRetryTransient(originalRequest, error)) {
      const nextRetryCount = (originalRequest.alqui?.retryCount ?? 0) + 1;
      originalRequest.alqui = {
        ...originalRequest.alqui,
        retryCount: nextRetryCount,
      };

      return this.instance.request(originalRequest);
    }

    return Promise.reject(error);
  }

  private shouldAttemptRefresh(config: InternalAxiosRequestConfig): boolean {
    return config.alqui?.allowRefresh !== false && config.alqui?.replayed !== true;
  }

  private async refreshAndReplay(
    originalRequest: InternalAxiosRequestConfig,
    originalError: AxiosError,
  ): Promise<AxiosResponse> {
    try {
      const tokens = await this.refreshTokensOnce();
      originalRequest.alqui = {
        ...originalRequest.alqui,
        replayed: true,
      };
      originalRequest.headers.set('Authorization', `Bearer ${tokens.accessToken}`);
      return await this.instance.request(originalRequest);
    } catch (refreshError: unknown) {
      await this.credentialStore.clear().catch(() => undefined);
      await this.onRefreshFailure?.();
      const context = createRefreshFailureContext(originalRequest.alqui?.correlationId);
      this.logger.captureException(refreshError, context);
      return Promise.reject(originalError);
    }
  }

  private async refreshTokensOnce(): Promise<TokenPair> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.performTokenRefresh();

    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async performTokenRefresh(): Promise<TokenPair> {
    const refreshToken = await this.credentialStore.getRefreshToken();
    if (refreshToken === null || refreshToken.length === 0) {
      throw new Error('Refresh token is unavailable.');
    }

    const tokens = await this.tokenRefresher.refreshTokens(refreshToken);
    await this.credentialStore.setTokens(tokens);
    return tokens;
  }

  private shouldRetryTransient(config: InternalAxiosRequestConfig, error: AxiosError): boolean {
    const method = (config.alqui?.method ?? String(config.method ?? 'GET').toUpperCase()) as HttpMethod;
    const retryCount = config.alqui?.retryCount ?? 0;
    const maxRetries = config.alqui?.maxRetries ?? DEFAULT_RETRY_ATTEMPTS;
    const isRetryableStatus = error.response === undefined || (error.response.status >= 500 && error.response.status < 600);

    return retryCount < maxRetries && SAFE_RETRY_METHODS.has(method) && isRetryableStatus;
  }

  private toApiFailure(error: unknown, fallbackCorrelationId: string): ApiFailure {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const correlationId = error.config?.alqui?.correlationId ?? fallbackCorrelationId;
      const failure: ApiFailure = {
        ok: false,
        kind: classifyAxiosError(error),
        retryable: isRetryableAxiosError(error),
        correlationId,
      };

      if (status !== undefined) failure.status = status;
      if (error.message.length > 0) failure.message = error.message;
      return failure;
    }

    return {
      ok: false,
      kind: API_ERROR_KIND.UNKNOWN,
      retryable: false,
      correlationId: fallbackCorrelationId,
      message: error instanceof Error ? error.message : 'Unknown API failure',
    };
  }
}

function classifyAxiosError(error: AxiosError): ApiFailure['kind'] {
  if (error.code === 'ECONNABORTED') return API_ERROR_KIND.TIMEOUT;
  if (error.response === undefined) return API_ERROR_KIND.OFFLINE;

  const status = error.response.status;
  if (status === 401) return API_ERROR_KIND.REFRESH;
  if (status >= 400 && status < 500) return API_ERROR_KIND.CLIENT;
  if (status >= 500) return API_ERROR_KIND.SERVER;
  return API_ERROR_KIND.UNKNOWN;
}

function isRetryableAxiosError(error: AxiosError): boolean {
  if (error.code === 'ECONNABORTED') return true;
  if (error.response === undefined) return true;
  return error.response.status >= 500;
}

function createRefreshFailureContext(correlationId: string | undefined) {
  return correlationId === undefined
    ? { tags: { source: 'api.refresh' } }
    : { correlationId, tags: { source: 'api.refresh' } };
}

function createDefaultCorrelationId(): string {
  return `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
