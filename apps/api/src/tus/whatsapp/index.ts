import type { AccionWhatsApp } from '@factory/contracts'
import type { TusOperationsTelemetry } from '@factory/observability'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { EvaluadorHabilitacion, PerfilHabilitacion } from '../readiness/index.ts'

const ACTION_STATUS = {
  COMPLETED: 'completed',
  CONFIRMED: 'confirmed',
  HANDOFF: 'handoff',
  REPLAY: 'replay',
} as const

const SUPPORTED_ACTIONS = new Set<AccionWhatsApp['type']>([
  'search',
  'quote',
  'cart',
  'status',
  'handoff',
  'confirm',
])

const WHATSAPP_RECIPIENT_TYPES = {
  TENANT: 'tenant',
  MERCHANT: 'merchant',
  CUSTOMER: 'customer',
} as const

const WHATSAPP_CONSENT_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const

const WHATSAPP_OUTBOX_STATUS = {
  PENDING: 'pending',
} as const

type TipoDestinatarioWhatsApp = (typeof WHATSAPP_RECIPIENT_TYPES)[keyof typeof WHATSAPP_RECIPIENT_TYPES]
type EstadoConsentimientoWhatsApp = (typeof WHATSAPP_CONSENT_STATUS)[keyof typeof WHATSAPP_CONSENT_STATUS]

type EstadoAccionWhatsApp = (typeof ACTION_STATUS)[keyof typeof ACTION_STATUS]

export interface EntradaAccionWhatsApp {
  type: string
  tenantId: string
  commitmentId?: string
  confirmationId?: string
}

export interface ItemDescubrimientoWhatsApp {
  listingId: string
  tenantId: string
  name: string
  price: number
  currency: string
  availabilityVersion?: number
  available?: boolean
}

export interface SolicitudAccionWhatsApp extends TusAuthenticatedTenantContext {
  senderId: string
  action: EntradaAccionWhatsApp
  consent: boolean
  idempotencyKey: string
  requestHash: string
  confirmationId?: string
}

export interface ResultadoAccionWhatsApp {
  status: EstadoAccionWhatsApp
  reason?: string
  tenantId: string
  credentialsCollected: false
  mutated: boolean
  items?: readonly ItemDescubrimientoWhatsApp[]
  confirmationId?: string
  expiresAt?: string
  commitment?: Record<string, unknown> | null
}

export interface EntradaCompromisoWhatsApp {
  tenantId: string
  senderId: string
  confirmationId: string
  items: readonly ItemDescubrimientoWhatsApp[]
}

export interface RegistroAuditoriaAccionWhatsApp {
  action: string
  outcome: 'allowed' | 'denied' | 'handoff'
  tenantId: string
  actorId: string
  senderId: string
  correlationId: string
  createdAt: string
  retentionUntil?: string
}

export interface ConsentimientoWhatsApp {
  consentId: string
  tenantId: string
  recipientType: TipoDestinatarioWhatsApp
  recipientId: string
  status: EstadoConsentimientoWhatsApp
  source: string
  grantedAt: string
  revokedAt: string | null
  updatedAt: string
  retentionUntil: string
}

export interface EntradaListaPermitidaPlantillaWhatsApp {
  name: string
  version: string
  variables: readonly string[]
}

export interface MensajePlantillaWhatsApp {
  messageId: string
  tenantId: string
  recipientType: TipoDestinatarioWhatsApp
  recipientId: string
  template: string
  templateVersion: string
  consentId: string
  requestHash: string
  variables: Record<string, string>
  correlationId: string
  status: 'queued'
  createdAt: string
  retentionUntil: string
}

export interface RegistroBandejaSalidaPlantillaWhatsApp {
  eventId: string
  tenantId: string
  correlationId: string
  eventType: 'whatsapp.template.queued' | 'whatsapp.support.handoff'
  aggregateId: string
  payload: Record<string, unknown>
  status: (typeof WHATSAPP_OUTBOX_STATUS)[keyof typeof WHATSAPP_OUTBOX_STATUS]
  createdAt: string
  retentionUntil: string
}

export interface DerivacionSoporteWhatsApp {
  handoffId: string
  tenantId: string
  senderId: string
  reason: string
  status: 'handoff'
  createdAt: string
}

interface AccionAlmacenada {
  requestHash: string
  response: ResultadoAccionWhatsApp | null
}

type MaybePromise<TValue> = TValue | Promise<TValue>

export interface ConfirmacionWhatsApp {
  confirmationId: string
  tenantId: string
  senderId: string
  expiresAt: number
  consumed: boolean
  items: readonly ItemDescubrimientoWhatsApp[]
}

