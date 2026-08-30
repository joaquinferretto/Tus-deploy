const AUDIO_ACTIVATION_VALUES = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
} as const

export const AUDIO_ACTIVATION = AUDIO_ACTIVATION_VALUES
export type AudioActivation = (typeof AUDIO_ACTIVATION)[keyof typeof AUDIO_ACTIVATION]

export interface AudioLineage {
  tenantId: string
  actorId: string
  correlationId: string
  rootMessageId: string
  source: string
}

export interface AudioRetention {
  expiresAt: number
  encrypted: true
  keyRef: string
  algorithm: string
}

export interface AudioUsage {
  inputBytes: number
  outputBytes: number
  estimatedCostUsd: number
}

export interface SttRequest {
  audio: Uint8Array
  mimeType: string
  model: string
  lineage: AudioLineage
}

export interface SttResponse {
  text: string
  provider: string
  model: string
  mimeType: string
  usage: AudioUsage
  lineage: AudioLineage
  retention: AudioRetention
}

export interface TtsRequest {
  text: string
  voice: string
  responseFormat: 'wav' | 'mp3'
  model: string
  lineage: AudioLineage
}

export interface TtsResponse {
  audio: Uint8Array
  provider: string
  model: string
  mimeType: 'audio/wav' | 'audio/mpeg'
  usage: AudioUsage
  lineage: AudioLineage
  retention: AudioRetention
}

export interface SpeechToTextPort {
  transcribe(request: SttRequest): Promise<SttResponse>
}

export interface TextToSpeechPort {
  synthesize(request: TtsRequest): Promise<TtsResponse>
}

export interface GroqAudioTransport {
  stt(request: SttRequest): Promise<string>
  tts(request: TtsRequest): Promise<Uint8Array>
}

export interface GroqAudioOptions {
  activation: AudioActivation
  configRef: string
  maxAudioBytes?: number
  maxTextChars?: number
  retention?: AudioRetention
}

export interface AudioQuotaRequest {
  tenantId: string
  requests: 1
  inputBytes: number
  outputBytes: number
  estimatedCostUsd: number
}

export interface AudioQuotaLease {
  id: string
  tenantId: string
}

export interface AudioQuotaPort {
  reserve(input: AudioQuotaRequest): Promise<AudioQuotaLease>
  commit(lease: AudioQuotaLease, usage: AudioUsage): Promise<void>
  release(lease: AudioQuotaLease): Promise<void>
}

export class AudioContractError extends Error {
  readonly code = 'AUDIO_CONTRACT_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'AudioContractError'
  }
}

export class GroqProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'

  constructor(message = 'Groq speech provider is gated until activation evidence exists') {
    super(message)
    this.name = 'GroqProviderUnavailableError'
  }
}

export class AudioProviderError extends Error {
  readonly code = 'AUDIO_PROVIDER_FAILED'

  constructor(message: string) {
    super(message)
    this.name = 'AudioProviderError'
  }
}

export interface DeterministicAudioOptions {
  retention: AudioRetention
  now?: number
  maxAudioBytes?: number
  maxTextChars?: number
  quota?: AudioQuotaPort
}

export class DeterministicAudioFake implements SpeechToTextPort, TextToSpeechPort {
  private readonly options: Required<Omit<DeterministicAudioOptions, 'quota'>> &
    Pick<DeterministicAudioOptions, 'quota'>

  constructor(options: DeterministicAudioOptions) {
    this.options = {
      ...options,
      now: options.now ?? 0,
      maxAudioBytes: options.maxAudioBytes ?? 10 * 1024 * 1024,
      maxTextChars: options.maxTextChars ?? 8_000,
    }
    assertRetention(options.retention)
  }

  async transcribe(request: SttRequest): Promise<SttResponse> {
    const mimeType = validateAudio(request, this.options.maxAudioBytes)
    const usage: AudioUsage = {
      inputBytes: request.audio.byteLength,
      outputBytes: 0,
      estimatedCostUsd: 0,
    }
    const lease = await reserve(this.options.quota, request.lineage.tenantId, usage)
    try {
      const response: SttResponse = {
        text: `fake transcript: ${request.audio.byteLength} bytes ${mimeType}`,
        provider: 'fake',
        model: request.model,
        mimeType,
        usage,
        lineage: request.lineage,
        retention: this.options.retention,
      }
      await commit(this.options.quota, lease, usage)
      return response
    } catch (error) {
      await release(this.options.quota, lease)
      throw error
    }
  }

  async synthesize(request: TtsRequest): Promise<TtsResponse> {
    const text = validateText(request, this.options.maxTextChars)
    const digest = await cryptoDigest(text)
    const audio = new TextEncoder().encode(`FAKE-AUDIO-V1:${digest.slice(0, 24)}`)
    const mimeType = request.responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav'
    const usage: AudioUsage = {
      inputBytes: 0,
      outputBytes: audio.byteLength,
      estimatedCostUsd: 0,
    }
    const lease = await reserve(this.options.quota, request.lineage.tenantId, usage)
    try {
      const response: TtsResponse = {
        audio,
        provider: 'fake',
        model: request.model,
        mimeType,
        usage,
        lineage: request.lineage,
        retention: this.options.retention,
      }
      await commit(this.options.quota, lease, usage)
      return response
    } catch (error) {
      await release(this.options.quota, lease)
      throw error
    }
  }
}

