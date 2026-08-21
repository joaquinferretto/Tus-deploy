import type { TerminalProviderError } from '../ai/types';
export interface SafeClientError { code: string; message: string; retryable: boolean; attempts?: TerminalProviderError['attempts']; }
export function isTerminalProviderError(error: unknown): error is TerminalProviderError { return typeof error === 'object' && error !== null && (error as TerminalProviderError).code === 'AI_PROVIDER_CHAIN_FAILED'; }
export function toSafeClientError(error: unknown): SafeClientError { if (isTerminalProviderError(error)) return { code: error.code, message: 'Voice provider temporarily unavailable. Please retry.', retryable: error.retryable, attempts: error.attempts }; return { code: 'VOICE_REQUEST_FAILED', message: 'Voice request failed.', retryable: false }; }
