import { Buffer } from 'node:buffer';
import { cleanFlatText, requireNonEmptyText } from '../utils/textCleaner.js';
import { fetchRetryable, type FetchFunction } from './http.js';
import { AI_CAPABILITY, PROVIDER_ERROR_CATEGORY, PROVIDER_STATUS, type ChatRequest, type ChatResult, type GroqProviderConfig, type ProviderAttempt, type ProviderErrorCategory, type ProviderStep, type SpeechRequest, type SpeechResult, type TranscriptionRequest, type TranscriptionResult } from './types.js';

interface GroqErrorInfo { retryable: boolean; category: ProviderErrorCategory; code: string; httpStatus?: number; message: string; }

function classifyGroqError(error: unknown): GroqErrorInfo {
  const err = error as { status?: number; message?: string; code?: string; body?: string };
  const status = err.status;
  const message = String(err.message ?? 'Provider request failed');
  const details = `${message} ${err.body ?? ''}`;
  if (status === 401 || status === 403) return { retryable: false, category: PROVIDER_ERROR_CATEGORY.AUTH, code: 'GROQ_AUTH_FAILED', httpStatus: status, message: 'Provider credential rejected' };
  if (status === 429 && /quota|limit|exhaust/i.test(details)) return { retryable: false, category: PROVIDER_ERROR_CATEGORY.QUOTA, code: 'GROQ_KEY_EXHAUSTED', httpStatus: status, message: 'Provider key exhausted' };
  if (status === 429) return { retryable: true, category: PROVIDER_ERROR_CATEGORY.RATE_LIMIT, code: 'GROQ_RATE_LIMITED', httpStatus: status, message: 'Provider temporarily rate limited' };
  if (status && status >= 500) return { retryable: true, category: PROVIDER_ERROR_CATEGORY.TRANSIENT, code: 'GROQ_TRANSIENT', httpStatus: status, message: 'Provider temporarily unavailable' };
  return { retryable: false, category: PROVIDER_ERROR_CATEGORY.UNKNOWN, code: err.code ?? 'GROQ_REQUEST_FAILED', httpStatus: status, message: 'Provider request failed' };
}

async function parseGroqResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body as { error?: { message?: string; code?: string } };
    const error = new Error(detail.error?.message ?? `Groq HTTP ${response.status}`) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = detail.error?.code;
    throw error;
  }
  return body;
}

function attemptFromError(step: ProviderStep, error: unknown): ProviderAttempt {
  const info = classifyGroqError(error);
  return { step: step.id, provider: 'groq', capability: step.capability, status: PROVIDER_STATUS.FAILED, code: info.code, httpStatus: info.httpStatus, retryable: info.retryable, category: info.category, message: info.message };
}

export class GroqProvider {
  private readonly baseUrl: string;
  public constructor(private readonly config: GroqProviderConfig, private readonly fetcher: FetchFunction = fetch) {
    this.baseUrl = config.baseUrl ?? 'https://api.groq.com/openai/v1';
  }

  public hasKey(step: ProviderStep): boolean { return Boolean(this.config.apiKeys[step.keyIndex]); }