export class GroqSpeechAdapter implements SpeechToTextPort, TextToSpeechPort {
  readonly configRef: string
  private readonly options: Required<GroqAudioOptions>
  private readonly transport: GroqAudioTransport
  private readonly quota?: AudioQuotaPort

  constructor(transport: GroqAudioTransport, options: GroqAudioOptions, quota?: AudioQuotaPort) {
    if (!options.configRef.trim()) throw new AudioContractError('Groq config reference is required')
    const retention = options.retention ?? defaultRetention()
    assertRetention(retention)
    this.transport = transport
    this.quota = quota
    this.configRef = options.configRef
    this.options = {
      ...options,
      retention,
      maxAudioBytes: options.maxAudioBytes ?? 10 * 1024 * 1024,
      maxTextChars: options.maxTextChars ?? 8_000,
    }
  }

  async transcribe(request: SttRequest): Promise<SttResponse> {
    this.assertActive()
    const mimeType = validateAudio(request, this.options.maxAudioBytes)
    const usage: AudioUsage = {
      inputBytes: request.audio.byteLength,
      outputBytes: 0,
      estimatedCostUsd: 0.01,
    }
    const lease = await reserve(this.quota, request.lineage.tenantId, usage)
    try {
      const text = await this.callProvider(() => this.transport.stt(request), 'STT')
      const response: SttResponse = {
        text,
        provider: 'groq',
        model: request.model,
        mimeType,
        usage,
        lineage: request.lineage,
        retention: this.options.retention,
      }
      await commit(this.quota, lease, usage)
      return response
    } catch (error) {
      await release(this.quota, lease)
      throw error
    }
  }

  async synthesize(request: TtsRequest): Promise<TtsResponse> {
    this.assertActive()
    const text = validateText(request, this.options.maxTextChars)
    const usage: AudioUsage = {
      inputBytes: 0,
      outputBytes: 0,
      estimatedCostUsd: 0.01,
    }
    const lease = await reserve(this.quota, request.lineage.tenantId, usage)
    try {
      const audio = await this.callProvider(() => this.transport.tts(request), 'TTS')
      if (audio.byteLength === 0 || audio.byteLength > this.options.maxAudioBytes)
        throw new AudioProviderError('Groq TTS provider returned invalid audio')
      const response: TtsResponse = {
        audio,
        provider: 'groq',
        model: request.model,
        mimeType: request.responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        usage: { ...usage, outputBytes: audio.byteLength },
        lineage: request.lineage,
        retention: this.options.retention,
      }
      await commit(this.quota, lease, response.usage)
      return response
    } catch (error) {
      await release(this.quota, lease)
      throw error
    }
  }

  private assertActive(): void {
    if (this.options.activation !== AUDIO_ACTIVATION.ENABLED)
      throw new GroqProviderUnavailableError()
  }

  private async callProvider<T>(
    operation: () => Promise<T>,
    capability: 'STT' | 'TTS'
  ): Promise<T> {
    try {
      return await operation()
    } catch {
      throw new AudioProviderError(`Groq ${capability} provider request failed`)
    }
  }
}

function assertRetention(retention: AudioRetention): void {
  if (!retention.encrypted || !retention.keyRef.trim() || !retention.algorithm.trim())
    throw new AudioContractError('audio retention metadata is incomplete')
}

function defaultRetention(): AudioRetention {
  return {
    expiresAt: 86_400,
    encrypted: true,
    keyRef: 'deterministic-local-audio-key',
    algorithm: 'deterministic-local-envelope.v1',
  }
}

function validateAudio(request: SttRequest, maxAudioBytes: number): string {
  if (request.audio.byteLength === 0)
    throw new AudioContractError('audio payload must not be empty')
  if (request.audio.byteLength > maxAudioBytes)
    throw new AudioContractError('audio payload exceeds maximum configured size')
  const normalized = request.mimeType.split(';', 1)[0]?.toLowerCase() ?? ''
  if (
    ![
      'audio/aac',
      'audio/flac',
      'audio/mpeg',
      'audio/mp4',
      'audio/ogg',
      'audio/opus',
      'audio/wav',
      'audio/webm',
    ].includes(normalized)
  )
    throw new AudioContractError('audio payload uses an unsupported media type')
  return normalized
}

function validateText(request: TtsRequest, maxTextChars: number): string {
  if (!request.text.trim()) throw new AudioContractError('speech text is required')
  if (request.text.length > maxTextChars)
    throw new AudioContractError('speech text exceeds maximum configured size')
  if (!request.voice.trim()) throw new AudioContractError('speech voice is required')
  return request.text.trim()
}

async function cryptoDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function reserve(
  quota: AudioQuotaPort | undefined,
  tenantId: string,
  usage: AudioUsage
): Promise<AudioQuotaLease | undefined> {
  return quota?.reserve({ tenantId, requests: 1, ...usage })
}

async function commit(
  quota: AudioQuotaPort | undefined,
  lease: AudioQuotaLease | undefined,
  usage: AudioUsage
): Promise<void> {
  if (quota && lease) await quota.commit(lease, usage)
}

async function release(
  quota: AudioQuotaPort | undefined,
  lease: AudioQuotaLease | undefined
): Promise<void> {
  if (quota && lease) await quota.release(lease)
}

export default { AUDIO_ACTIVATION, DeterministicAudioFake, GroqSpeechAdapter }

export * from './neutral.ts'
