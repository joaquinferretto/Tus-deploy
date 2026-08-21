import type { GroqProviderConfig } from '../ai/types';

export interface BackendEnv { port: number; corsOrigin: string; maxAudioMb: number; groq: GroqProviderConfig; }
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
export function loadBackendEnv(): BackendEnv {
  return {
    port: Number(process.env.PORT ?? 3000),
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    maxAudioMb: Number(process.env.MAX_AUDIO_MB ?? 25),
    groq: { apiKeys: [required('GROQ_API_KEY'), process.env.GROQ_API_KEY_FALLBACK], sttModel: process.env.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo', chatModel: process.env.GROQ_CHAT_MODEL ?? 'llama-3.3-70b-versatile', ttsModel: process.env.GROQ_TTS_MODEL ?? 'canopylabs/orpheus-v1-english', ttsVoice: process.env.GROQ_TTS_VOICE ?? 'hannah', ttsResponseFormat: process.env.GROQ_TTS_RESPONSE_FORMAT === 'mp3' ? 'mp3' : 'wav' },
  };
}
