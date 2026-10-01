import type {
  ActividadAsistenteDTO,
  EventoStreamAsistente,
  HistorialAsistente,
  MensajeAsistenteDTO,
  SolicitudMensajeAsistente,
} from '@factory/contracts'

import { resolveWebApiBaseUrl } from '../../lib/api-url'
import { fetchWithSession } from '../../lib/session-credentials'

// Client of the TUS assistant. The Web only transports: the text goes to the API, where the same
// orchestrator as WhatsApp (model, tools, knowledge base, memory) decides and writes the reply.
// Nothing here interprets the message or builds an answer.

const VISITOR_KEY = 'tus.asistente.visitante'

export class AssistantError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code)
    this.name = 'AssistantError'
  }
}

function baseUrl(): string {
  return resolveWebApiBaseUrl({ canonicalUrl: process.env['NEXT_PUBLIC_API_URL'], legacyUrl: process.env['API_BASE_URL'], nodeEnv: process.env['NODE_ENV'] })
}

// Random id of this browser. It only lets an anonymous conversation continue; it is never an
// identity (the account is the session cookie, resolved by the API).
export function visitorId(): string {
  try {
    const saved = window.localStorage.getItem(VISITOR_KEY)
    if (saved && /^[A-Za-z0-9_-]{16,64}$/u.test(saved)) return saved
    const created = crypto.randomUUID().replaceAll('-', '')
    window.localStorage.setItem(VISITOR_KEY, created)
    return created
  } catch {
    // Storage blocked: a conversation that lasts as long as this page.
    volatil ??= crypto.randomUUID().replaceAll('-', '')
    return volatil
  }
}
let volatil: string | null = null

const headers = (extra: Record<string, string> = {}) => ({ 'X-Correlation-Id': crypto.randomUUID(), ...extra })

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { code?: string } | null
  throw new AssistantError(body?.code ?? 'UNKNOWN', response.status)
}

export async function loadHistory(): Promise<HistorialAsistente> {
  const response = await fetchWithSession(`${baseUrl()}/tus/v1/asistente/historial?visitorId=${encodeURIComponent(visitorId())}`, {
    cache: 'no-store',
    headers: headers({ Accept: 'application/json' }),
  })
  if (!response.ok) return fail(response)
  return (await response.json()) as HistorialAsistente
}

export async function resetConversation(): Promise<void> {
  const response = await fetchWithSession(`${baseUrl()}/tus/v1/asistente/reiniciar`, {
    method: 'POST',
    headers: headers({ Accept: 'application/json', 'Content-Type': 'application/json' }),
    body: JSON.stringify({ visitorId: visitorId() }),
  })
  if (!response.ok) return fail(response)
}

export interface AssistantTurnHandlers {
  onAccepted(message: MensajeAsistenteDTO): void
  onActivity(activity: ActividadAsistenteDTO): void
  onMessage(message: MensajeAsistenteDTO): void
}

// Sends one turn and reads the NDJSON stream line by line: what the backend is doing right now
// (reading the knowledge base, running a tool) and then the reply. If a proxy buffers the stream
// the lines simply arrive together at the end.
export async function sendTurn(input: { text: string } | { replyId: string }, handlers: AssistantTurnHandlers): Promise<{ degraded: boolean }> {
  const body: SolicitudMensajeAsistente = { ...input, visitorId: visitorId() }
  const response = await fetchWithSession(`${baseUrl()}/tus/v1/asistente/mensajes`, {
    method: 'POST',
    headers: headers({ Accept: 'application/x-ndjson', 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!response.ok || !response.body) return fail(response)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done: { degraded: boolean } | null = null
  const handle = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as EventoStreamAsistente
    if (event.type === 'accepted') handlers.onAccepted(event.userMessage)
    else if (event.type === 'activity') handlers.onActivity(event.activity)
    else if (event.type === 'message') handlers.onMessage(event.message)
    else if (event.type === 'done') done = { degraded: event.degraded }
    else throw new AssistantError(event.code, 200)
  }
  for (;;) {
    const chunk = await reader.read()
    buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handle(line)
    if (chunk.done) break
  }
  handle(buffer)
  if (!done) throw new AssistantError('INCOMPLETE', 200)
  return done
}