  public async transcribe(step: ProviderStep, request: TranscriptionRequest): Promise<TranscriptionResult> {
    if (step.capability !== AI_CAPABILITY.STT) throw new Error('Invalid provider capability for transcription');
    const key = this.config.apiKeys[step.keyIndex];
    if (!key) throw new Error('Provider key missing');
    try {
      const form = new FormData();
      const blob = new Blob([Uint8Array.from(new Uint8Array(request.audio))], { type: request.mimeType ?? 'audio/m4a' });
      form.append('file', blob, request.fileName ?? 'voice.m4a');
      form.append('model', step.model);
      if (request.language) form.append('language', request.language);
      if (request.prompt) form.append('prompt', request.prompt);
      const response = await fetchRetryable(`${this.baseUrl}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form }, { fetcher: this.fetcher, timeoutMs: 30_000, maxAttempts: 2, initialDelay: 250, maxDelay: 4_000, jitter: true });
      const body = await parseGroqResponse(response) as { text?: string };
      return { text: requireNonEmptyText(body.text ?? '', 'transcript'), provider: step.id, model: step.model, attempts: [{ step: step.id, provider: 'groq', capability: step.capability, status: PROVIDER_STATUS.SUCCESS, retryable: false, message: 'ok' }] };
    } catch (error) { throw Object.assign(error instanceof Error ? error : new Error('Transcription failed'), { providerAttempt: attemptFromError(step, error) }); }
  }

  public async chat(step: ProviderStep, request: ChatRequest): Promise<ChatResult> {
    if (step.capability !== AI_CAPABILITY.CHAT) throw new Error('Invalid provider capability for chat');
    const key = this.config.apiKeys[step.keyIndex];
    if (!key) throw new Error('Provider key missing');
    try {
      const messages = request.messages.map((m) => ({ role: m.role, content: cleanFlatText(m.content) })).filter((m) => m.content.length > 0);
      if (request.transcript) messages.push({ role: 'user', content: cleanFlatText(request.transcript) });
      const response = await fetchRetryable(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: step.model, messages, temperature: request.temperature ?? 0.3 }) }, { fetcher: this.fetcher, timeoutMs: 30_000, maxAttempts: 2, initialDelay: 250, maxDelay: 4_000, jitter: true });
      const body = await parseGroqResponse(response) as { choices?: Array<{ message?: { content?: string } }> };
      return { reply: requireNonEmptyText(body.choices?.[0]?.message?.content ?? '', 'assistant reply'), provider: step.id, model: step.model, attempts: [{ step: step.id, provider: 'groq', capability: step.capability, status: PROVIDER_STATUS.SUCCESS, retryable: false, message: 'ok' }] };
    } catch (error) { throw Object.assign(error instanceof Error ? error : new Error('Chat failed'), { providerAttempt: attemptFromError(step, error) }); }
  }

  public async synthesize(step: ProviderStep, request: SpeechRequest): Promise<SpeechResult> {
    if (step.capability !== AI_CAPABILITY.TTS) throw new Error('Invalid provider capability for speech synthesis');
    const key = this.config.apiKeys[step.keyIndex];
    if (!key) throw new Error('Provider key missing');
    try {
      const responseFormat = request.responseFormat ?? this.config.ttsResponseFormat;
      const response = await fetchRetryable(`${this.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: step.model, input: requireNonEmptyText(request.text, 'speech text'), voice: request.voice ?? this.config.ttsVoice, response_format: responseFormat }),
      }, { fetcher: this.fetcher, timeoutMs: 30_000, maxAttempts: 2, initialDelay: 250, maxDelay: 4_000, jitter: true });
      const contentType = response.headers.get('content-type')?.split(';', 1)[0] ?? '';
      if (contentType.startsWith('audio/')) {
        return { audio: new Uint8Array(await response.arrayBuffer()), mimeType: responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg', provider: step.id, model: step.model, attempts: [{ step: step.id, provider: 'groq', capability: step.capability, status: PROVIDER_STATUS.SUCCESS, retryable: false, message: 'ok' }] };
      }
      const body = await response.json() as { audio?: unknown; audioBase64?: unknown };
      const encoded = typeof body.audioBase64 === 'string' ? body.audioBase64 : body.audio;
      if (typeof encoded !== 'string' || !encoded.trim()) throw new Error('Groq TTS response did not contain audio');
      return { audio: Uint8Array.from(Buffer.from(encoded, 'base64')), mimeType: responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg', provider: step.id, model: step.model, attempts: [{ step: step.id, provider: 'groq', capability: step.capability, status: PROVIDER_STATUS.SUCCESS, retryable: false, message: 'ok' }] };
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error('Speech synthesis failed'), { providerAttempt: attemptFromError(step, error) });
    }
  }
}
