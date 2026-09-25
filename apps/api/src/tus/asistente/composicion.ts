import type { TusApplicationService } from '../application/tus-application-service.ts'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import { crearPoolCredencialesGroq } from '../../providers/groq/index.ts'
import {
  EmbeddingsLocalesHash,
  ProveedorEmbeddingsCompatibleOpenAI,
  RecuperadorConocimiento,
  type EmbeddingProvider,
  type PuertoIndiceConocimiento,
} from './conocimiento.ts'
import { DominioAsistenteTus, type PuertoDominioAsistente, type ServiciosCompartidosAsistente } from './dominio.ts'
import { GroqChatProvider, TranscriptorGroq, type ChatProvider, type Transcriptor } from './groq.ts'
import {
  LIMITES_INGRESO_POR_DEFECTO,
  ServicioIngresoWhatsapp,
  type LimitesIngreso,
} from './ingreso.ts'
import {
  FakeWhatsappProvider,
  MetaWhatsappCloudProvider,
  leerConfiguracionWhatsapp,
  type ConfiguracionWhatsapp,
  type WhatsappProvider,
} from './meta.ts'
import {
  LIMITES_ASISTENTE_POR_DEFECTO,
  OrquestadorConversacion,
  type LimitesAsistente,
  type Metrica,
  type ResolutorCuentaAsistente,
} from './orquestador.ts'
import { WhatsappTemplateService } from './plantillas.ts'
import type { PuertoTransaccionAsistente } from './puertos.ts'
import { ServicioSoporteWhatsapp } from './soporte.ts'
import { ServicioVinculacionWhatsapp } from './vinculacion.ts'
import { WorkerConversacionesWhatsapp } from './worker.ts'

const numero = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

// All limits are bounded (cost and abuse control).
export function leerLimites(env: Record<string, string | undefined>): {
  asistente: LimitesAsistente
  ingreso: LimitesIngreso
  topK: number
} {
  return {
    asistente: {
      ...LIMITES_ASISTENTE_POR_DEFECTO,
      maxToolCalls: numero(env['WHATSAPP_AI_MAX_TOOL_CALLS'], 5, 1, 8),
      maxCompletionTokens: numero(env['WHATSAPP_AI_MAX_COMPLETION_TOKENS'], 600, 100, 2000),
      historyMessages: numero(env['WHATSAPP_AI_HISTORY_MESSAGES'], 12, 2, 40),
      summaryThreshold: numero(env['WHATSAPP_AI_SUMMARY_THRESHOLD'], 24, 8, 200),
      toolTimeoutMs: numero(env['WHATSAPP_AI_TOOL_TIMEOUT_MS'], 8_000, 1_000, 30_000),
      ragEnabled: env['RAG_ENABLED']?.trim() !== 'false',
    },
    ingreso: {
      ...LIMITES_INGRESO_POR_DEFECTO,
      maxInboundPerMinute: numero(env['WHATSAPP_INBOUND_MAX_PER_MINUTE'], 12, 1, 120),
      blockThresholdPerMinute: numero(env['WHATSAPP_INBOUND_BLOCK_PER_MINUTE'], 60, 5, 1000),
      debounceMs: numero(env['WHATSAPP_DEBOUNCE_MS'], 1_500, 0, 10_000),
    },
    topK: numero(env['RAG_TOP_K'], 4, 1, 10),
  }
}

export function crearProveedorEmbeddings(
  env: Record<string, string | undefined>
): EmbeddingProvider | null {
  const provider = env['RAG_EMBEDDING_PROVIDER']?.trim() || 'none'
  if (provider === 'openai-compatible') {
    const baseUrl = env['RAG_EMBEDDING_BASE_URL']?.trim()
    const apiKey = env['RAG_EMBEDDING_API_KEY']?.trim()
    const model = env['RAG_EMBEDDING_MODEL']?.trim()
    if (!baseUrl || !apiKey || !model)
      throw new Error(
        'RAG_EMBEDDING_BASE_URL, RAG_EMBEDDING_API_KEY and RAG_EMBEDDING_MODEL are required'
      )
    if (!baseUrl.startsWith('https://')) throw new Error('RAG_EMBEDDING_BASE_URL must be https')
    return new ProveedorEmbeddingsCompatibleOpenAI({
      baseUrl,
      apiKey,
      model,
      sendDimensions: env['RAG_EMBEDDING_SEND_DIMENSIONS']?.trim() === 'true',
    })
  }
  // Local deterministic hashing: development only, refused in production.
  if (provider === 'local-hash') {
    if (env['NODE_ENV']?.trim() === 'production')
      throw new Error('RAG_EMBEDDING_PROVIDER=local-hash is not allowed in production')
    return new EmbeddingsLocalesHash()
  }
  // `none`: lexical (full-text) retrieval only.
  return null
}

export interface ModuloWhatsapp {
  config: ConfiguracionWhatsapp
  whatsapp: WhatsappProvider
  ingreso: ServicioIngresoWhatsapp
  vinculacion: ServicioVinculacionWhatsapp
  soporte: ServicioSoporteWhatsapp
  plantillas: WhatsappTemplateService
  orquestador: OrquestadorConversacion
  platformAdminTenantId: string | null
  crearWorker(options?: {
    owner?: string
    log?: (event: string, fields: Record<string, unknown>) => void
  }): WorkerConversacionesWhatsapp
}

