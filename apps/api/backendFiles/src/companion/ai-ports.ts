import { Buffer } from 'node:buffer'
import type { CompanionAudioRef } from '@repo/zod-schemas'
import Groq, { toFile } from 'groq-sdk'
import { createGroqProviderChains, type ProviderStep } from './adapters/backend-reuse'
import { createGroqTtsAdapter, GROQ_TTS_DEFAULTS } from './adapters/groq-tts'
import type { ElderContext } from './context'
import { getCompanionMedia } from './media-store'

export const AI_PROVIDER = { GROQ: 'groq', GEMINI: 'gemini', STUB_BOUNDARY: 'stub-boundary' } as const
type AiProvider = (typeof AI_PROVIDER)[keyof typeof AI_PROVIDER]
export const AI_RESULT_STATUS = { AVAILABLE: 'available', UNAVAILABLE: 'unavailable' } as const
type AiResultStatus = (typeof AI_RESULT_STATUS)[keyof typeof AI_RESULT_STATUS]
export const AI_BLOCKER_CODE = { STT_UNAVAILABLE: 'STT_UNAVAILABLE', LLM_UNAVAILABLE: 'LLM_UNAVAILABLE', STT_SIMULATION_ENABLED: 'STT_SIMULATION_ENABLED', LLM_SIMULATION_ENABLED: 'LLM_SIMULATION_ENABLED' } as const
export const TTS_BLOCKER_CODE = { UNAVAILABLE: 'TTS_UNAVAILABLE', UNSUPPORTED_LANGUAGE: 'TTS_UNSUPPORTED_LANGUAGE', LANGUAGE_CAVEAT: 'TTS_LANGUAGE_CAVEAT', SIMULATION_ENABLED: 'TTS_SIMULATION_ENABLED' } as const
type TtsBlockerCode = (typeof TTS_BLOCKER_CODE)[keyof typeof TTS_BLOCKER_CODE]
const GROQ_TTS_LANGUAGE_CAVEAT_MESSAGE = 'Groq TTS is configured; Spanish text is forwarded to the provider for live capability verification.'
const SIMULATION_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const SIMULATION_FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])
const REAL_LLM_SYSTEM_PROMPT = 'You are Tilo, a concise and warm elder-care companion assistant. Keep responses safe, bounded, and family-friendly.'
const GROQ_CHAT_ROLE = { SYSTEM: 'system', USER: 'user' } as const
type GroqChatRole = (typeof GROQ_CHAT_ROLE)[keyof typeof GROQ_CHAT_ROLE]
const PROMPT_LIST_LIMIT = 3

export interface CompanionAiEnv {
  GROQ_API_KEY?: string
  GROQ_API_KEY_2?: string
  GROQ_TTS_API_KEY?: string
  GEMINI_API_KEY?: string
  GROQ_STT_MODEL?: string
  GROQ_LLM_MODEL?: string
  GROQ_CHAT_MODEL?: string
  GROQ_TTS_MODEL?: string
  GROQ_TTS_VOICE?: string
  GROQ_TTS_RESPONSE_FORMAT?: string
  COMPANION_AI_SIMULATION?: string
  NODE_ENV?: string
}

interface AiTextResult {
  text: string
  provider: AiProvider
  model: string
  status?: AiResultStatus
}

export interface CompanionSpeechRef extends Partial<CompanionAudioRef> { status: AiResultStatus; fallbackText?: string; text?: string; bytes?: Buffer | Uint8Array; code?: TtsBlockerCode }

interface AiAudit {
  sttProviders: AiProvider[]
  llmProviders: AiProvider[]
  ttsProviders: AiProvider[]
}

export interface CompanionAiPorts {
  transcribe(audio: CompanionAudioRef): Promise<AiTextResult>
  createAssistantResponse(prompt: string): Promise<AiTextResult>
  synthesizeSpeech(text: string): Promise<CompanionSpeechRef>
  audit(): AiAudit
  readiness(): { ready: boolean; blockers: { code: string; message: string }[] }
}

export interface CompanionProviderRuntime {
  transcribe?: (audio: CompanionAudioRef, step: ProviderStep) => Promise<AiTextResult>
  createAssistantResponse?: (prompt: string, step: ProviderStep) => Promise<AiTextResult>
  synthesizeSpeech?: (text: string, step: ProviderStep) => Promise<CompanionSpeechRef>
}