export interface PuertoAlmacenAccionWhatsApp {
  claim(tenantId: string, key: string, requestHash: string): MaybePromise<'claimed' | 'replay' | 'in_progress' | 'conflict'>
  response(tenantId: string, key: string): MaybePromise<ResultadoAccionWhatsApp | null>
  complete(tenantId: string, key: string, response: ResultadoAccionWhatsApp): MaybePromise<void>
  saveConfirmation(value: ConfirmacionWhatsApp): MaybePromise<void>
  getConfirmation(tenantId: string, confirmationId: string): MaybePromise<ConfirmacionWhatsApp | null>
  consumeConfirmation(tenantId: string, confirmationId: string, senderId: string, now: number): MaybePromise<boolean>
  registrarAuditoriaWhatsApp(value: RegistroAuditoriaAccionWhatsApp): MaybePromise<void>
  listAudits(tenantId: string): RegistroAuditoriaAccionWhatsApp[]
  saveConsent?(value: ConsentimientoWhatsApp): MaybePromise<void>
  getConsent?(tenantId: string, recipientType: TipoDestinatarioWhatsApp, recipientId: string): MaybePromise<ConsentimientoWhatsApp | null>
  saveTemplateMessage?(value: MensajePlantillaWhatsApp): MaybePromise<void>
  getTemplateMessage?(tenantId: string, idempotencyKey: string): MaybePromise<MensajePlantillaWhatsApp | null>
  saveOutbox?(value: RegistroBandejaSalidaPlantillaWhatsApp): MaybePromise<void>
  listOutbox?(tenantId: string): RegistroBandejaSalidaPlantillaWhatsApp[]
}

export class WhatsAppActionError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'WhatsAppActionError'
    this.status = status
    this.code = code
  }
}

export class InMemoryWhatsAppActionStore implements PuertoAlmacenAccionWhatsApp {
  private readonly actions = new Map<string, AccionAlmacenada>()
  private readonly confirmations = new Map<string, ConfirmacionWhatsApp>()
  private readonly audits: RegistroAuditoriaAccionWhatsApp[] = []
  private readonly consents = new Map<string, ConsentimientoWhatsApp>()
  private readonly templateMessages = new Map<string, MensajePlantillaWhatsApp>()
  private readonly outboxRecords = new Map<string, RegistroBandejaSalidaPlantillaWhatsApp>()

  claim(tenantId: string, key: string, requestHash: string): 'claimed' | 'replay' | 'in_progress' | 'conflict' {
    const mapKey = `${tenantId}:${key}`
    const existing = this.actions.get(mapKey)
    if (!existing) {
      this.actions.set(mapKey, { requestHash, response: null })
      return 'claimed'
    }
    if (existing.requestHash !== requestHash) return 'conflict'
    return existing.response ? 'replay' : 'in_progress'
  }

  complete(tenantId: string, key: string, response: ResultadoAccionWhatsApp): void {
    const existing = this.actions.get(`${tenantId}:${key}`)
    if (!existing) throw new Error('WhatsApp action idempotency record not found')
    existing.response = clone(response)
  }

  response(tenantId: string, key: string): ResultadoAccionWhatsApp | null {
    const stored = this.actions.get(`${tenantId}:${key}`)?.response
    return stored ? clone(stored) : null
  }

  saveConfirmation(value: ConfirmacionWhatsApp): void {
    this.confirmations.set(`${value.tenantId}:${value.confirmationId}`, clone(value))
  }

  getConfirmation(tenantId: string, confirmationId: string): ConfirmacionWhatsApp | null {
    const value = this.confirmations.get(`${tenantId}:${confirmationId}`)
    return value ? clone(value) : null
  }

  consumeConfirmation(tenantId: string, confirmationId: string, senderId: string, now: number): boolean {
    const key = `${tenantId}:${confirmationId}`
    const confirmation = this.confirmations.get(key)
    if (!confirmation || confirmation.consumed || confirmation.senderId !== senderId || confirmation.expiresAt <= now) return false
    confirmation.consumed = true
    return true
  }

  registrarAuditoriaWhatsApp(value: RegistroAuditoriaAccionWhatsApp): void {
    this.audits.push(clone(value))
  }

  listAudits(tenantId: string): RegistroAuditoriaAccionWhatsApp[] {
    return this.audits.filter((audit) => audit.tenantId === tenantId).map(clone)
  }

  saveConsent(value: ConsentimientoWhatsApp): void {
    this.consents.set(`${value.tenantId}:${value.recipientType}:${value.recipientId}`, clone(value))
  }

  getConsent(tenantId: string, recipientType: TipoDestinatarioWhatsApp, recipientId: string): ConsentimientoWhatsApp | null {
    return clone(this.consents.get(`${tenantId}:${recipientType}:${recipientId}`) ?? null)
  }

  saveTemplateMessage(value: MensajePlantillaWhatsApp): void {
    this.templateMessages.set(`${value.tenantId}:${value.messageId}`, clone(value))
  }

  getTemplateMessage(tenantId: string, idempotencyKey: string): MensajePlantillaWhatsApp | null {
    return clone(this.templateMessages.get(`${tenantId}:${idempotencyKey}`) ?? null)
  }

  saveOutbox(value: RegistroBandejaSalidaPlantillaWhatsApp): void {
    this.outboxRecords.set(`${value.tenantId}:${value.eventId}`, clone(value))
  }

  listOutbox(tenantId: string): RegistroBandejaSalidaPlantillaWhatsApp[] {
    return [...this.outboxRecords.values()].filter((record) => record.tenantId === tenantId).map(clone)
  }
}

