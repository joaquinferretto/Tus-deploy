/** Fetch-based STT client for the frontend audio contract. */

import {
  AudioContractError,
  createTranscriptionUploadPart,
  type AudioUploadPart,
} from './audio-contracts';

export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface FrontendTranscriptionClientOptions {
  baseUrl: string;
  path?: string;
  token?: string;
  timeoutMs?: number;
  fetcher?: FetchFunction;
}

export interface TranscriptionRequestOptions {
  signal?: AbortSignal;
}

export interface TranscriptionApiResponse {
  resultado?: unknown;
  text?: unknown;
}

export class FrontendTranscriptionError extends Error {
  public constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly code?: string,
    public readonly retryable = false,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FrontendTranscriptionError';
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function resolveFetch(fetcher?: FetchFunction): FetchFunction {
  if (fetcher) return fetcher;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new FrontendTranscriptionError('Fetch is not available in this runtime');
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function parseResponse(response: Response): Promise<TranscriptionApiResponse> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isJsonRecord(body) && typeof body.resultado === 'string'
      ? body.resultado
      : isJsonRecord(body) && typeof body.text === 'string'
        ? body.text
        : `Transcription request failed (${response.status})`;
    const retryable = response.status === 408
      || response.status === 425
      || response.status === 429
      || response.status >= 500;
    throw new FrontendTranscriptionError(message, response.status, undefined, retryable);
  }
  return isJsonRecord(body) ? body : {};
}

function extractText(body: TranscriptionApiResponse): string {
  const value = typeof body.resultado === 'string' ? body.resultado : body.text;
  if (typeof value !== 'string' || !value.trim()) {
    throw new FrontendTranscriptionError('The transcription response was empty');
  }
  return value;
}

export function buildTranscriptionFormData(audio: Blob): FormData {
  const part: AudioUploadPart = createTranscriptionUploadPart(audio);
  const formData = new FormData();
  formData.append('file', part.body, part.filename);
  return formData;
}

function createRequestSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

export function createFrontendTranscriptionClient(options: FrontendTranscriptionClientOptions) {
  const fetcher = resolveFetch(options.fetcher);
  const path = options.path ?? '/reports/transcribir';
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    async transcribeAudio(
      audio: Blob,
      requestOptions: TranscriptionRequestOptions = {},
    ): Promise<string> {
      const requestSignal = createRequestSignal(requestOptions.signal, timeoutMs);
      try {
        const headers: Record<string, string> = {};
        if (options.token) headers.Authorization = `Bearer ${options.token}`;
        const response = await fetcher(joinUrl(options.baseUrl, path), {
          method: 'POST',
          headers,
          body: buildTranscriptionFormData(audio),
          signal: requestSignal.controller.signal,
        });
        return extractText(await parseResponse(response));
      } catch (error) {
        if (error instanceof FrontendTranscriptionError) throw error;
        if (error instanceof AudioContractError) {
          throw new FrontendTranscriptionError(
            error.message,
            undefined,
            'INVALID_AUDIO',
            false,
            error,
          );
        }
        if (requestOptions.signal?.aborted) {
          throw new FrontendTranscriptionError(
            'Transcription request was aborted',
            undefined,
            'TRANSCRIPTION_ABORTED',
            false,
            error,
          );
        }
        if (error instanceof Error && error.name === 'AbortError') {
          throw new FrontendTranscriptionError(
            'Transcription request timed out',
            undefined,
            'TRANSCRIPTION_TIMEOUT',
            true,
            error,
          );
        }
        throw new FrontendTranscriptionError(
          'Transcription request failed',
          undefined,
          'TRANSCRIPTION_REQUEST_FAILED',
          true,
          error,
        );
      } finally {
        requestSignal.cleanup();
      }
    },
  };
}