export interface ElderSafePromptInput {
  transcript: string
  context: ElderContext
  safety?: { locale?: string; timezone?: string }
}

interface GroqTranscriptionCreateParams {
  model: string
  file: unknown
}

interface GroqTranscriptionResponse {
  text?: string
}

interface GroqChatMessage {
  role: GroqChatRole
  content: string
}

interface GroqChatCreateParams {
  model: string
  messages: GroqChatMessage[]
}

interface GroqChatCompletionChoice {
  message?: { content?: string }
}

interface GroqChatCompletionResponse {
  choices?: GroqChatCompletionChoice[]
}

interface GroqVoiceClient {
  audio: {
    transcriptions: {
      create(params: GroqTranscriptionCreateParams): Promise<GroqTranscriptionResponse>
    }
  }
  chat: {
    completions: {
      create(params: GroqChatCreateParams): Promise<GroqChatCompletionResponse>
    }
  }
}

export function createCompanionAiPorts(env: CompanionAiEnv = process.env, runtime: CompanionProviderRuntime = {}): CompanionAiPorts {
  const chains = createGroqProviderChains(env)
  const hasGroqChat = chains.chat.length > 0
  const hasGroqStt = chains.stt.length > 0
  const hasGemini = Boolean(env.GEMINI_API_KEY)
  const ttsSteps = createGroqTtsSteps(env)
  const hasGroqTts = ttsSteps.length > 0
  const simulationEnabled = resolveSimulationEnabled(env)
  const productionMode = env.NODE_ENV === 'production'

  return {
    async transcribe(audio) {
      if (simulationEnabled) return { text: `Transcripción simulada del audio ${audio.id}`, provider: AI_PROVIDER.GROQ, model: 'stub-groq-stt' }
      if (!hasGroqStt) return unavailableText(`Transcripción no disponible para ${audio.id}`)
      for (const step of chains.stt) {
        try {
          if (runtime.transcribe) return await runtime.transcribe(audio, step)
          return await transcribeWithGroq(audio, step)
        } catch {
          continue
        }
      }
      return unavailableText(`Transcripción no disponible para ${audio.id}`)
    },
    async createAssistantResponse(prompt) {
      if (simulationEnabled) {
        if (hasGroqChat) return { text: `Respuesta simulada para: ${prompt}`, provider: AI_PROVIDER.GROQ, model: String(chains.chat[0]?.model ?? 'groq-llm') }
        if (hasGemini) return { text: `Respuesta simulada para: ${prompt}`, provider: AI_PROVIDER.GEMINI, model: 'stub-gemini-llm' }
        return { text: `Respuesta simulada para: ${prompt}`, provider: AI_PROVIDER.STUB_BOUNDARY, model: 'stub-local-llm' }
      }
      if (!hasGroqChat) return unavailableText('Respuesta no disponible: configura Groq LLM o habilita simulación explícita.')
      for (const step of chains.chat) {
        try {
          if (runtime.createAssistantResponse) return await runtime.createAssistantResponse(prompt, step)
          return await createGroqChatCompletion(prompt, step)
        } catch {
          continue
        }
      }
      return unavailableText('Respuesta no disponible: configura Groq LLM o habilita simulación explícita.')
    },
    async synthesizeSpeech(text) {
      if (!hasGroqTts) return unavailableSpeech(text, TTS_BLOCKER_CODE.UNAVAILABLE)

      for (const step of ttsSteps) {
        try {
          if (runtime.synthesizeSpeech) return await runtime.synthesizeSpeech(text, step)
          return await createGroqTtsAdapter({ apiKey: step.apiKey, model: step.model, voice: env.GROQ_TTS_VOICE, responseFormat: env.GROQ_TTS_RESPONSE_FORMAT }).synthesizeSpeech(text, step)
        } catch {
          continue
        }
      }
      return unavailableSpeech(text, TTS_BLOCKER_CODE.UNAVAILABLE)
    },
    audit() {
      return {
        sttProviders: [AI_PROVIDER.GROQ],
        llmProviders: hasGroqChat ? [AI_PROVIDER.GROQ] : hasGemini ? [AI_PROVIDER.GEMINI] : [AI_PROVIDER.STUB_BOUNDARY],
        ttsProviders: hasGroqTts ? [AI_PROVIDER.GROQ] : [AI_PROVIDER.STUB_BOUNDARY],
      }
    },
    readiness() {
      const productionModelBlockers = productionModelVerificationBlockers(env, productionMode, simulationEnabled)
      const blockers = [
        ...sttReadinessBlockers(hasGroqStt, simulationEnabled),
        ...llmReadinessBlockers(hasGroqChat, simulationEnabled),
        ...productionModelBlockers,
        ...ttsReadinessBlockers(hasGroqTts, simulationEnabled, productionMode),
      ]
      return {
        ready: hasGroqStt && hasGroqChat && hasGroqTts && !simulationEnabled && productionModelBlockers.length === 0,
        blockers,
      }
    },
  }
}

