import { randomUUID } from 'node:crypto'

import { sinAcentos } from '../texto.ts'
import { extraerNecesidad } from './necesidad.ts'
import type { CanalConversacion } from './modelo.ts'

// MEMORIA-01 (phase 5). Durable FACTS of an account, independent of any one conversation:
// a preference that is useful later ("siempre a la tarde", "vivo en el Centro", "escribime por
// WhatsApp"). Deliberately narrow:
//
// - a CLOSED list of types: anything else the person says is never stored as a fact;
// - only when the person states it as a preference or as something about themselves (never
//   inferred from one request: "un plomero para mañana a la tarde" is a need, not a habit);
// - detected by the backend with the same extractor the search uses: no model writes a fact;
// - with provenance (account, conversation, channel, message), a date and an expiry;
// - a new value does not overwrite: the old fact is invalidated and kept.
//
// A fact is context. If it contradicts what the person says now, or the real state of TUS, the
// person and TUS win.

export const TIPOS_HECHO = ['horario_preferido', 'zona_habitual', 'contacto_preferido'] as const
export type TipoHecho = (typeof TIPOS_HECHO)[number]

export const ETIQUETA_HECHO: Record<TipoHecho, string> = {
  horario_preferido: 'Horario preferido',
  zona_habitual: 'Zona habitual',
  contacto_preferido: 'Contacto preferido',
}

// A habit of hours or a zone stops being trusted after this long without being said again.
export const VIGENCIA_HECHO_MS = 180 * 24 * 60 * 60 * 1000

export interface HechoMemoria {
  factId: string
  accountId: string
  type: TipoHecho
  value: string
  conversationId: string | null
  sourceMessageId: string | null
  channel: CanalConversacion
  confidence: number | null
  createdAt: string
  updatedAt: string
  expiresAt: string | null
  invalidatedAt: string | null
  invalidationReason: string | null
}

export interface PuertoHechos {
  // Active (not invalidated, not expired) facts of THAT account.
  activos(accountId: string, now: string): Promise<HechoMemoria[]>
  // Everything, invalidated ones included (provenance and history).
  historial(accountId: string): Promise<HechoMemoria[]>
  // Same type and value already active: refreshed ('sin_cambio'). Another value: the active one
  // is invalidated ('reemplazado') and the new one stored, atomically.
  guardar(hecho: HechoMemoria): Promise<'guardado' | 'reemplazado' | 'sin_cambio'>
  // `type` null: every active fact of the account. Returns how many were invalidated.
  invalidar(input: { accountId: string; type: TipoHecho | null; reason: string; now: string }): Promise<number>
  // Hard delete of one fact of THAT account.
  eliminar(accountId: string, factId: string): Promise<boolean>
  // Hard delete of the facts of THAT account that came from a message or from a conversation
  // (every fact of the account when neither is given). Returns how many.
  eliminarDeOrigen(input: { accountId: string; conversationId?: string; messageId?: string }): Promise<number>
  // Retention: hard delete of what was invalidated or expired before that moment.
  depurar(antes: string): Promise<number>
}

export class HechosEnMemoria implements PuertoHechos {
  readonly filas: HechoMemoria[] = []

  async activos(accountId: string, now: string) {
    return this.filas.filter((h) => h.accountId === accountId && !h.invalidatedAt && (!h.expiresAt || h.expiresAt > now)).map((h) => ({ ...h }))
  }

  async historial(accountId: string) {
    return this.filas.filter((h) => h.accountId === accountId).map((h) => ({ ...h }))
  }

  async guardar(hecho: HechoMemoria) {
    const activo = this.filas.find((h) => h.accountId === hecho.accountId && h.type === hecho.type && !h.invalidatedAt)
    if (activo && activo.value === hecho.value) {
      activo.updatedAt = hecho.updatedAt
      activo.expiresAt = hecho.expiresAt
      return 'sin_cambio' as const
    }
    if (activo) {
      activo.invalidatedAt = hecho.createdAt
      activo.invalidationReason = 'reemplazado'
    }
    this.filas.push({ ...hecho })
    return activo ? ('reemplazado' as const) : ('guardado' as const)
  }

