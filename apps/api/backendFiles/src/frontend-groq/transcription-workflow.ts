/**
 * Non-React transcription state machine extracted from useTranscription.
 * The default retry timings intentionally match the current DocPhone behavior.
 */

export const TRANSCRIPTION_WORKFLOW_DEFAULTS = {
  maxAttempts: 3,
  finalAttemptDelayMs: 5_000,
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
  transcribe: (audio: Blob) => Promise<string>;
  maxAttempts?: number;
  finalAttemptDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onAttempt?: (attempt: number) => void;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error al transcribir el audio';
}

export async function transcribeWithFrontendRetry(
  options: TranscriptionWorkflowOptions,
): Promise<TranscriptionWorkflowResult> {
  if (!options.audio) {
    return {
      ok: false,
      message: 'No hay audio cargado para transcribir',
      attempts: [],
    };
  }

  const maxAttempts = Math.max(1, options.maxAttempts ?? TRANSCRIPTION_WORKFLOW_DEFAULTS.maxAttempts);
  const finalAttemptDelayMs = options.finalAttemptDelayMs ?? TRANSCRIPTION_WORKFLOW_DEFAULTS.finalAttemptDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  const attempts: TranscriptionAttempt[] = [];
  let lastMessage = 'Error al transcribir el audio';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    options.onAttempt?.(attempt);
    if (attempt === maxAttempts && maxAttempts > 1) await sleep(finalAttemptDelayMs);

    try {
      const text = await options.transcribe(options.audio);
      if (!text.trim()) {
        lastMessage = 'La transcripción llegó vacía';
        attempts.push({ attempt, error: lastMessage });
        continue;
      }

      attempts.push({ attempt });
      return { ok: true, text, attempts };
    } catch (error) {
      lastMessage = errorMessage(error);
      attempts.push({ attempt, error: lastMessage });
    }
  }

  return {
    ok: false,
    message: `${lastMessage}. Reintentá nuevamente o grabá un audio nuevo.`,
    attempts,
  };
}