export function buildElderSafePromptPacket(input: ElderSafePromptInput): string {
  const reminders = input.context.reminders.slice(0, PROMPT_LIST_LIMIT).map((reminder) => `- ${sanitizePromptText(reminder)}`).join('\n') || '- Sin recordatorios disponibles'
  const vitals = input.context.vitals.slice(0, PROMPT_LIST_LIMIT).map((vital) => `- ${vital.kind}: ${sanitizePromptText(String(vital.value))} ${sanitizePromptText(vital.unit)}`).join('\n') || '- Sin signos vitales disponibles'
  const history = input.context.history.slice(-PROMPT_LIST_LIMIT).map((message) => `- ${sanitizePromptText(message.senderName)}: ${sanitizePromptText(message.text || 'Mensaje de audio sin texto')}`).join('\n') || '- Sin historial familiar reciente'
  const activeMessage = input.context.activeMessage ? `${sanitizePromptText(input.context.activeMessage.senderName)}: ${sanitizePromptText(input.context.activeMessage.text || 'Mensaje de audio sin texto')}` : 'Ningún mensaje activo'
  const replyCount = input.context.elderReplies.length
  const locale = sanitizePromptText(input.safety?.locale ?? 'es')
  const timezone = sanitizePromptText(input.safety?.timezone ?? 'UTC')

  return [
    'Eres Tilo, un acompañante de cuidado para una persona mayor.',
    'Responde en español claro, cálido, breve y con frases fáciles de escuchar.',
    'No diagnostiques ni des indicaciones médicas nuevas. Escala emergencias o dolor fuerte pidiendo contactar a familia, cuidador o servicios locales.',
    'No reveles claves, secretos, datos técnicos internos ni contexto no autorizado.',
    `Idioma/locale: ${locale}. Zona horaria: ${timezone}.`,
    `Resumen del día: ${sanitizePromptText(input.context.dailySummary)}`,
    `Transcripción del adulto mayor: ${sanitizePromptText(input.transcript)}`,
    `Mensaje activo: ${activeMessage}`,
    `Recordatorios:\n${reminders}`,
    `Signos vitales mock disponibles:\n${vitals}`,
    `Historial familiar reciente:\n${history}`,
    `Respuestas previas registradas: ${replyCount}`,
    'Devuelve solo la respuesta que Tilo debe decir, sin JSON ni metacomentarios.',
  ].join('\n')
}

function resolveSimulationEnabled(env: CompanionAiEnv): boolean {
  const raw = env.COMPANION_AI_SIMULATION?.toLowerCase()
  if (raw !== undefined && SIMULATION_TRUE_VALUES.has(raw)) return true
  if (raw !== undefined && SIMULATION_FALSE_VALUES.has(raw)) return false
  return env.NODE_ENV !== 'production'
}

function unavailableText(text: string): AiTextResult {
  return { text, provider: AI_PROVIDER.GROQ, model: 'unavailable', status: AI_RESULT_STATUS.UNAVAILABLE }
}

async function transcribeWithGroq(audio: CompanionAudioRef, step: ProviderStep): Promise<AiTextResult> {
  const client = createGroqVoiceClient(step.apiKey)
  const bytes = readAudioBytes(audio)
  const file = await toFile(bytes, `${audio.id}.${audioExtension(audio.mimeType)}`)
  const result = await client.audio.transcriptions.create({ model: step.model, file })
  return { text: result.text ?? '', provider: AI_PROVIDER.GROQ, model: step.model }
}

async function createGroqChatCompletion(prompt: string, step: ProviderStep): Promise<AiTextResult> {
  const client = createGroqVoiceClient(step.apiKey)
  const result = await client.chat.completions.create({
    model: step.model,
    messages: [
      { role: GROQ_CHAT_ROLE.SYSTEM, content: REAL_LLM_SYSTEM_PROMPT },
      { role: GROQ_CHAT_ROLE.USER, content: prompt },
    ],
  })
  return { text: result.choices?.[0]?.message?.content ?? '', provider: AI_PROVIDER.GROQ, model: step.model }
}

