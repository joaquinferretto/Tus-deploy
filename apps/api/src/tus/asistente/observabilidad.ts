// MEMORIA-01 (phase 9). What the assistant costs and how its memory behaves, in numbers.
//
// Every part of the assistant reports events through one function (name + fields). This is the
// in-process sink of those events: it keeps COUNTERS, per channel, of the tokens of each part of
// the context, of every model call by purpose, and of the memory (stored, retrieved, discarded,
// skipped, deleted, errors). It never keeps an event, a prompt, an answer or any text: only the
// names in the closed lists below and numbers. A value outside those lists is counted as 'other'.
//
// The counters live in this process and start again with it: they are for looking at a running
// instance and for tests, not an accounting system.

export type CamposMetrica = Record<string, number | string | boolean>

const CANALES = ['web', 'whatsapp'] as const
type CanalMedido = (typeof CANALES)[number] | 'unknown'

export const PROPOSITOS_MODELO = ['routing', 'answer', 'search_wording', 'help_classification', 'help_answer', 'summary', 'summary_regeneration'] as const
export type PropositoModelo = (typeof PROPOSITOS_MODELO)[number]

const PARTES_CONTEXTO = ['tokensFijos', 'tokensResumen', 'tokensRecuerdos', 'tokensHechos', 'tokensRecientes', 'tokensActual', 'tokensTotal'] as const

interface ConsumoModelo {
  calls: number
  errors: number
  promptTokens: number
  completionTokens: number
  ms: number
}

interface MedidasCanal {
  // Turns that reached the model with a built context.
  contexts: number
  // Sum of the estimated tokens of each part of those contexts.
  contextTokens: Record<(typeof PARTES_CONTEXTO)[number], number>
  // Messages and memories left out of a context because of the budget.
  omittedMessages: number
  omittedMemories: number
  model: ConsumoModelo
  byPurpose: Partial<Record<PropositoModelo | 'other', ConsumoModelo>>
}

export interface MedidasAsistente {
  since: string
  channels: Record<CanalMedido, MedidasCanal>
  memory: {
    summaries: number
    summariesSkipped: number
    fragmentsStored: number
    retrievals: number
    retrieved: number
    discarded: number
    // Searches that were not run because the account has no memories (no embeddings call).
    skipped: number
    factsStored: number
    factsInvalidated: number
    deleted: number
    purged: number
    errors: Record<string, number>
  }
  realState: Record<string, number>
}

const consumo = (): ConsumoModelo => ({ calls: 0, errors: 0, promptTokens: 0, completionTokens: 0, ms: 0 })
const canalVacio = (): MedidasCanal => ({ contexts: 0, contextTokens: { tokensFijos: 0, tokensResumen: 0, tokensRecuerdos: 0, tokensHechos: 0, tokensRecientes: 0, tokensActual: 0, tokensTotal: 0 }, omittedMessages: 0, omittedMemories: 0, model: consumo(), byPurpose: {} })
const numero = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
// A label of a closed list, or 'other': free text never becomes a key.
const etiqueta = (value: unknown): string => (typeof value === 'string' && /^[a-z_]{1,32}$/u.test(value) ? value : 'other')

export class ObservabilidadAsistente {
  private medidas: MedidasAsistente

  constructor(private readonly now: () => number = Date.now) {
    this.medidas = this.vacias()
  }

  private vacias(): MedidasAsistente {
    return {
      since: new Date(this.now()).toISOString(),
      channels: { web: canalVacio(), whatsapp: canalVacio(), unknown: canalVacio() },
      memory: { summaries: 0, summariesSkipped: 0, fragmentsStored: 0, retrievals: 0, retrieved: 0, discarded: 0, skipped: 0, factsStored: 0, factsInvalidated: 0, deleted: 0, purged: 0, errors: {} },
      realState: {},
    }
  }

  private canal(value: unknown): MedidasCanal {
    return this.medidas.channels[(CANALES as readonly unknown[]).includes(value) ? (value as CanalMedido) : 'unknown']
  }

  // Never throws: measuring must not break what is measured.
  registrar(name: string, fields: CamposMetrica = {}): void {
    try {
      const memoria = this.medidas.memory
      if (name === 'assistant.context') {
        const canal = this.canal(fields['channel'])
        canal.contexts += 1
        for (const parte of PARTES_CONTEXTO) canal.contextTokens[parte] += numero(fields[parte])
        canal.omittedMessages += numero(fields['mensajesOmitidos'])
        canal.omittedMemories += numero(fields['recuerdosOmitidos'])
      } else if (name === 'assistant.model_call') {
        const canal = this.canal(fields['channel'])
        const proposito = (PROPOSITOS_MODELO as readonly unknown[]).includes(fields['purpose']) ? (fields['purpose'] as PropositoModelo) : 'other'
        for (const destino of [canal.model, (canal.byPurpose[proposito] ??= consumo())]) {
          destino.calls += 1
          if (fields['ok'] === false) destino.errors += 1
          destino.promptTokens += numero(fields['promptTokens'])
          destino.completionTokens += numero(fields['completionTokens'])
          destino.ms += numero(fields['ms'])
        }
      } else if (name === 'assistant.summary') memoria.summaries += 1
      else if (name === 'assistant.summary_skipped') memoria.summariesSkipped += 1
      else if (name === 'assistant.memory_stored') memoria.fragmentsStored += numero(fields['fragments'])
      else if (name === 'assistant.memory_retrieved') {
        memoria.retrievals += 1
        memoria.retrieved += numero(fields['retrieved'])
        memoria.discarded += numero(fields['discarded'])
      } else if (name === 'assistant.memory_skipped') memoria.skipped += 1
      else if (name === 'assistant.facts') {
        memoria.factsStored += numero(fields['stored'])
        memoria.factsInvalidated += numero(fields['invalidated'])
      } else if (name === 'assistant.memory_deleted') memoria.deleted += numero(fields['messages']) + numero(fields['summaries']) + numero(fields['fragments']) + numero(fields['facts'])
      else if (name === 'assistant.memory_purged') memoria.purged += numero(fields['expired']) + numero(fields['orphaned']) + numero(fields['facts'])
      else if (name === 'assistant.memory_error') {
        const etapa = etiqueta(fields['stage'])
        memoria.errors[etapa] = (memoria.errors[etapa] ?? 0) + 1
      } else if (name === 'assistant.real_state') {
        const resultado = etiqueta(fields['outcome'])
        this.medidas.realState[resultado] = (this.medidas.realState[resultado] ?? 0) + 1
      }
    } catch {
      // Nothing to do: a measurement is never worth an error.
    }
  }

  // A copy of the counters so far.
  snapshot(): MedidasAsistente {
    return structuredClone(this.medidas)
  }

  reiniciar(): void {
    this.medidas = this.vacias()
  }
}
