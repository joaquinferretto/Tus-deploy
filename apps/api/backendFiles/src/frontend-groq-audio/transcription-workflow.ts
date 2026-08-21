/** Retryable, non-React transcription workflow for audio only. */

import { FrontendTranscriptionError } from './transcription-client';

export const TRANSCRIPTION_WORKFLOW_DEFAULTS = {
  maxAttempts: 3,
  retryDelayMs: 5_000,
} as const;

export interface TranscriptionAttempt {
  attempt: number;
  error?: string;
}

export interface TranscriptionWorkflowSuccess {
  ok: true;
  text: string;
  attempts: TranscriptionAttempt[];
}

export interface TranscriptionWorkflowFailure {
  ok: false;
  message: string;
  attempts: TranscriptionAttempt[];
}

export type TranscriptionWorkflowResult = TranscriptionWorkflowSuccess | TranscriptionWorkflowFailure;

export interface TranscriptionWorkflowOptions {
  audio: Blob | null | undefined;
  transcribe: (audio: Blob, options?: { signal?: AbortSignal }) => Promise<string>;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  onAttempt?: (attempt: number) => void;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('Transcription was aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Transcription was aborted'));
    }, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error al transcribir el audio';
}

function isRetryable(error: unknown): boolean {
  return error instanceof FrontendTranscriptionError ? error.retryable : true;
}

export async function transcribeWithFrontendRetry(
  options: TranscriptionWorkflowOptions,
): Promise<TranscriptionWorkflowResult> {
  if (!options.audio) {
    return { ok: false, message: 'No hay audio cargado para transcribir', attempts: [] };
  }
  if (options.audio.size === 0) {
    return { ok: false, message: 'El audio está vacío', attempts: [] };
  }

  const maxAttempts = Math.max(1, options.maxAttempts ?? TRANSCRIPTION_WORKFLOW_DEFAULTS.maxAttempts);
  const retryDelayMs = options.retryDelayMs ?? TRANSCRIPTION_WORKFLOW_DEFAULTS.retryDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  const attempts: TranscriptionAttempt[] = [];
  let lastMessage = 'Error al transcribir el audio';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      return { ok: false, message: 'La transcripción fue cancelada', attempts };
    }
    options.onAttempt?.(attempt);

    try {
      const text = await options.transcribe(options.audio, { signal: options.signal });
      if (!text.trim()) {
        lastMessage = 'La transcripción llegó vacía';
        attempts.push({ attempt, error: lastMessage });
        break;
      }
      attempts.push({ attempt });
      return { ok: true, text, attempts };
    } catch (error) {
      lastMessage = errorMessage(error);
      attempts.push({ attempt, error: lastMessage });
      if (!isRetryable(error) || attempt >= maxAttempts) break;
      try {
        await sleep(retryDelayMs, options.signal);
      } catch {
        return { ok: false, message: 'La transcripción fue cancelada', attempts };
      }
    }
  }

  return {
    ok: false,
    message: `${lastMessage}. Reintentá nuevamente o grabá un audio nuevo.`,
    attempts,
  };
}