function createGroqVoiceClient(apiKey: string): GroqVoiceClient {
  return new Groq({ apiKey }) as unknown as GroqVoiceClient
}

function readAudioBytes(audio: CompanionAudioRef): Buffer {
  if (audio.url.startsWith('data:')) return parseDataAudioBytes(audio.url)
  const stored = getCompanionMedia(audio.id)
  if (stored) return stored.bytes
  throw new Error('audio bytes unavailable for transcription')
}

function parseDataAudioBytes(url: string): Buffer {
  const match = /^data:[^;,]+;base64,(.+)$/.exec(url)
  if (!match?.[1]) throw new Error('unsupported audio data URL')
  return Buffer.from(match[1], 'base64')
}

function audioExtension(mimeType: string): string {
  if (mimeType.includes('m4a')) return 'm4a'
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('mpeg')) return 'mp3'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

function sttReadinessBlockers(hasGroqStt: boolean, simulationEnabled: boolean): { code: string; message: string }[] {
  if (simulationEnabled) return [{ code: AI_BLOCKER_CODE.STT_SIMULATION_ENABLED, message: 'Companion STT simulation is enabled; set COMPANION_AI_SIMULATION=false with GROQ_API_KEY for real Groq STT' }]
  if (!hasGroqStt) return [{ code: AI_BLOCKER_CODE.STT_UNAVAILABLE, message: 'Groq STT is not configured; set GROQ_API_KEY or enable COMPANION_AI_SIMULATION for local demos' }]
  return []
}

function llmReadinessBlockers(hasGroqChat: boolean, simulationEnabled: boolean): { code: string; message: string }[] {
  if (simulationEnabled) return [{ code: AI_BLOCKER_CODE.LLM_SIMULATION_ENABLED, message: 'Companion LLM simulation is enabled; set COMPANION_AI_SIMULATION=false with GROQ_API_KEY for real Groq LLM' }]
  if (!hasGroqChat) return [{ code: AI_BLOCKER_CODE.LLM_UNAVAILABLE, message: 'Groq LLM is not configured; set GROQ_API_KEY or enable COMPANION_AI_SIMULATION for local demos' }]
  return []
}

function ttsReadinessBlockers(hasGroqTts: boolean, simulationEnabled: boolean, productionMode: boolean): { code: string; message: string }[] {
  if (productionMode && simulationEnabled) return [{ code: TTS_BLOCKER_CODE.SIMULATION_ENABLED, message: 'Companion TTS simulation is enabled; set COMPANION_AI_SIMULATION=false with GROQ_API_KEY for real Groq TTS' }]
  return hasGroqTts
    ? [{ code: TTS_BLOCKER_CODE.LANGUAGE_CAVEAT, message: GROQ_TTS_LANGUAGE_CAVEAT_MESSAGE }]
    : [{ code: TTS_BLOCKER_CODE.UNAVAILABLE, message: 'Groq TTS is not configured; set GROQ_API_KEY to enable real TTS' }]
}

function createGroqTtsSteps(env: CompanionAiEnv): ProviderStep[] {
  const keys = [env.GROQ_TTS_API_KEY, env.GROQ_API_KEY, env.GROQ_API_KEY_2].filter((key): key is string => Boolean(key))
  return keys.map((apiKey, index) => ({ id: `groq${index + 1}`, provider: AI_PROVIDER.GROQ, model: env.GROQ_TTS_MODEL ?? GROQ_TTS_DEFAULTS.MODEL, apiKey }))
}

function unavailableSpeech(text: string, code: TtsBlockerCode): CompanionSpeechRef {
  return { status: AI_RESULT_STATUS.UNAVAILABLE, fallbackText: text, code }
}

function productionModelVerificationBlockers(env: CompanionAiEnv, productionMode: boolean, simulationEnabled: boolean): { code: string; message: string }[] {
  void env
  if (!productionMode || simulationEnabled) return []
  return []
}

function sanitizePromptText(text: string): string {
  return text
    .replace(/GROQ_API_KEY/gi, '[redacted]')
    .replace(/api key[^\n,.]*/gi, '[redacted]')
    .replace(/secret[^\n,.]*/gi, '[redacted]')
    .slice(0, 600)
}