export function crearModuloWhatsapp(input: {
  env: Record<string, string | undefined>
  transaction: PuertoTransaccionAsistente
  accounts: ResolutorCuentaAsistente
  application?: TusApplicationService
  // Directorio y solicitud TUS compartidos con la Web (mismas reglas en ambos canales).
  servicios?: ServiciosCompartidosAsistente
  domain?: PuertoDominioAsistente
  knowledgeIndex?: PuertoIndiceConocimiento | null
  whatsapp?: WhatsappProvider
  chat?: ChatProvider | null
  embeddings?: EmbeddingProvider | null
  transcriptor?: Transcriptor | null
  now?: () => number
  metric?: Metrica
  log?: (event: string, fields: Record<string, unknown>) => void
}): ModuloWhatsapp {
  const env = input.env
  const config = leerConfiguracionWhatsapp(env)
  const limits = leerLimites(env)
  const now = input.now ?? Date.now
  const whatsapp =
    input.whatsapp ??
    (config.enabled && config.accessToken && config.phoneNumberId
      ? new MetaWhatsappCloudProvider({
          accessToken: config.accessToken,
          phoneNumberId: config.phoneNumberId,
          graphApiVersion: config.graphApiVersion,
        })
      : new FakeWhatsappProvider())
  const groqPool = crearPoolCredencialesGroq(env, {
    log: (message) => input.log?.('groq.credential.selected', { message }),
  })
  const chat =
    input.chat !== undefined
      ? input.chat
      : groqPool
        ? new GroqChatProvider({
            pool: groqPool,
            model: env['GROQ_WHATSAPP_MODEL']?.trim() || undefined,
          })
        : null
  const transcriptor =
    input.transcriptor !== undefined
      ? input.transcriptor
      : groqPool && env['WHATSAPP_AUDIO_TRANSCRIPTION']?.trim() === 'true'
        ? new TranscriptorGroq({
            pool: groqPool,
            model: env['GROQ_STT_MODEL']?.trim() || undefined,
          })
        : null
  const embeddings =
    input.embeddings !== undefined ? input.embeddings : crearProveedorEmbeddings(env)
  const knowledge = input.knowledgeIndex
    ? new RecuperadorConocimiento(input.knowledgeIndex, embeddings, {
        topK: limits.topK,
        minVectorScore: 0.35,
        minLexicalScore: 0.34,
      })
    : null
  const domain =
    input.domain ?? (input.application ? new DominioAsistenteTus(input.application, now, input.servicios) : null)
  if (!domain) throw new Error('the WhatsApp assistant needs the TUS application or a domain port')
  const vinculacion = new ServicioVinculacionWhatsapp(
    input.transaction,
    env['TUS_WEB_BASE_URL']?.trim() || null,
    now
  )
  const orquestador = new OrquestadorConversacion({
    transaction: input.transaction,
    whatsapp,
    chat,
    domain,
    accounts: input.accounts,
    linking: vinculacion,
    knowledge,
    transcriptor,
    limits: limits.asistente,
    now,
    ...(input.metric ? { metric: input.metric } : {}),
  })
  return {
    config,
    whatsapp,
    ingreso: new ServicioIngresoWhatsapp(input.transaction, limits.ingreso, now, input.log),
    vinculacion,
    soporte: new ServicioSoporteWhatsapp(input.transaction, whatsapp, vinculacion, now),
    plantillas: WhatsappTemplateService.desdeEnv(env),
    orquestador,
    platformAdminTenantId: env['TUS_PLATFORM_ADMIN_TENANT_ID']?.trim() || null,
    crearWorker: (options = {}) =>
      new WorkerConversacionesWhatsapp(input.transaction, orquestador, { now, ...options }),
  }
}

// Resolves the CURRENT authority of a linked account from the identity store (same checks as a
// Web session: active account, same tenant, active membership). Roles are never cached.
export class ResolutorCuentaIdentidad implements ResolutorCuentaAsistente {
  constructor(
    private readonly store: {
      getAccount(
        accountId: string
      ): Promise<{ id: string; tenantId: string; status: string; roles: string[] } | undefined>
      hasActiveMembership(accountId: string, tenantId: string): Promise<boolean>
    },
    private readonly scope: (roles: readonly string[]) => { roles: string[]; permissions: string[] }
  ) {}

  async contexto(
    accountId: string,
    tenantId: string,
    correlationId: string
  ): Promise<TusAuthenticatedTenantContext | null> {
    const account = await this.store.getAccount(accountId)
    if (!account || account.status !== 'active' || account.tenantId !== tenantId) return null
    if (!(await this.store.hasActiveMembership(account.id, tenantId))) return null
    return {
      subjectId: account.id,
      sessionId: `whatsapp:${account.id}`,
      tenantId,
      correlationId,
      ...this.scope(account.roles),
    }
  }
}