interface ClientePrismaWhatsApp {
  accionWhatsApp: {
    findUnique(input: { where: { tenantId_claveIdempotencia: { tenantId: string; claveIdempotencia: string } } }): Promise<Record<string, unknown> | null>
    findFirst(input: { where: { claveIdempotencia: string } }): Promise<Record<string, unknown> | null>
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
    update(input: { where: { tenantId_claveIdempotencia: { tenantId: string; claveIdempotencia: string } }; data: Record<string, unknown> }): Promise<Record<string, unknown>>
  }
  confirmacionWhatsApp: {
    upsert(input: { where: { tenantId_confirmacionId: { tenantId: string; confirmacionId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
    findUnique(input: { where: { tenantId_confirmacionId: { tenantId: string; confirmacionId: string } } }): Promise<Record<string, unknown> | null>
    updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  }
  auditoriaWhatsApp: {
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
  }
  consentimientoWhatsApp?: {
    upsert(input: { where: { tenantId_destinatarioId: { tenantId: string; destinatarioId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
    findUnique(input: { where: { tenantId_destinatarioId: { tenantId: string; destinatarioId: string } } }): Promise<Record<string, unknown> | null>
  }
  mensajeWhatsApp?: {
    upsert(input: { where: { tenantId_mensajeId: { tenantId: string; mensajeId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
    findUnique(input: { where: { tenantId_mensajeId: { tenantId: string; mensajeId: string } } }): Promise<Record<string, unknown> | null>
  }
  tusWhatsAppOutbox?: {
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
    findMany(input: { where: { tenantId: string } }): Promise<Record<string, unknown>[]>
  }
}

export class PrismaWhatsAppActionStore implements PuertoAlmacenAccionWhatsApp {
  private readonly audits: RegistroAuditoriaAccionWhatsApp[] = []
  private readonly outboxRecords: RegistroBandejaSalidaPlantillaWhatsApp[] = []
  private readonly client: ClientePrismaWhatsApp

  constructor(client: ClientePrismaWhatsApp) {
    this.client = client
  }

  async claim(tenantId: string, key: string, requestHash: string): Promise<'claimed' | 'replay' | 'in_progress' | 'conflict'> {
    const existing = await this.client.accionWhatsApp.findUnique({ where: { tenantId_claveIdempotencia: { tenantId, claveIdempotencia: key } } })
    const foreign = await this.client.accionWhatsApp.findFirst({ where: { claveIdempotencia: key } })
    if (foreign && String(foreign['tenantId']) !== tenantId) return 'conflict'
    if (!existing) {
      try {
        await this.client.accionWhatsApp.create({ data: { id: `wa-action-${tenantId}-${key}`, tenantId, claveIdempotencia: key, hashSolicitud: requestHash, estado: 'pending', respuesta: null, fechaCreacion: new Date(), fechaActualizacion: new Date() } })
        return 'claimed'
      } catch {
        return this.claim(tenantId, key, requestHash)
      }
    }
    if (String(existing['hashSolicitud']) !== requestHash) return 'conflict'
    return existing['estado'] === 'completed' && existing['respuesta'] ? 'replay' : 'in_progress'
  }

  async response(tenantId: string, key: string): Promise<ResultadoAccionWhatsApp | null> {
    const row = await this.client.accionWhatsApp.findUnique({ where: { tenantId_claveIdempotencia: { tenantId, claveIdempotencia: key } } })
    return row?.['respuesta'] ? row['respuesta'] as ResultadoAccionWhatsApp : null
  }

  async complete(tenantId: string, key: string, response: ResultadoAccionWhatsApp): Promise<void> {
    await this.client.accionWhatsApp.update({ where: { tenantId_claveIdempotencia: { tenantId, claveIdempotencia: key } }, data: { estado: 'completed', respuesta: response, fechaActualizacion: new Date() } })
  }

  async saveConfirmation(value: ConfirmacionWhatsApp): Promise<void> {
    await this.client.confirmacionWhatsApp.upsert({
      where: { tenantId_confirmacionId: { tenantId: value.tenantId, confirmacionId: value.confirmationId } },
      create: { id: `${value.tenantId}:${value.confirmationId}`, confirmacionId: value.confirmationId, tenantId: value.tenantId, remitenteId: value.senderId, fechaExpiracion: new Date(value.expiresAt), fechaConsumo: null, elementos: value.items, fechaCreacion: new Date() },
      update: { remitenteId: value.senderId, fechaExpiracion: new Date(value.expiresAt), fechaConsumo: null, elementos: value.items },
    })
  }

  async getConfirmation(tenantId: string, confirmationId: string): Promise<ConfirmacionWhatsApp | null> {
    const row = await this.client.confirmacionWhatsApp.findUnique({ where: { tenantId_confirmacionId: { tenantId, confirmacionId: confirmationId } } })
    if (!row) return null
    return { confirmationId: String(row['confirmacionId']), tenantId: String(row['tenantId']), senderId: String(row['remitenteId']), expiresAt: new Date(String(row['fechaExpiracion'])).getTime(), consumed: row['fechaConsumo'] !== null, items: row['elementos'] as ItemDescubrimientoWhatsApp[] }
  }

  async consumeConfirmation(tenantId: string, confirmationId: string, senderId: string, now: number): Promise<boolean> {
    const result = await this.client.confirmacionWhatsApp.updateMany({ where: { tenantId, confirmacionId: confirmationId, remitenteId: senderId, fechaConsumo: null, fechaExpiracion: { gt: new Date(now) } }, data: { fechaConsumo: new Date(now) } })
    return result.count === 1
  }

  async registrarAuditoriaWhatsApp(value: RegistroAuditoriaAccionWhatsApp): Promise<void> {
    this.audits.push(clone(value))
    await this.client.auditoriaWhatsApp.create({ data: { id: `${value.tenantId}:${value.action}:${value.createdAt}:${this.audits.length}`, tenantId: value.tenantId, accion: value.action, resultado: value.outcome, actorId: value.actorId, remitenteId: value.senderId, correlacionId: value.correlationId, fechaCreacion: new Date(value.createdAt), retencionHasta: value.retentionUntil ? new Date(value.retentionUntil) : null } })
  }

  listAudits(tenantId: string): RegistroAuditoriaAccionWhatsApp[] {
    return this.audits.filter((audit) => audit.tenantId === tenantId).map(clone)
  }

  async saveConsent(value: ConsentimientoWhatsApp): Promise<void> {
    if (!this.client.consentimientoWhatsApp) return
    await this.client.consentimientoWhatsApp.upsert({
      where: { tenantId_destinatarioId: { tenantId: value.tenantId, destinatarioId: value.recipientId } },
      create: { id: value.consentId, tenantId: value.tenantId, destinatarioId: value.recipientId, tipoDestinatario: value.recipientType, estado: value.status, origen: value.source, fechaOtorgamiento: new Date(value.grantedAt), fechaRevocacion: value.revokedAt ? new Date(value.revokedAt) : null, fechaCreacion: new Date(value.grantedAt), fechaActualizacion: new Date(value.updatedAt) },
      update: { tipoDestinatario: value.recipientType, estado: value.status, origen: value.source, fechaOtorgamiento: new Date(value.grantedAt), fechaRevocacion: value.revokedAt ? new Date(value.revokedAt) : null, fechaActualizacion: new Date(value.updatedAt) },
    })
  }

  async getConsent(tenantId: string, _recipientType: TipoDestinatarioWhatsApp, recipientId: string): Promise<ConsentimientoWhatsApp | null> {
    if (!this.client.consentimientoWhatsApp) return null
    const row = await this.client.consentimientoWhatsApp.findUnique({ where: { tenantId_destinatarioId: { tenantId, destinatarioId: recipientId } } })
    if (!row) return null
    return { consentId: String(row['id']), tenantId: String(row['tenantId']), recipientType: String(row['tipoDestinatario']) as TipoDestinatarioWhatsApp, recipientId: String(row['destinatarioId']), status: String(row['estado']) as EstadoConsentimientoWhatsApp, source: String(row['origen']), grantedAt: new Date(String(row['fechaOtorgamiento'])).toISOString(), revokedAt: row['fechaRevocacion'] ? new Date(String(row['fechaRevocacion'])).toISOString() : null, updatedAt: new Date(String(row['fechaActualizacion'])).toISOString(), retentionUntil: new Date(String(row['fechaActualizacion'])).toISOString() }
  }

  async saveTemplateMessage(value: MensajePlantillaWhatsApp): Promise<void> {
    if (!this.client.mensajeWhatsApp) return
    await this.client.mensajeWhatsApp.upsert({
      where: { tenantId_mensajeId: { tenantId: value.tenantId, mensajeId: value.messageId } },
      create: { id: `${value.tenantId}:${value.messageId}`, tenantId: value.tenantId, mensajeId: value.messageId, destinatarioId: value.recipientId, plantilla: value.template, versionPlantilla: value.templateVersion, consentimientoId: value.consentId, hashSolicitud: value.requestHash, variables: value.variables, estado: value.status, correlacionId: value.correlationId, fechaCreacion: new Date(value.createdAt), fechaActualizacion: new Date(value.createdAt), retencionHasta: new Date(value.retentionUntil) },
      update: { variables: value.variables, estado: value.status, fechaActualizacion: new Date(value.createdAt), retencionHasta: new Date(value.retentionUntil) },
    })
  }

  async getTemplateMessage(tenantId: string, idempotencyKey: string): Promise<MensajePlantillaWhatsApp | null> {
    if (!this.client.mensajeWhatsApp) return null
    const row = await this.client.mensajeWhatsApp.findUnique({ where: { tenantId_mensajeId: { tenantId, mensajeId: idempotencyKey } } })
    if (!row) return null
    return { messageId: String(row['mensajeId']), tenantId: String(row['tenantId']), recipientType: 'customer', recipientId: String(row['destinatarioId']), template: String(row['plantilla']), templateVersion: String(row['versionPlantilla']), consentId: String(row['consentimientoId']), requestHash: String(row['hashSolicitud'] ?? ''), variables: row['variables'] as Record<string, string>, correlationId: String(row['correlacionId']), status: 'queued', createdAt: new Date(String(row['fechaCreacion'])).toISOString(), retentionUntil: new Date(String(row['retencionHasta'])).toISOString() }
  }

  async saveOutbox(value: RegistroBandejaSalidaPlantillaWhatsApp): Promise<void> {
    this.outboxRecords.push(clone(value))
    await this.client.tusWhatsAppOutbox?.create({ data: { id: `${value.tenantId}:${value.eventId}`, ...value, createdAt: new Date(value.createdAt), retentionUntil: new Date(value.retentionUntil) } })
  }

  listOutbox(tenantId: string): RegistroBandejaSalidaPlantillaWhatsApp[] {
    return this.outboxRecords.filter((record) => record.tenantId === tenantId).map(clone)
  }
}

export interface OpcionesServicioWhatsApp {
  store: PuertoAlmacenAccionWhatsApp
  discover?: (tenantId: string) => Promise<readonly ItemDescubrimientoWhatsApp[]>
  commitments?: (tenantId: string, commitmentId: string) => Promise<Record<string, unknown> | null>
  commit?: (input: EntradaCompromisoWhatsApp) => Promise<Record<string, unknown>>
  authorizedSenders?: Readonly<Record<string, readonly string[]>>
  authorizeSender?: (tenantId: string, senderId: string) => boolean | Promise<boolean>
  telemetry?: TusOperationsTelemetry
  now?: () => number
  confirmationTtlMs?: number
  evaluadorHabilitacion?: EvaluadorHabilitacion
  perfilHabilitacion?: PerfilHabilitacion
  alcanceHabilitacion?: string
  providerEnabled?: boolean
  templateAllowlist?: readonly EntradaListaPermitidaPlantillaWhatsApp[]
  supportHandoff?: (input: { tenantId: string; senderId: string; reason: string; correlationId: string }) => Promise<{ handoffId: string }>
  retentionMs?: number
}

export class TusWhatsAppService {
  readonly store: PuertoAlmacenAccionWhatsApp
  readonly audit: { list(tenantId: string): RegistroAuditoriaAccionWhatsApp[] }
  private readonly discover: (tenantId: string) => Promise<readonly ItemDescubrimientoWhatsApp[]>
  private readonly commitments: (tenantId: string, commitmentId: string) => Promise<Record<string, unknown> | null>
  private readonly commit?: (input: EntradaCompromisoWhatsApp) => Promise<Record<string, unknown>>
  private readonly authorizedSenders?: Readonly<Record<string, readonly string[]>>
  private readonly authorizeSender?: (tenantId: string, senderId: string) => boolean | Promise<boolean>
  private readonly telemetry?: TusOperationsTelemetry
  private readonly now: () => number
  private readonly confirmationTtlMs: number
  private readonly sessions = new Map<string, string>()
  private readonly evaluadorHabilitacion?: EvaluadorHabilitacion
  private readonly perfilHabilitacion: PerfilHabilitacion
  private readonly alcanceHabilitacion: string
  private readonly providerEnabled: boolean
  private readonly templateAllowlist: ReadonlyMap<string, EntradaListaPermitidaPlantillaWhatsApp>
  private readonly supportHandoff?: OpcionesServicioWhatsApp['supportHandoff']
  private readonly retentionMs: number

  constructor(options: OpcionesServicioWhatsApp) {
    this.store = options.store
    this.discover = options.discover ?? (async () => [])
    this.commitments = options.commitments ?? (async () => null)
    this.commit = options.commit
    this.authorizedSenders = options.authorizedSenders
    this.authorizeSender = options.authorizeSender
    this.telemetry = options.telemetry
    this.now = options.now ?? (() => Date.now())
    this.confirmationTtlMs = options.confirmationTtlMs ?? 5 * 60 * 1000
    this.evaluadorHabilitacion = options.evaluadorHabilitacion
    this.perfilHabilitacion = options.perfilHabilitacion ?? 'native-local'
    this.alcanceHabilitacion = options.alcanceHabilitacion ?? 'argentina-stage-1'
    this.providerEnabled = options.providerEnabled ?? true
    this.templateAllowlist = new Map((options.templateAllowlist ?? []).map((entry) => [`${entry.name}:${entry.version}`, { ...entry, variables: [...entry.variables] }]))
    this.supportHandoff = options.supportHandoff
    this.retentionMs = options.retentionMs ?? 365 * 24 * 60 * 60 * 1000
    this.audit = { list: (tenantId) => this.store.listAudits(tenantId) }
  }

  async recordConsent(
    context: TusAuthenticatedTenantContext,
    input: { recipientType: TipoDestinatarioWhatsApp; recipientId: string; source: string; granted: boolean },
  ): Promise<ConsentimientoWhatsApp> {
    this.authorizeMessaging(context)
    if (!esTipoDestinatario(input.recipientType) || !input.recipientId.trim() || !input.source.trim()) {
      throw new WhatsAppActionError(400, 'INVALID_CONSENT', 'recipient type, recipient, and consent source are required')
    }
    const now = this.now()
    const previous = await this.store.getConsent?.(context.tenantId, input.recipientType, input.recipientId)
    const consent: ConsentimientoWhatsApp = {
      consentId: previous?.consentId ?? `whatsapp-consent-${context.tenantId}-${input.recipientType}-${input.recipientId}`,
      tenantId: context.tenantId,
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      status: input.granted ? WHATSAPP_CONSENT_STATUS.ACTIVE : WHATSAPP_CONSENT_STATUS.REVOKED,
      source: redactText(input.source),
      grantedAt: previous?.grantedAt ?? new Date(now).toISOString(),
      revokedAt: input.granted ? null : new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      retentionUntil: new Date(now + this.retentionMs).toISOString(),
    }
    await this.store.saveConsent?.(consent)
    await this.auditRecord(context, input.granted ? 'whatsapp.consent.granted' : 'whatsapp.consent.revoked', 'allowed', input.recipientId)
    return clone(consent)
  }

  async optOut(
    context: TusAuthenticatedTenantContext,
    input: { recipientType: TipoDestinatarioWhatsApp; recipientId: string; source?: string },
  ): Promise<ConsentimientoWhatsApp> {
    return this.recordConsent(context, { ...input, source: input.source ?? 'whatsapp-opt-out', granted: false })
  }

  async sendTemplate(
    context: TusAuthenticatedTenantContext,
    input: { recipientType: TipoDestinatarioWhatsApp; recipientId: string; template: string; templateVersion: string; variables: Record<string, unknown>; idempotencyKey: string; requestHash: string },
  ): Promise<MensajePlantillaWhatsApp> {
    this.authorizeMessaging(context)
    if (!this.providerEnabled) throw new WhatsAppActionError(503, 'PROVIDER_DISABLED', 'WhatsApp provider actions are disabled')
    const consent = await this.store.getConsent?.(context.tenantId, input.recipientType, input.recipientId)
    if (!consent || consent.status !== WHATSAPP_CONSENT_STATUS.ACTIVE) throw new WhatsAppActionError(409, 'CONSENT_REQUIRED', 'current WhatsApp consent is required')
    const template = this.templateAllowlist.get(`${input.template}:${input.templateVersion}`)
    if (!template) throw new WhatsAppActionError(409, 'TEMPLATE_NOT_ALLOWED', 'WhatsApp template is not allowlisted')
    if (!input.idempotencyKey.trim() || !input.requestHash.trim()) throw new WhatsAppActionError(400, 'INVALID_IDEMPOTENCY', 'template idempotency key and request hash are required')
    const prior = await this.store.getTemplateMessage?.(context.tenantId, input.idempotencyKey)
    if (prior) {
      if (prior.requestHash !== input.requestHash) throw new WhatsAppActionError(409, 'IDEMPOTENCY_CONFLICT', 'WhatsApp template idempotency key was reused with a different request')
      return clone(prior)
    }
    const variables = redactarVariablesPlantilla(template.variables, input.variables)
    const now = this.now()
    const message: MensajePlantillaWhatsApp = {
      messageId: input.idempotencyKey,
      tenantId: context.tenantId,
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      template: template.name,
      templateVersion: template.version,
      consentId: consent.consentId,
      requestHash: input.requestHash,
      variables,
      correlationId: context.correlationId,
      status: 'queued',
      createdAt: new Date(now).toISOString(),
      retentionUntil: new Date(now + this.retentionMs).toISOString(),
    }
    await this.store.saveTemplateMessage?.(message)
    await this.store.saveOutbox?.({ eventId: `whatsapp-template-${input.idempotencyKey}`, tenantId: context.tenantId, correlationId: context.correlationId, eventType: 'whatsapp.template.queued', aggregateId: message.messageId, payload: { recipientType: message.recipientType, recipientId: message.recipientId, template: message.template, templateVersion: message.templateVersion, consentId: message.consentId, variables: message.variables, requestHash: input.requestHash }, status: WHATSAPP_OUTBOX_STATUS.PENDING, createdAt: message.createdAt, retentionUntil: message.retentionUntil })
    await this.auditRecord(context, 'whatsapp.template.queued', 'allowed', input.recipientId)
    return clone(message)
  }

  async handoffToSupport(context: TusAuthenticatedTenantContext, input: { senderId: string; reason: string }): Promise<DerivacionSoporteWhatsApp> {
    this.authorizeMessaging(context)
    if (!input.senderId.trim() || !input.reason.trim()) throw new WhatsAppActionError(400, 'INVALID_HANDOFF', 'sender and handoff reason are required')
    const handoff = await this.supportHandoff?.({ tenantId: context.tenantId, senderId: input.senderId, reason: redactText(input.reason), correlationId: context.correlationId })
    const value: DerivacionSoporteWhatsApp = { handoffId: handoff?.handoffId ?? `support-handoff-${context.tenantId}-${this.now()}`, tenantId: context.tenantId, senderId: input.senderId, reason: redactText(input.reason), status: 'handoff', createdAt: new Date(this.now()).toISOString() }
    await this.auditRecord(context, 'whatsapp.support.handoff', 'handoff', input.senderId)
    await this.store.saveOutbox?.({ eventId: `whatsapp-handoff-${value.handoffId}`, tenantId: context.tenantId, correlationId: context.correlationId, eventType: 'whatsapp.support.handoff', aggregateId: value.handoffId, payload: { handoffId: value.handoffId, senderId: value.senderId, reason: value.reason }, status: WHATSAPP_OUTBOX_STATUS.PENDING, createdAt: value.createdAt, retentionUntil: new Date(this.now() + this.retentionMs).toISOString() })
    return value
  }

  async execute(input: SolicitudAccionWhatsApp): Promise<ResultadoAccionWhatsApp> {
    const startedAt = this.now()
    this.validateRequest(input)
    await this.evaluadorHabilitacion?.require({ tenantId: input.tenantId, actorId: input.subjectId, correlationId: input.correlationId, capability: 'provider-actions', profile: this.perfilHabilitacion, scope: this.alcanceHabilitacion })
    const claim = await this.store.claim(input.tenantId, input.idempotencyKey, input.requestHash)
    if (claim === 'conflict') return this.finish(input, await this.handoff(input, 'idempotency_conflict'), startedAt)
    if (claim === 'replay') {
      const existing = await this.store.response(input.tenantId, input.idempotencyKey)
      if (existing) return this.finish(input, { ...existing, status: ACTION_STATUS.REPLAY }, startedAt)
    }
    if (claim === 'in_progress') return this.finish(input, await this.handoff(input, 'idempotency_in_progress'), startedAt)

    const result = await this.executeClaimed(input)
    await this.store.complete(input.tenantId, input.idempotencyKey, result)
    return this.finish(input, result, startedAt)
  }

  private async executeClaimed(input: SolicitudAccionWhatsApp): Promise<ResultadoAccionWhatsApp> {
    if (!input.permissions.includes('tus:whatsapp:write') && !input.permissions.includes('tus:*')) return this.handoff(input, 'authorization_required')
    const knownTenant = this.sessions.get(input.sessionId)
    if (knownTenant && knownTenant !== input.tenantId) return this.handoff(input, 'tenant_boundary_denied')
    this.sessions.set(input.sessionId, input.tenantId)
    if (input.action.tenantId !== input.tenantId) return this.handoff(input, 'tenant_boundary_denied')
    const storedConsent = await this.store.getConsent?.(input.tenantId, WHATSAPP_RECIPIENT_TYPES.CUSTOMER, input.senderId)
    if (!input.consent || storedConsent?.status === WHATSAPP_CONSENT_STATUS.REVOKED) return this.handoff(input, 'messaging_consent_required')
    if (!(await this.isSenderAuthorized(input.tenantId, input.senderId))) return this.handoff(input, 'sender_not_authorized')
    if (!SUPPORTED_ACTIONS.has(input.action.type as AccionWhatsApp['type'])) {
      return this.handoff(input, 'sensitive_action_requires_authenticated_handoff')
    }
    return this.executeAction(input)
  }

  private async executeAction(input: SolicitudAccionWhatsApp): Promise<ResultadoAccionWhatsApp> {
    const type = input.action.type
    if (type === 'handoff') return this.handoff(input, 'customer_requested_handoff')
    if (type === 'search') {
      const items = await this.discover(input.tenantId)
      return this.completed(input, { items })
    }
    if (type === 'quote') {
      const items = await this.discover(input.tenantId)
      const expiresAt = this.now() + this.confirmationTtlMs
      const confirmationId = `wa-confirmation-${input.tenantId}-${input.idempotencyKey}`
      await this.store.saveConfirmation({ confirmationId, tenantId: input.tenantId, senderId: input.senderId, expiresAt, consumed: false, items: crearInstantaneaItems(items) })
      return this.completed(input, { items, confirmationId, expiresAt: new Date(expiresAt).toISOString() })
    }
    if (type === 'confirm') {
      const confirmationId = input.confirmationId ?? input.action.confirmationId ?? ''
      const confirmation = await this.store.getConfirmation(input.tenantId, confirmationId)
      if (!confirmation || confirmation.consumed || confirmation.senderId !== input.senderId || confirmation.expiresAt <= this.now()) return this.handoff(input, 'confirmation_expired_or_consumed')
      const currentItems = await this.discover(input.tenantId)
      if (!mismaDisponibilidad(confirmation.items, currentItems)) return this.handoff(input, 'quote_stale_or_unavailable')
      if (!(await this.store.consumeConfirmation(input.tenantId, confirmationId, input.senderId, this.now()))) return this.handoff(input, 'confirmation_expired_or_consumed')
      const commitment = this.commit ? await this.commit({ tenantId: input.tenantId, senderId: input.senderId, confirmationId, items: confirmation.items }) : null
      return this.completed(input, { confirmationId, status: ACTION_STATUS.CONFIRMED, mutated: this.commitmentMutated(commitment), commitment })
    }
    if (type === 'status') {
      const commitmentId = input.action.commitmentId ?? ''
      const commitment = commitmentId ? await this.commitments(input.tenantId, commitmentId) : null
      return this.completed(input, { commitment })
    }
    return this.completed(input)
  }

  private async completed(input: SolicitudAccionWhatsApp, extra: Partial<ResultadoAccionWhatsApp> = {}): Promise<ResultadoAccionWhatsApp> {
    const result: ResultadoAccionWhatsApp = {
      status: ACTION_STATUS.COMPLETED,
      tenantId: input.tenantId,
      credentialsCollected: false,
      mutated: false,
      ...extra,
    }
    await this.auditRecord(input, 'whatsapp.action.completed', 'allowed')
    return result
  }

  private async handoff(input: SolicitudAccionWhatsApp, reason: string): Promise<ResultadoAccionWhatsApp> {
    const result: ResultadoAccionWhatsApp = {
      status: ACTION_STATUS.HANDOFF,
      reason,
      tenantId: input.tenantId,
      credentialsCollected: false,
      mutated: false,
    }
    await this.auditRecord(input, 'whatsapp.action.denied', 'denied')
    return result
  }

  private async auditRecord(input: TusAuthenticatedTenantContext, action: string, outcome: RegistroAuditoriaAccionWhatsApp['outcome'], senderId = input.subjectId): Promise<void> {
    await this.store.registrarAuditoriaWhatsApp({
      action,
      outcome,
      tenantId: input.tenantId,
      actorId: input.subjectId,
      senderId,
      correlationId: input.correlationId,
      createdAt: new Date(this.now()).toISOString(),
      retentionUntil: new Date(this.now() + this.retentionMs).toISOString(),
    })
  }

  private authorizeMessaging(context: TusAuthenticatedTenantContext): void {
    if (!context.tenantId.trim() || !context.subjectId.trim() || !context.correlationId.trim() || (!context.permissions.includes('tus:whatsapp:write') && !context.permissions.includes('tus:*'))) {
      throw new WhatsAppActionError(403, 'FORBIDDEN', 'TUS WhatsApp actions are not authorized')
    }
  }

  private validateRequest(input: SolicitudAccionWhatsApp): void {
    if (!input.sessionId.trim() || !input.tenantId.trim() || !input.subjectId.trim() || !input.correlationId.trim() || !input.senderId.trim()) throw new WhatsAppActionError(400, 'INVALID_CONTEXT', 'WhatsApp session, tenant, and sender context are required')
    if (!input.idempotencyKey.trim() || !input.requestHash.trim()) throw new WhatsAppActionError(400, 'INVALID_IDEMPOTENCY', 'WhatsApp idempotency key and request hash are required')
  }

  private async isSenderAuthorized(tenantId: string, senderId: string): Promise<boolean> {
    if (this.authorizeSender) return this.authorizeSender(tenantId, senderId)
    if (this.authorizedSenders) return this.authorizedSenders[tenantId]?.includes(senderId) ?? false
    return true
  }

  private commitmentMutated(commitment: Record<string, unknown> | null): boolean {
    return commitment !== null
  }

  private finish(input: SolicitudAccionWhatsApp, result: ResultadoAccionWhatsApp, startedAt: number): ResultadoAccionWhatsApp {
    this.telemetry?.record({
      name: 'tus.whatsapp.action',
      outcome: result.status === ACTION_STATUS.HANDOFF ? 'denied' : 'success',
      correlationId: input.correlationId,
      tenantId: input.tenantId,
      actorId: input.subjectId,
      latencyMs: Math.max(0, this.now() - startedAt),
      attributes: { action: input.action.type, outcome: result.status },
    })
    return result
  }
}

function crearInstantaneaItems(items: readonly ItemDescubrimientoWhatsApp[]): ItemDescubrimientoWhatsApp[] {
  return items.filter((item) => item.available !== false).map((item) => ({ ...item }))
}

function esTipoDestinatario(value: string): value is TipoDestinatarioWhatsApp {
  return Object.values(WHATSAPP_RECIPIENT_TYPES).includes(value as TipoDestinatarioWhatsApp)
}

function redactarVariablesPlantilla(allowed: readonly string[], input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = input[key]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return []
    return [[key, redactText(String(value))]]
  }))
}

function redactText(value: string): string {
  return value
    .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:password|secret|token|credential|api[_-]?key)\s*[:=]\s*\S+/gi, '[REDACTED]')
}

function mismaDisponibilidad(snapshot: readonly ItemDescubrimientoWhatsApp[], current: readonly ItemDescubrimientoWhatsApp[]): boolean {
  const currentById = new Map(crearInstantaneaItems(current).map((item) => [item.listingId, item]))
  return snapshot.length > 0 && snapshot.every((item) => {
    const fresh = currentById.get(item.listingId)
    return fresh !== undefined && fresh.price === item.price && fresh.currency === item.currency && (fresh.availabilityVersion ?? 0) === (item.availabilityVersion ?? 0)
  })
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export default { TusWhatsAppService, InMemoryWhatsAppActionStore, PrismaWhatsAppActionStore, WhatsAppActionError }
