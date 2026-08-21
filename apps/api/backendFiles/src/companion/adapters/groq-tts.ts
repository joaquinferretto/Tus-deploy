import { Buffer } from 'node:buffer'
import { AUDIO_SOURCE } from '@repo/zod-schemas'
import Groq from 'groq-sdk'
import type { CompanionSpeechRef } from '../ai-ports'
import type { ProviderStep } from './backend-reuse'

export const GROQ_TTS_DEFAULTS = {
  MODEL: 'canopylabs/orpheus-v1-english',
  VOICE: 'hannah',
  RESPONSE_FORMAT: 'wav',
} as const

const GROQ_TTS_MIME_TYPE = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
} as const

type GroqTtsResponseFormat = keyof typeof GROQ_TTS_MIME_TYPE

interface GroqSpeechCreateParams {
  model: string
  voice: string
  response_format: GroqTtsResponseFormat
  input: string
}

interface GroqSpeechResponse {
  arrayBuffer(): Promise<ArrayBuffer>
}

interface GroqSpeechClient {
  audio: {
    speech: {
      create(params: GroqSpeechCreateParams): Promise<GroqSpeechResponse>
    }
  }
}

export interface GroqTtsAdapterConfig {
  apiKey: string
  model?: string
  voice?: string
  responseFormat?: string
}

export interface GroqTtsAdapter {
  synthesizeSpeech(text: string, step: ProviderStep): Promise<CompanionSpeechRef>
}

export function createGroqTtsAdapter(config: GroqTtsAdapterConfig): GroqTtsAdapter {
  const responseFormat = normalizeResponseFormat(config.responseFormat)
  const client = new Groq({ apiKey: config.apiKey }) as unknown as GroqSpeechClient

  return {
    async synthesizeSpeech(text) {
      const model = config.model ?? GROQ_TTS_DEFAULTS.MODEL
      const response = await client.audio.speech.create({
        model,
        voice: config.voice ?? GROQ_TTS_DEFAULTS.VOICE,
        response_format: responseFormat,
        input: text,
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      const id = `groq-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      return {
        id,
        source: AUDIO_SOURCE.TTS,
        url: `/companion/media/${id}`,
        mimeType: GROQ_TTS_MIME_TYPE[responseFormat],
        status: 'available',
        text,
        bytes,
      }
    },
  }
}

function normalizeResponseFormat(format: string | undefined): GroqTtsResponseFormat {
  if (format === 'mp3') return format
  return GROQ_TTS_DEFAULTS.RESPONSE_FORMAT
}
