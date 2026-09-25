// Groq (OpenAI-compatible) chat with local tool calling, plus optional Whisper transcription.
// The model never touches the database: it can only request tools, which the backend validates
// and executes with the actor's own authority. No Anthropic, no SDK: plain fetch.

import {
  crearPoolCredencialesGroq,
  GroqCredentialPoolUnavailableError,
  type GroqCredentialPool,
} from '../../providers/groq/index.ts'

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
// Production model with tool use and good Spanish (see console.groq.com/docs/tool-use).
export const GROQ_WHATSAPP_MODEL_POR_DEFECTO = 'openai/gpt-oss-120b'
export const GROQ_STT_MODEL_POR_DEFECTO = 'whisper-large-v3-turbo'

export type MensajeChat =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlamadaHerramienta[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string }

export interface LlamadaHerramienta {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface DefinicionHerramientaChat {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface RespuestaChat {
  content: string | null
  toolCalls: LlamadaHerramienta[]
  finishReason: string | null
  usage: { promptTokens: number; completionTokens: number } | null
  latencyMs: number
}

export interface ChatProvider {
  readonly id: string
  readonly model: string
  chat(input: {
    messages: MensajeChat[]
    tools?: DefinicionHerramientaChat[]
    maxTokens: number
    temperature?: number
  }): Promise<RespuestaChat>
}

export class ErrorChat extends Error {
  constructor(
    readonly code:
      'CHAT_UNAVAILABLE' | 'CHAT_RATE_LIMITED' | 'CHAT_TIMEOUT' | 'CHAT_INVALID_RESPONSE',
    message: string
  ) {
    super(message)
    this.name = 'ErrorChat'
  }
}

export class GroqChatProvider implements ChatProvider {
  readonly id = 'groq'
  private readonly pool: GroqCredentialPool

  constructor(
    private readonly options: {
      apiKey?: string
      pool?: GroqCredentialPool
      model?: string
      timeoutMs?: number
      baseUrl?: string
      fetch?: typeof fetch
    }
  ) {
    const pool =
      options.pool ??
      (options.apiKey
        ? crearPoolCredencialesGroq({ GROQ_API_KEY: options.apiKey }, { fetch: options.fetch })
        : null)
    if (!pool) throw new Error('GROQ_API_KEY is required for the WhatsApp assistant')
    this.pool = pool
  }

  get model() {
    return this.options.model || GROQ_WHATSAPP_MODEL_POR_DEFECTO
  }

  async chat(input: {
    messages: MensajeChat[]
    tools?: DefinicionHerramientaChat[]
    maxTokens: number
    temperature?: number
  }): Promise<RespuestaChat> {
    const started = Date.now()
    let response: Response
    try {
      response = await this.pool.request({
        url: `${this.options.baseUrl ?? GROQ_BASE_URL}/chat/completions`,
        idempotent: true,
        createInit: () => ({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            messages: input.messages,
            temperature: input.temperature ?? 0.2,
            max_completion_tokens: input.maxTokens,
            ...(input.tools && input.tools.length > 0
              ? { tools: input.tools, tool_choice: 'auto', parallel_tool_calls: false }
              : {}),
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        }),
      })
    } catch (error) {
      if (error instanceof GroqCredentialPoolUnavailableError)
        throw new ErrorChat('CHAT_UNAVAILABLE', 'Groq credentials are temporarily unavailable')
      throw new ErrorChat('CHAT_TIMEOUT', 'Groq request timed out or failed')
    }
    // The error body may echo prompt content: only the status is kept.
    if (response.status === 429) throw new ErrorChat('CHAT_RATE_LIMITED', 'Groq rate limit reached')
    if (!response.ok)
      throw new ErrorChat('CHAT_UNAVAILABLE', `Groq request failed with status ${response.status}`)
    const payload = (await response.json().catch(() => null)) as {
      choices?: {
        finish_reason?: string
        message?: { content?: string | null; tool_calls?: LlamadaHerramienta[] }
      }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    } | null
    const choice = payload?.choices?.[0]
    if (!choice?.message) throw new ErrorChat('CHAT_INVALID_RESPONSE', 'Groq returned no message')
    const toolCalls = (choice.message.tool_calls ?? []).filter(
      (call) =>
        call &&
        call.type === 'function' &&
        typeof call.id === 'string' &&
        typeof call.function?.name === 'string' &&
        typeof call.function?.arguments === 'string'
    )
    return {
      content: typeof choice.message.content === 'string' ? choice.message.content : null,
      toolCalls,
      finishReason: choice.finish_reason ?? null,
      usage: payload?.usage
        ? {
            promptTokens: payload.usage.prompt_tokens ?? 0,
            completionTokens: payload.usage.completion_tokens ?? 0,
          }
        : null,
      latencyMs: Date.now() - started,
    }
  }
}

// Scripted provider for tests and evals: a function decides the next answer from the messages.
export class ChatGuionado implements ChatProvider {
  readonly id = 'scripted'
  readonly model = 'scripted'
  readonly calls: { messages: MensajeChat[]; tools: string[] }[] = []

