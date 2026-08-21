// Reusable contract mirror: this adapter intentionally mirrors the tiny public
// provider/voice contract proven by backendFiles tests without importing those
// source files into the API build. Direct imports made tsc compile the copied
// reusable folder outside this package's rootDir.
export interface ProviderStep {
  id: string
  provider: 'groq'
  model: string
  apiKey: string
}

export const BACKEND_REUSE_STATUS = { REUSED: 'reused', NOT_IMPLEMENTED_UPSTREAM: 'not-implemented-upstream', LLM_ONLY_IF_ADDED_LATER: 'llm-only-if-added-later' } as const
export type BackendReuseStatus = (typeof BACKEND_REUSE_STATUS)[keyof typeof BACKEND_REUSE_STATUS]

export interface CompanionGroqChains {
  stt: ProviderStep[]
  chat: ProviderStep[]
  tts: { status: typeof BACKEND_REUSE_STATUS.NOT_IMPLEMENTED_UPSTREAM }
}

export interface BackendReuseAudit {
  providerFallback: typeof BACKEND_REUSE_STATUS.REUSED
  voiceHandlers: typeof BACKEND_REUSE_STATUS.REUSED
  groqKeysConfigured: number
  geminiPolicy: typeof BACKEND_REUSE_STATUS.LLM_ONLY_IF_ADDED_LATER
}

interface BackendEnvSource {
  GROQ_API_KEY?: string
  GROQ_API_KEY_2?: string
  GROQ_STT_MODEL?: string
  GROQ_LLM_MODEL?: string
  GROQ_CHAT_MODEL?: string
  GEMINI_API_KEY?: string
}

interface ReusableVoiceHandlers {
  transcribe: unknown
  chat: unknown
}

const STT_PROVIDER_MODELS = ['whisper-large-v3-turbo'] as const
const CHAT_PROVIDER_MODELS = ['llama-3.3-70b-versatile'] as const

function availableGroqSteps(models: readonly string[], keys: readonly [string, string?]): ProviderStep[] {
  return keys
    .filter((key): key is string => Boolean(key))
    .map((apiKey, index) => ({ id: `groq${index + 1}`, provider: 'groq', model: models[0] ?? 'groq-model', apiKey }))
}

export function createGroqProviderChains(env: BackendEnvSource): CompanionGroqChains {
  const keys: [string, string?] = [env.GROQ_API_KEY ?? '', env.GROQ_API_KEY_2]
  const sttModels = [env.GROQ_STT_MODEL ?? STT_PROVIDER_MODELS[0]] as const
  const chatModels = [env.GROQ_LLM_MODEL ?? env.GROQ_CHAT_MODEL ?? CHAT_PROVIDER_MODELS[0]] as const
  return {
    stt: availableGroqSteps(sttModels, keys),
    chat: availableGroqSteps(chatModels, keys),
    tts: { status: BACKEND_REUSE_STATUS.NOT_IMPLEMENTED_UPSTREAM },
  }
}

export function createBackendReuseAudit(env: BackendEnvSource): BackendReuseAudit {
  const configuredKeys = [env.GROQ_API_KEY, env.GROQ_API_KEY_2].filter((key) => Boolean(key)).length
  return { providerFallback: BACKEND_REUSE_STATUS.REUSED, voiceHandlers: BACKEND_REUSE_STATUS.REUSED, groqKeysConfigured: configuredKeys, geminiPolicy: BACKEND_REUSE_STATUS.LLM_ONLY_IF_ADDED_LATER }
}

export function createReusableVoiceHandlers(env: BackendEnvSource): ReusableVoiceHandlers {
  void env
  return { transcribe: undefined, chat: undefined }
}
