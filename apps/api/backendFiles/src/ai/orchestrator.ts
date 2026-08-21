import { GroqProvider } from './groq.provider.js';
import { availableGroqSteps, CHAT_PROVIDER_CHAIN, STT_PROVIDER_CHAIN, TTS_PROVIDER_CHAIN } from './providerChains.js';
import { PROVIDER_ERROR_CATEGORY, PROVIDER_STATUS, type ChatRequest, type ChatResult, type GroqProviderConfig, type ProviderAttempt, type ProviderStep, type SpeechRequest, type SpeechResult, type TerminalProviderError, type TranscriptionRequest, type TranscriptionResult } from './types.js';

interface ErrorWithAttempt extends Error { providerAttempt?: ProviderAttempt; }

function missingAttempt(step: ProviderStep): ProviderAttempt { return { step: step.id, provider: 'groq', capability: step.capability, status: PROVIDER_STATUS.SKIPPED, code: 'GROQ_KEY_NOT_CONFIGURED', retryable: false, category: PROVIDER_ERROR_CATEGORY.AUTH, message: 'Provider key not configured' }; }

function terminalError(attempts: ProviderAttempt[]): TerminalProviderError {
  const error = new Error('All provider attempts failed') as TerminalProviderError;
  error.code = 'AI_PROVIDER_CHAIN_FAILED';
  error.attempts = attempts;
  error.retryable = attempts.some((attempt) => attempt.retryable);
  return error;
}

export class ProviderOrchestrator {
  private readonly provider: GroqProvider;
  private readonly keys: [string, string?];
  public constructor(config: GroqProviderConfig, fetcher?: typeof fetch) { this.keys = config.apiKeys; this.provider = new GroqProvider(config, fetcher); }

  public async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const attempts: ProviderAttempt[] = [];
    for (const step of STT_PROVIDER_CHAIN) {
      if (!this.provider.hasKey(step)) { attempts.push(missingAttempt(step)); continue; }
      try { const result = await this.provider.transcribe(step, request); return { ...result, attempts: [...attempts, ...result.attempts] }; }
      catch (error) { attempts.push((error as ErrorWithAttempt).providerAttempt ?? missingAttempt(step)); }
    }
    throw terminalError(attempts);
  }

  public async chat(request: ChatRequest): Promise<ChatResult> {
    const attempts: ProviderAttempt[] = [];
    for (const step of availableGroqSteps(CHAT_PROVIDER_CHAIN, this.keys)) {
      try { const result = await this.provider.chat(step, request); return { ...result, attempts: [...attempts, ...result.attempts] }; }
      catch (error) { attempts.push((error as ErrorWithAttempt).providerAttempt ?? missingAttempt(step)); }
    }
    if (attempts.length === 0) attempts.push(...CHAT_PROVIDER_CHAIN.map(missingAttempt));
    throw terminalError(attempts);
  }

  public async synthesize(request: SpeechRequest): Promise<SpeechResult> {
    const attempts: ProviderAttempt[] = [];
    for (const step of availableGroqSteps(TTS_PROVIDER_CHAIN, this.keys)) {
      try { const result = await this.provider.synthesize(step, request); return { ...result, attempts: [...attempts, ...result.attempts] }; }
      catch (error) { attempts.push((error as ErrorWithAttempt).providerAttempt ?? missingAttempt(step)); }
    }
    if (attempts.length === 0) attempts.push(...TTS_PROVIDER_CHAIN.map(missingAttempt));
    throw terminalError(attempts);
  }
}