  constructor(
    private readonly script: (input: {
      messages: MensajeChat[]
      tools: string[]
      call: number
    }) => Partial<RespuestaChat> | Promise<Partial<RespuestaChat>>
  ) {}

  async chat(input: {
    messages: MensajeChat[]
    tools?: DefinicionHerramientaChat[]
    maxTokens: number
  }): Promise<RespuestaChat> {
    const tools = (input.tools ?? []).map((tool) => tool.function.name)
    this.calls.push({ messages: structuredClone(input.messages), tools })
    const answer = await this.script({ messages: input.messages, tools, call: this.calls.length })
    return {
      content: answer.content ?? null,
      toolCalls: answer.toolCalls ?? [],
      finishReason: answer.finishReason ?? 'stop',
      usage: answer.usage ?? null,
      latencyMs: 0,
    }
  }
}

export function llamada(
  name: string,
  args: Record<string, unknown>,
  id = `call_${name}`
): LlamadaHerramienta {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

// ---- speech to text (optional) --------------------------------------------------------------

export interface Transcriptor {
  transcribir(audio: { bytes: Buffer; mimeType: string }): Promise<string>
}

export class TranscriptorGroq implements Transcriptor {
  private readonly pool: GroqCredentialPool

  constructor(
    private readonly options: {
      apiKey?: string
      pool?: GroqCredentialPool
      model?: string
      timeoutMs?: number
      fetch?: typeof fetch
    }
  ) {
    const pool =
      options.pool ??
      (options.apiKey
        ? crearPoolCredencialesGroq({ GROQ_API_KEY: options.apiKey }, { fetch: options.fetch })
        : null)
    if (!pool) throw new Error('GROQ_API_KEY is required for transcription')
    this.pool = pool
  }

  async transcribir(audio: { bytes: Buffer; mimeType: string }): Promise<string> {
    const extension = audio.mimeType.includes('ogg')
      ? 'ogg'
      : audio.mimeType.includes('mpeg')
        ? 'mp3'
        : audio.mimeType.includes('mp4')
          ? 'm4a'
          : 'bin'
    const response = await this.pool.request({
      url: `${GROQ_BASE_URL}/audio/transcriptions`,
      idempotent: true,
      createInit: () => {
        const form = new FormData()
        form.append(
          'file',
          new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType }),
          `audio.${extension}`
        )
        form.append('model', this.options.model || GROQ_STT_MODEL_POR_DEFECTO)
        form.append('language', 'es')
        form.append('response_format', 'json')
        return {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        }
      },
    })
    if (!response.ok) throw new Error(`transcription failed with status ${response.status}`)
    const payload = (await response.json()) as { text?: unknown }
    if (typeof payload.text !== 'string') throw new Error('transcription returned no text')
    return payload.text.slice(0, 2000)
  }
}