  async invalidar(input: { accountId: string; type: TipoHecho | null; reason: string; now: string }) {
    let cantidad = 0
    for (const hecho of this.filas)
      if (hecho.accountId === input.accountId && !hecho.invalidatedAt && (input.type === null || hecho.type === input.type)) {
        hecho.invalidatedAt = input.now
        hecho.invalidationReason = input.reason
        cantidad += 1
      }
    return cantidad
  }

  async eliminar(accountId: string, factId: string) {
    const indice = this.filas.findIndex((h) => h.accountId === accountId && h.factId === factId)
    if (indice < 0) return false
    this.filas.splice(indice, 1)
    return true
  }

  private quitar(sobra: (hecho: HechoMemoria) => boolean) {
    const antes = this.filas.length
    for (let i = this.filas.length - 1; i >= 0; i -= 1) if (sobra(this.filas[i]!)) this.filas.splice(i, 1)
    return antes - this.filas.length
  }

  async eliminarDeOrigen(input: { accountId: string; conversationId?: string; messageId?: string }) {
    if (!input.accountId) return 0
    return this.quitar((h) => h.accountId === input.accountId && (input.conversationId === undefined || h.conversationId === input.conversationId) && (input.messageId === undefined || h.sourceMessageId === input.messageId))
  }

  async depurar(antes: string) {
    return this.quitar((h) => (h.invalidatedAt !== null && h.invalidatedAt < antes) || (h.expiresAt !== null && h.expiresAt < antes))
  }
}

const PARTES: Record<string, string> = { manana: 'a la mañana', mediodia: 'al mediodía', siesta: 'a la siesta', tarde: 'a la tarde', noche: 'a la noche' }
// The person states a habit or a preference (not a one-off request).
const PREFERENCIA = /\b(?:siempre|prefiero|preferentemente|preferiblemente|generalmente|por lo general|normalmente|habitualmente|de costumbre|me conviene|me queda mejor|me viene mejor|suelo|solo puedo|unicamente puedo)\b/u
// The person says where they live or are.
const RESIDENCIA = /\b(?:vivo en|soy de|estoy en el barrio|mi barrio es|mi zona es|vivo por)\b/u
const CONTACTO: { patron: RegExp; valor: string }[] = [
  { patron: /\b(?:whatsapp|wsp|wpp|wasap)\b/u, valor: 'WhatsApp' },
  { patron: /\b(?:llamada|llamame|llamen|llamar|por telefono)\b/u, valor: 'Llamada' },
  { patron: /\b(?:la web|por la web|la pagina|el sitio)\b/u, valor: 'Web' },
]
const PIDE_CONTACTO = /\b(?:prefiero|mejor|contactame|contactenme|escribime|escribanme|hablame|avisame|avisenme|comunicate|comuniquense|llamame|llamenme)\b/u

// "olvidá mi zona", "ya no prefiero la tarde", "borrá mis preferencias".
const OLVIDAR = /\b(?:olvida(?:te)?|borra(?:r)?|elimina(?:r)?|saca(?:r)?|quita(?:r)?|no guardes|no recuerdes|ya no)\b/u

export interface HechoDetectado {
  type: TipoHecho
  value: string
  confidence: number
}

// What the message states about the person, within the closed list. Deterministic.
export function detectarHechos(text: string, now: number): HechoDetectado[] {
  const plano = sinAcentos(text.toLowerCase())
  if (OLVIDAR.test(plano)) return []
  const datos = extraerNecesidad(text, now)
  const hechos: HechoDetectado[] = []
  const preferencia = PREFERENCIA.test(plano)
  if (preferencia && datos.time?.part && PARTES[datos.time.part]) hechos.push({ type: 'horario_preferido', value: PARTES[datos.time.part]!, confidence: 0.8 })
  if (datos.zone && (RESIDENCIA.test(plano) || (preferencia && /\b(?:zona|barrio|por|en)\b/u.test(plano) && !datos.time?.part && !datos.profession))) hechos.push({ type: 'zona_habitual', value: datos.zone.slice(0, 80), confidence: RESIDENCIA.test(plano) ? 0.9 : 0.7 })
  if (PIDE_CONTACTO.test(plano)) {
    const canal = CONTACTO.find((item) => item.patron.test(plano))
    if (canal) hechos.push({ type: 'contacto_preferido', value: canal.valor, confidence: 0.8 })
  }
  return hechos
}

