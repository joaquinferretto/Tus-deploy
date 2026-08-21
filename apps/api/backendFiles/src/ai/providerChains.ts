import { AI_CAPABILITY, type ProviderStep } from './types.js';

export const STT_PROVIDER_CHAIN: ProviderStep[] = [
  { id: 'groq1', provider: 'groq', keyIndex: 0, model: process.env['GROQ_STT_MODEL'] ?? 'whisper-large-v3-turbo', capability: AI_CAPABILITY.STT },
  { id: 'groq2', provider: 'groq', keyIndex: 1, model: process.env['GROQ_STT_MODEL'] ?? 'whisper-large-v3-turbo', capability: AI_CAPABILITY.STT },
];

export const CHAT_PROVIDER_CHAIN: ProviderStep[] = [
  { id: 'groq1', provider: 'groq', keyIndex: 0, model: process.env['GROQ_CHAT_MODEL'] ?? 'llama-3.3-70b-versatile', capability: AI_CAPABILITY.CHAT },
  { id: 'groq2', provider: 'groq', keyIndex: 1, model: process.env['GROQ_CHAT_MODEL'] ?? 'llama-3.3-70b-versatile', capability: AI_CAPABILITY.CHAT },
];

export const TTS_PROVIDER_CHAIN: ProviderStep[] = [
  { id: 'groq1', provider: 'groq', keyIndex: 0, model: process.env['GROQ_TTS_MODEL'] ?? 'canopylabs/orpheus-v1-english', capability: AI_CAPABILITY.TTS },
  { id: 'groq2', provider: 'groq', keyIndex: 1, model: process.env['GROQ_TTS_MODEL'] ?? 'canopylabs/orpheus-v1-english', capability: AI_CAPABILITY.TTS },
];

export interface GroqKeyEnvironment {
  GROQ_API_KEY?: string;
  GROQ_API_KEY_PRIMARY?: string;
  GROQ_API_KEY_FALLBACK?: string;
  GROQ_API_KEY_2?: string;
}

/** Normalize supported primary/fallback aliases without ever returning a secret in diagnostics. */
export function normalizeGroqApiKeys(env: GroqKeyEnvironment): [string, string?] {
  const primary = (env.GROQ_API_KEY_PRIMARY ?? env.GROQ_API_KEY ?? '').trim();
  const fallback = (env.GROQ_API_KEY_FALLBACK ?? env.GROQ_API_KEY_2 ?? '').trim();
  return [primary, fallback || undefined];
}

export function availableGroqSteps(chain: ProviderStep[], keys: [string, string?]): ProviderStep[] {
  return chain.filter((step) => Boolean(keys[step.keyIndex]));
}
