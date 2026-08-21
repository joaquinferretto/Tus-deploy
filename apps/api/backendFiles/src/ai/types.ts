export const AI_CAPABILITY = { STT: 'stt', CHAT: 'chat', TTS: 'tts' } as const;
export type AiCapability = (typeof AI_CAPABILITY)[keyof typeof AI_CAPABILITY];

export const PROVIDER_STATUS = { SUCCESS: 'success', FAILED: 'failed', SKIPPED: 'skipped' } as const;
export type ProviderStatus = (typeof PROVIDER_STATUS)[keyof typeof PROVIDER_STATUS];

export const PROVIDER_ERROR_CATEGORY = { QUOTA: 'quota', AUTH: 'auth', RATE_LIMIT: 'rate_limit', TRANSIENT: 'transient', VALIDATION: 'validation', UNKNOWN: 'unknown' } as const;
export type ProviderErrorCategory = (typeof PROVIDER_ERROR_CATEGORY)[keyof typeof PROVIDER_ERROR_CATEGORY];

export interface CompanionMessage { id?: string; role: 'system' | 'user' | 'assistant'; content: string; createdAt?: string; }
export interface ProviderAttempt { step: string; provider: 'groq'; capability: AiCapability; status: ProviderStatus; code?: string; httpStatus?: number; retryable: boolean; category?: ProviderErrorCategory; message: string; }
export interface ProviderStep { id: 'groq1' | 'groq2'; provider: 'groq'; keyIndex: 0 | 1; model: string; capability: AiCapability; }
export interface TranscriptionRequest { audio: ArrayBuffer | Buffer | Uint8Array; mimeType?: string; fileName?: string; language?: string; prompt?: string; }
export interface TranscriptionResult { text: string; provider: ProviderStep['id']; model: string; attempts: ProviderAttempt[]; }
export interface ChatRequest { sessionId: string; messages: CompanionMessage[]; transcript?: string; temperature?: number; }
export interface ChatResult { reply: string; provider: ProviderStep['id']; model: string; attempts: ProviderAttempt[]; }
export interface SpeechRequest { text: string; voice?: string; responseFormat?: 'wav' | 'mp3'; }
export interface SpeechResult { audio: Uint8Array; mimeType: 'audio/wav' | 'audio/mpeg'; provider: ProviderStep['id']; model: string; attempts: ProviderAttempt[]; }
export interface TerminalProviderError extends Error { code: 'AI_PROVIDER_CHAIN_FAILED'; attempts: ProviderAttempt[]; retryable: boolean; }
export interface GroqProviderConfig { apiKeys: [string, string?]; sttModel: string; chatModel: string; ttsModel: string; ttsVoice: string; ttsResponseFormat: 'wav' | 'mp3'; baseUrl?: string; }