// Which facts the person asks to forget: a type, or all of them (null). undefined: nothing.
export function detectarOlvido(text: string): TipoHecho | null | undefined {
  const plano = sinAcentos(text.toLowerCase())
  if (!OLVIDAR.test(plano)) return undefined
  if (/\b(?:zona|barrio|direccion|donde vivo)\b/u.test(plano)) return 'zona_habitual'
  if (/\b(?:horario|hora|manana|tarde|noche|siesta|mediodia)\b/u.test(plano) && /\b(?:prefer\w*|habitual|siempre|mi)\b/u.test(plano)) return 'horario_preferido'
  if (/\b(?:contact\w*|whatsapp|llam\w*)\b/u.test(plano) && /\b(?:prefer\w*|mi)\b/u.test(plano)) return 'contacto_preferido'
  if (/\b(?:mis preferencias|lo que sabes de mi|mis datos guardados|lo que recordas|todo lo que recordas)\b/u.test(plano)) return null
  return undefined
}

export class ServicioHechos {
  constructor(
    private readonly hechos: PuertoHechos,
    private readonly now: () => number = Date.now,
    private readonly metric: (name: string, fields: Record<string, string | number | boolean>) => void = () => {}
  ) {}

  // Reads ONE message of a person with an account: forgets what it asks to forget and stores the
  // facts it states (closed list). Without an account nothing is stored. Never throws.
  async registrar(input: { accountId: string | null; conversationId: string; channel: CanalConversacion; messageId: string | null; text: string }): Promise<{ guardados: number; invalidados: number }> {
    if (!input.accountId) return { guardados: 0, invalidados: 0 }
    try {
      const ahora = this.now()
      const iso = new Date(ahora).toISOString()
      const olvido = detectarOlvido(input.text)
      const invalidados = olvido === undefined ? 0 : await this.hechos.invalidar({ accountId: input.accountId, type: olvido, reason: 'pedido_del_titular', now: iso })
      let guardados = 0
      for (const hecho of detectarHechos(input.text, ahora)) {
        const resultado = await this.hechos.guardar({
          factId: `hecho-memoria-${randomUUID()}`, accountId: input.accountId, type: hecho.type, value: hecho.value, conversationId: input.conversationId, sourceMessageId: input.messageId, channel: input.channel,
          confidence: hecho.confidence, createdAt: iso, updatedAt: iso, expiresAt: new Date(ahora + VIGENCIA_HECHO_MS).toISOString(), invalidatedAt: null, invalidationReason: null,
        })
        if (resultado !== 'sin_cambio') guardados += 1
      }
      if (guardados > 0 || invalidados > 0) this.metric('assistant.facts', { channel: input.channel, stored: guardados, invalidated: invalidados })
      return { guardados, invalidados }
    } catch {
      this.metric('assistant.memory_error', { stage: 'facts' })
      return { guardados: 0, invalidados: 0 }
    }
  }

  // The active facts of the account, worded for the context. No account: none.
  async paraContexto(accountId: string | null): Promise<string[]> {
    if (!accountId) return []
    try {
      const activos = await this.hechos.activos(accountId, new Date(this.now()).toISOString())
      return activos.filter((hecho) => hecho.accountId === accountId).map((hecho) => `${ETIQUETA_HECHO[hecho.type]}: ${hecho.value}`)
    } catch {
      return []
    }
  }

  activos(accountId: string): Promise<HechoMemoria[]> {
    return this.hechos.activos(accountId, new Date(this.now()).toISOString())
  }

  historial(accountId: string): Promise<HechoMemoria[]> {
    return this.hechos.historial(accountId)
  }

  invalidar(accountId: string, type: TipoHecho | null, reason: string): Promise<number> {
    return this.hechos.invalidar({ accountId, type, reason, now: new Date(this.now()).toISOString() })
  }

  eliminar(accountId: string, factId: string): Promise<boolean> {
    return this.hechos.eliminar(accountId, factId)
  }
}
