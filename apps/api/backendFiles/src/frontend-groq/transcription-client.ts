/**
 * Fetch-based adapter for the frontend transcription contract.
 * It intentionally contains no API key and does not call Groq from a browser.
 */

import {
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

async function parseResponse(response: Response): Promise<TranscriptionApiResponse> {
  const body = await response.json().catch(() => ({})) as TranscriptionApiResponse;
  if (!response.ok) {
    const message = typeof body.resultado === 'string'
      ? body.resultado
      : typeof body.text === 'string' ? body.text : `Transcription request failed (${response.status})`;
    throw new FrontendTranscriptionError(message, response.status, undefined, response.status >= 500 || response.status === 429);
  }
  return body;
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

export function createFrontendTranscriptionClient(options: FrontendTranscriptionClientOptions) {
  const fetcher = resolveFetch(options.fetcher);
  const path = options.path ?? '/reports/transcribir';
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    async transcribeAudio(audio: Blob): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = {};
        if (options.token) headers.Authorization = `Bearer ${options.token}`;

        const response = await fetcher(joinUrl(options.baseUrl, path), {
          method: 'POST',
          headers,
          body: buildTranscriptionFormData(audio),
          signal: controller.signal,
        });
        return extractText(await parseResponse(response));
      } catch (error) {
        if (error instanceof FrontendTranscriptionError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new FrontendTranscriptionError('Transcription request timed out', undefined, 'TRANSCRIPTION_TIMEOUT', true, error);
        }
        throw new FrontendTranscriptionError('Transcription request failed', undefined, 'TRANSCRIPTION_REQUEST_FAILED', true, error);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
