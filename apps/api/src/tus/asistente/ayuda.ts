import { redactarPii } from './modelo.ts'
import type { RecuperacionConocimiento, ContextoRecuperacion } from './conocimiento.ts'

// Ayuda pública del asistente Web ("¿Cómo funciona TUS?", "¿Puedo cancelar?"). Respuesta
// EXTRACTIVA: devuelve los fragmentos autorizados del índice de conocimiento, sin LLM, así que no
// puede inventar y sigue funcionando aunque el proveedor de IA esté caído. Solo conocimiento
// `public` (la Web anónima nunca ve documentos de clientes, prestadores ni internos). El RAG es
// conocimiento, no datos vivos: estados de trabajos, pagos o disponibilidad salen de las tools.

export interface RecuperadorAyuda {
  buscar(query: string, actor: ContextoRecuperacion): Promise<RecuperacionConocimiento>
}

export interface RespuestaAyuda {
  documentId: string
  documentTitle: string
  section: string
  excerpt: string
}

export type ResultadoAyuda =
  | { status: 'answered'; answers: RespuestaAyuda[]; strategy: RecuperacionConocimiento['strategy'] }
  | { status: 'low_confidence' }
  | { status: 'unavailable' }
  | { status: 'invalid' }

export const LIMITES_AYUDA = { preguntaMin: 3, preguntaMax: 300, respuestas: 2, extracto: 520 } as const

export class ServicioAyudaPublica {
  constructor(
    private readonly recuperador: RecuperadorAyuda | null,
    private readonly metric?: (name: string, fields: Record<string, number | string | boolean>) => void
  ) {}

  async responder(pregunta: unknown): Promise<ResultadoAyuda> {
    const texto = typeof pregunta === 'string' ? pregunta.replace(/\s+/gu, ' ').trim() : ''
    if (texto.length < LIMITES_AYUDA.preguntaMin || texto.length > LIMITES_AYUDA.preguntaMax) return { status: 'invalid' }
    if (!this.recuperador) return { status: 'unavailable' }
    const started = Date.now()
    let recuperado: RecuperacionConocimiento
    try {
      // La consulta puede ir a un proveedor de embeddings: nunca con datos personales.
      recuperado = await this.recuperador.buscar(redactarPii(texto), { linked: false, isProvider: false })
    } catch {
      this.metric?.('rag.search', { channel: 'web', outcome: 'error', latencyMs: Date.now() - started })
      return { status: 'unavailable' }
    }
    // Solo fragmentos públicos, aunque el índice devolviera otra cosa (defensa en profundidad).
    const publicos = recuperado.results.filter((item) => item.chunk.visibility === 'public')
    this.metric?.('rag.search', { channel: 'web', outcome: recuperado.confidence, results: publicos.length, strategy: recuperado.strategy, latencyMs: Date.now() - started })
    if (recuperado.confidence !== 'high' || publicos.length === 0) return { status: 'low_confidence' }
    const porDocumento = new Map<string, RespuestaAyuda>()
    for (const item of publicos) {
      if (porDocumento.has(item.chunk.documentId) || porDocumento.size >= LIMITES_AYUDA.respuestas) continue
      porDocumento.set(item.chunk.documentId, {
        documentId: item.chunk.documentId,
        documentTitle: item.documentTitle,
        section: item.chunk.heading,
        excerpt: extracto(item.chunk.text),
      })
    }
    return { status: 'answered', answers: [...porDocumento.values()], strategy: recuperado.strategy }
  }
}

// Texto plano legible: sin sintaxis Markdown ni el encabezado repetido; cortado en una frase.
export function extracto(markdown: string, max: number = LIMITES_AYUDA.extracto): string {
  const plano = markdown
    .split(/\r?\n/u)
    .filter((line) => !/^\s*#{1,6}\s/u.test(line))
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`>]+/gu, '')
    .replace(/^\s*[-+]\s+/gmu, '')
    .replace(/\s+-\s+/gu, ' · ')
    .replace(/\s+/gu, ' ')
    // Una lista que sigue a una frase no arranca con separador: "…solicitudes. Paso uno · Paso dos".
    .replace(/([.:!?])\s·\s/gu, '$1 ')
    .trim()
  if (plano.length <= max) return plano
  const corte = plano.slice(0, max)
  const fin = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('? '), corte.lastIndexOf('! '))
  return fin > max * 0.5 ? corte.slice(0, fin + 1) : `${corte.slice(0, corte.lastIndexOf(' '))}…`
}
