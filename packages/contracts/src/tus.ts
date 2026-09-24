import { CONTRACT_VERSION, ContractValidationError } from './base.ts'

export const TUS_CONTRACT_VERSION = CONTRACT_VERSION

export type TusContractVersion = typeof TUS_CONTRACT_VERSION

export interface TusErrorEnvelope {
  code: string
  error: string
  details?: Record<string, unknown>
}

export const COHORTES_MERCADO_SERVICIOS = {
  BEAUTY_PERSONAL_CARE: 'beauty-personal-care',
  REPAIRS_TRADES: 'repairs-trades',
} as const

export type CohorteMercadoServicios = (typeof COHORTES_MERCADO_SERVICIOS)[keyof typeof COHORTES_MERCADO_SERVICIOS]

export const TIPOS_PUBLICACION_MERCADO_SERVICIOS = {
  PRODUCT: 'product',
  SERVICE: 'service',
} as const

export type ContextoCompromiso = (typeof TIPOS_PUBLICACION_MERCADO_SERVICIOS)[keyof typeof TIPOS_PUBLICACION_MERCADO_SERVICIOS]

export const MODALIDADES_RESERVA_MERCADO_SERVICIOS = {
  FIXED_SHIFT: 'fixed_shift',
  VISIT_DIAGNOSTIC: 'visita_diagnostico',
  VARIABLE_DURATION: 'variable_duration',
  ESTIMATED_DURATION: 'duracion_estimada',
  REQUIRES_BUDGET: 'requiere_presupuesto',
} as const

export type ModalidadReservaMercadoServicios = (typeof MODALIDADES_RESERVA_MERCADO_SERVICIOS)[keyof typeof MODALIDADES_RESERVA_MERCADO_SERVICIOS]

export const MODALIDADES_PRECIO_MERCADO_SERVICIOS = {
  FIXED: 'fixed',
  REQUIRES_BUDGET: 'requires_budget',
  FIXED_PHYSICAL: 'precio_fijo',
  FROM_PRICE: 'precio_desde',
  HOURLY: 'por_hora',
  BUDGET: 'presupuesto',
} as const

export type ModalidadPrecioMercadoServicios = (typeof MODALIDADES_PRECIO_MERCADO_SERVICIOS)[keyof typeof MODALIDADES_PRECIO_MERCADO_SERVICIOS]

export type EstadoDisponibilidadMercadoServicios = 'configured' | 'not_configured'

export const ESTADOS_COMPROMISO = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  FULFILLED: 'fulfilled',
  FROZEN: 'frozen',
  RELEASED: 'released',
  COMPENSATED: 'compensated',
} as const

export type EstadoCompromiso = (typeof ESTADOS_COMPROMISO)[keyof typeof ESTADOS_COMPROMISO]

export interface TusTenantContext {
  tenantId: string
  actorId: string
  correlationId: string
  idempotencyKey?: string
}

export interface LineaCarrito {
  lineId: string
  context: ContextoCompromiso
  merchantId: string
  amount: number
  currency: string
}

export interface Compromiso {
  contractVersion: TusContractVersion
  commitmentId: string
  cartId: string
  tenantId: string
  merchantId: string
  context: ContextoCompromiso
  amount: number
  currency: string
  status: EstadoCompromiso
  lineIds: string[]
  version: number
  createdAt: string
}

export const ESTADOS_TRABAJO = {
  SOLICITADO: 'requested',
  EN_DIAGNOSTICO: 'in_diagnosis',
  PRESUPUESTO_PENDIENTE: 'budget_pending',
  ACEPTADO: 'accepted',
  EN_PROGRESO: 'in_progress',
  COMPLETADO: 'completed',
  CANCELADO: 'cancelled',
} as const

export type EstadoTrabajo = (typeof ESTADOS_TRABAJO)[keyof typeof ESTADOS_TRABAJO]

export const ESTADOS_DIAGNOSTICO = {
  BORRADOR: 'draft',
  CONFIRMADO: 'confirmed',
  CANCELADO: 'cancelled',
} as const

export type EstadoDiagnostico = (typeof ESTADOS_DIAGNOSTICO)[keyof typeof ESTADOS_DIAGNOSTICO]

export const ESTADOS_PRESUPUESTO = {
  BORRADOR: 'draft',
  EMITIDO: 'issued',
  ACEPTADO: 'accepted',
  RECHAZADO: 'rejected',
  VENCIDO: 'expired',
  CANCELADO: 'cancelled',
} as const

export type EstadoPresupuesto = (typeof ESTADOS_PRESUPUESTO)[keyof typeof ESTADOS_PRESUPUESTO]

export const FASES_EVIDENCIA_TRABAJO = {
  SOLICITUD: 'request',
  DIAGNOSTICO: 'diagnosis',
  PRESUPUESTO: 'budget',
  EJECUCION: 'execution',
  CIERRE: 'completion',
} as const

export type FaseEvidenciaTrabajo = (typeof FASES_EVIDENCIA_TRABAJO)[keyof typeof FASES_EVIDENCIA_TRABAJO]

export type DecisionPresupuesto = 'accepted' | 'rejected'

export interface Trabajo {
  contractVersion: TusContractVersion
  trabajoId: string
  tenantId: string
  prestadorTenantId: string
  commitmentId: string
  prestadorId: string
  publicacionId: string
  reservaId?: string | null
  clienteId?: string | null
  status: EstadoTrabajo
  version: number
  budgetRequired: boolean
  acceptedBudgetId?: string | null
  acceptedBudgetVersion?: number | null
  createdAt: string
  updatedAt: string
}

export interface Diagnostico {
  contractVersion: TusContractVersion
  diagnosticoId: string
  trabajoId: string
  tenantId: string
  version: number
  status: EstadoDiagnostico
  originalDescription: string
  structuredData?: Record<string, unknown> | null
  actorId: string
  correlationId: string
  createdAt: string
  updatedAt: string
  confirmedAt?: string | null
}

export interface LineaPresupuesto {
  lineId: string
  description: string
  quantity: number
  unitAmountMinor: string
  totalAmountMinor: string
}

export interface Presupuesto {
  contractVersion: TusContractVersion
  presupuestoId: string
  trabajoId: string
  tenantId: string
  prestadorTenantId: string
  version: number
  status: EstadoPresupuesto
  currency: string
  totalMinor: string
  scope: string
  validUntil?: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  lines: LineaPresupuesto[]
}

export interface AceptacionPresupuesto {
  contractVersion: TusContractVersion
  acceptanceId: string
  presupuestoId: string
  presupuestoVersion: number
  trabajoId: string
  tenantId: string
  actorId: string
  decision: DecisionPresupuesto
  reason?: string
  createdAt: string
}

export interface EvidenciaTrabajo {
  contractVersion: TusContractVersion
  evidenceId: string
  trabajoId: string
  tenantId: string
  prestadorTenantId: string
  phase: FaseEvidenciaTrabajo
  actorId: string
  correlationId: string
  reference: string
  metadata: Record<string, unknown>
  occurredAt: string
  createdAt: string
}

export function validarTrabajo(value: unknown): Trabajo {
  if (!isRecord(value)) throw new ContractValidationError('tus-work', undefined, 'payload must be an object')
  assertTusVersion('tus-work', value['contractVersion'])
  for (const field of ['trabajoId', 'tenantId', 'prestadorTenantId', 'commitmentId', 'prestadorId', 'publicacionId', 'createdAt', 'updatedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-work', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!Object.values(ESTADOS_TRABAJO).includes(value['status'] as EstadoTrabajo) || !Number.isInteger(value['version']) || Number(value['version']) < 1 || typeof value['budgetRequired'] !== 'boolean' || !isIsoTimestamp(value['createdAt']) || !isIsoTimestamp(value['updatedAt'])) {
    throw new ContractValidationError('tus-work', TUS_CONTRACT_VERSION, 'work state is invalid')
  }
  return value as unknown as Trabajo
}

export function validarDiagnostico(value: unknown): Diagnostico {
  if (!isRecord(value)) throw new ContractValidationError('tus-diagnosis', undefined, 'payload must be an object')
  assertTusVersion('tus-diagnosis', value['contractVersion'])
  for (const field of ['diagnosticoId', 'trabajoId', 'tenantId', 'actorId', 'correlationId', 'originalDescription', 'createdAt', 'updatedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-diagnosis', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!Object.values(ESTADOS_DIAGNOSTICO).includes(value['status'] as EstadoDiagnostico) || !Number.isInteger(value['version']) || Number(value['version']) < 1 || !isIsoTimestamp(value['createdAt']) || !isIsoTimestamp(value['updatedAt'])) {
    throw new ContractValidationError('tus-diagnosis', TUS_CONTRACT_VERSION, 'diagnosis state is invalid')
  }
  return value as unknown as Diagnostico
}

export function validarPresupuesto(value: unknown): Presupuesto {
  if (!isRecord(value)) throw new ContractValidationError('tus-budget', undefined, 'payload must be an object')
  assertTusVersion('tus-budget', value['contractVersion'])
  for (const field of ['presupuestoId', 'trabajoId', 'tenantId', 'prestadorTenantId', 'currency', 'totalMinor', 'scope', 'createdBy', 'createdAt', 'updatedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-budget', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!Object.values(ESTADOS_PRESUPUESTO).includes(value['status'] as EstadoPresupuesto) || !Number.isInteger(value['version']) || Number(value['version']) < 1 || !isMinorAmount(value['totalMinor']) || !isIsoTimestamp(value['createdAt']) || !isIsoTimestamp(value['updatedAt'])) {
    throw new ContractValidationError('tus-budget', TUS_CONTRACT_VERSION, 'budget state is invalid')
  }
  if (value['validUntil'] !== undefined && value['validUntil'] !== null && !isIsoTimestamp(value['validUntil'])) throw new ContractValidationError('tus-budget', TUS_CONTRACT_VERSION, 'validUntil must be a valid timestamp')
  if (!Array.isArray(value['lines']) || value['lines'].length === 0 || value['lines'].some((line) => !isValidBudgetLine(line))) throw new ContractValidationError('tus-budget', TUS_CONTRACT_VERSION, 'budget lines are invalid')
  return value as unknown as Presupuesto
}

export function validarAceptacionPresupuesto(value: unknown): AceptacionPresupuesto {
  if (!isRecord(value)) throw new ContractValidationError('tus-budget-acceptance', undefined, 'payload must be an object')
  assertTusVersion('tus-budget-acceptance', value['contractVersion'])
  for (const field of ['acceptanceId', 'presupuestoId', 'trabajoId', 'tenantId', 'actorId', 'createdAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-budget-acceptance', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!Number.isInteger(value['presupuestoVersion']) || Number(value['presupuestoVersion']) < 1 || !['accepted', 'rejected'].includes(String(value['decision'])) || !isIsoTimestamp(value['createdAt'])) throw new ContractValidationError('tus-budget-acceptance', TUS_CONTRACT_VERSION, 'budget decision is invalid')
  return value as unknown as AceptacionPresupuesto
}

export function validarEvidenciaTrabajo(value: unknown): EvidenciaTrabajo {
  if (!isRecord(value)) throw new ContractValidationError('tus-work-evidence', undefined, 'payload must be an object')
  assertTusVersion('tus-work-evidence', value['contractVersion'])
  for (const field of ['evidenceId', 'trabajoId', 'tenantId', 'prestadorTenantId', 'actorId', 'correlationId', 'reference', 'occurredAt', 'createdAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-work-evidence', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!Object.values(FASES_EVIDENCIA_TRABAJO).includes(value['phase'] as FaseEvidenciaTrabajo) || !isRecord(value['metadata']) || !isIsoTimestamp(value['occurredAt']) || !isIsoTimestamp(value['createdAt'])) throw new ContractValidationError('tus-work-evidence', TUS_CONTRACT_VERSION, 'work evidence is invalid')
  return value as unknown as EvidenciaTrabajo
}

// WEB-09A: canonical financial identity of a WEB-08 service. One obligation per Trabajo; the
// amount is derived server-side from the accepted budget or a fixed-price commitment and is
// carried on the wire as a minor-unit decimal string.
export const ESTADOS_OBLIGACION_PAGO_SERVICIO = {
  PENDIENTE_PAGO: 'pending_payment',
  PAGADA: 'paid',
  REINTEGRADA: 'refunded',
  CONTRACARGO: 'charged_back',
} as const

export type EstadoObligacionPagoServicio = (typeof ESTADOS_OBLIGACION_PAGO_SERVICIO)[keyof typeof ESTADOS_OBLIGACION_PAGO_SERVICIO]

export const ORIGENES_IMPORTE_OBLIGACION_SERVICIO = {
  PRESUPUESTO_ACEPTADO: 'accepted_budget',
  PRECIO_FIJO_COMPROMISO: 'fixed_price_commitment',
} as const

export type OrigenImporteObligacionServicio = (typeof ORIGENES_IMPORTE_OBLIGACION_SERVICIO)[keyof typeof ORIGENES_IMPORTE_OBLIGACION_SERVICIO]

export interface ObligacionPagoServicio {
  contractVersion: TusContractVersion
  obligacionId: string
  tenantId: string
  clienteId: string
  prestadorTenantId: string
  prestadorId: string
  publicacionId: string
  commitmentId: string
  trabajoId: string
  amountSource: OrigenImporteObligacionServicio
  budgetId: string | null
  budgetVersion: number | null
  amountMinor: string
  currency: string
  status: EstadoObligacionPagoServicio
  version: number
  createdAt: string
  updatedAt: string
}

export function validarObligacionPagoServicio(value: unknown): ObligacionPagoServicio {
  if (!isRecord(value)) throw new ContractValidationError('tus-service-payment-obligation', undefined, 'payload must be an object')
  assertTusVersion('tus-service-payment-obligation', value['contractVersion'])
  for (const field of ['obligacionId', 'tenantId', 'clienteId', 'prestadorTenantId', 'prestadorId', 'publicacionId', 'commitmentId', 'trabajoId', 'currency', 'createdAt', 'updatedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-service-payment-obligation', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!Object.values(ESTADOS_OBLIGACION_PAGO_SERVICIO).includes(value['status'] as EstadoObligacionPagoServicio) || !Number.isInteger(value['version']) || Number(value['version']) < 1 || !isMinorAmount(value['amountMinor']) || !/^[A-Z]{3}$/.test(String(value['currency'])) || !isIsoTimestamp(value['createdAt']) || !isIsoTimestamp(value['updatedAt'])) {
    throw new ContractValidationError('tus-service-payment-obligation', TUS_CONTRACT_VERSION, 'obligation state is invalid')
  }
  const budgetBacked = value['amountSource'] === ORIGENES_IMPORTE_OBLIGACION_SERVICIO.PRESUPUESTO_ACEPTADO
  const fixedPrice = value['amountSource'] === ORIGENES_IMPORTE_OBLIGACION_SERVICIO.PRECIO_FIJO_COMPROMISO
  const hasBudget = typeof value['budgetId'] === 'string' && value['budgetId'].length > 0 && Number.isInteger(value['budgetVersion']) && Number(value['budgetVersion']) > 0
  const withoutBudget = value['budgetId'] === null && value['budgetVersion'] === null
  if (!(budgetBacked && hasBudget) && !(fixedPrice && withoutBudget)) throw new ContractValidationError('tus-service-payment-obligation', TUS_CONTRACT_VERSION, 'amount source is inconsistent with the budget reference')
  return value as unknown as ObligacionPagoServicio
}

function isMinorAmount(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
}

function isValidBudgetLine(value: unknown): value is LineaPresupuesto {
  return isRecord(value)
    && typeof value['lineId'] === 'string'
    && typeof value['description'] === 'string'
    && Number.isInteger(value['quantity'])
    && Number(value['quantity']) > 0
    && isMinorAmount(value['unitAmountMinor'])
    && isMinorAmount(value['totalAmountMinor'])
}

export interface PublicacionMercadoServicios {
  contractVersion: TusContractVersion
  listingId: string
  tenantId: string
  merchantId: string
  kind: ContextoCompromiso
  name: string
  description: string
  cohort: CohorteMercadoServicios
  locationId: string
  currency: string
  price: number
  availabilityVersion: number
  published: boolean
  policyVersion: string
  stock?: number | null
  durationMinutes?: number | null
  capacity?: number | null
  workingHours?: HorarioMercadoServicios[]
  calendarId?: string
  bookingMode?: ModalidadReservaMercadoServicios | null
  estimatedDurationMinutes?: number | null
  priceMode?: ModalidadPrecioMercadoServicios
  availabilityStatus?: EstadoDisponibilidadMercadoServicios
}

export interface HorarioMercadoServicios {
  day: number
  start: string
  end: string
}

export interface ItemDescubrimientoMercadoServicios extends PublicacionMercadoServicios {
  timezone: string
  availableQuantity?: number
}

export interface RespuestaDescubrimientoMercadoServicios {
  contractVersion: TusContractVersion
  evidence: 'local-deterministic' | 'local-postgresql-http' | 'authorized-external' | 'deferred'
  items: ItemDescubrimientoMercadoServicios[]
}

export interface LineaConfirmacionCompraMercadoServicios {
  lineId: string
  listingId: string
  context: ContextoCompromiso
  quantity: number
  availabilityVersion: number
  price?: number
  slotStart?: string
  slotEnd?: string
}

export interface CompromisoMercadoServicios extends Compromiso {
  listingId: string
  quantity: number
  availabilityVersion: number
  policyVersion: string
  slotStart?: string
  slotEnd?: string
}

export interface SolicitudConfirmacionCompraMercadoServicios {
  contractVersion: TusContractVersion
  cartId: string
  requestHash: string
  idempotencyKey: string
  lines: LineaConfirmacionCompraMercadoServicios[]
}

export interface RespuestaConfirmacionCompraMercadoServicios {
  contractVersion: TusContractVersion
  status: 'executed' | 'replay'
  commitments: CompromisoMercadoServicios[]
  audits: AuditoriaMercadoServicios[]
}

export function validarSolicitudConfirmacionCompraMercadoServicios(value: unknown): SolicitudConfirmacionCompraMercadoServicios {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-marketplace-checkout', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-marketplace-checkout', value['contractVersion'])
  for (const field of ['cartId', 'requestHash', 'idempotencyKey']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (!Array.isArray(value['lines']) || value['lines'].length === 0) {
    throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'lines are required')
  }
  for (const line of value['lines']) {
    if (!isRecord(line)) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'checkout line must be an object')
    }
    for (const field of ['lineId', 'listingId']) {
      if (typeof line[field] !== 'string' || line[field].trim().length === 0) {
        throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, `${field} is required`)
      }
    }
    if (!['product', 'service'].includes(String(line['context']))) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'context is unsupported')
    }
    if (typeof line['quantity'] !== 'number' || !Number.isInteger(line['quantity']) || line['quantity'] < 1) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'quantity must be a positive integer')
    }
    if (typeof line['availabilityVersion'] !== 'number' || !Number.isInteger(line['availabilityVersion']) || line['availabilityVersion'] < 1) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'availabilityVersion must be a positive integer')
    }
    if (line['price'] !== undefined && (typeof line['price'] !== 'number' || !Number.isFinite(line['price']) || line['price'] <= 0)) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'price must be positive')
    }
    for (const field of ['slotStart', 'slotEnd']) {
      if (line[field] !== undefined && !isIsoTimestamp(line[field])) {
        throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, `${field} must be a valid ISO timestamp`)
      }
    }
  }
  return value as unknown as SolicitudConfirmacionCompraMercadoServicios
}

export interface AuditoriaMercadoServicios {
  auditId: string
  tenantId: string
  actorId: string
  correlationId: string
  action: string
  resourceType: 'merchant' | 'listing' | 'commitment' | 'authorization'
  resourceId: string
  outcome: 'allowed' | 'denied'
  createdAt: string
}

export type TipoEvidencia = 'completion' | 'check-in' | 'delivery-accepted'

export interface EvidenciaCumplimiento {
  contractVersion: TusContractVersion
  evidenceId: string
  commitmentId: string
  tenantId: string
  actorId: string
  correlationId: string
  kind: TipoEvidencia
  occurredAt: string
}

export interface InstantaneaLiquidacion {
  contractVersion: TusContractVersion
  commitmentId: string
  context: ContextoCompromiso
  ruleVersion: string
  commissionableBase: number
  rateBps: number
  commissionAmount: number
  currency: string
  evidenceId: string
}

export type EstadoDisputa = 'open' | 'resolved' | 'rejected'

export interface Disputa {
  contractVersion: TusContractVersion
  disputeId: string
  commitmentId: string
  tenantId: string
  actorId: string
  correlationId: string
  reason: string
  status: EstadoDisputa
}

export interface CasoSoporte {
  contractVersion: TusContractVersion
  caseId: string
  commitmentId: string
  tenantId: string
  actorId: string
  correlationId: string
  category: string
  status: 'open' | 'resolved'
}

export function validarCasoSoporte(value: unknown): CasoSoporte {
  if (!isRecord(value)) throw new ContractValidationError('tus-support-case', undefined, 'payload must be an object')
  assertTusVersion('tus-support-case', value['contractVersion'])
  for (const field of ['caseId', 'commitmentId', 'tenantId', 'actorId', 'correlationId', 'category']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-support-case', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (value['status'] !== 'open' && value['status'] !== 'resolved') {
    throw new ContractValidationError('tus-support-case', TUS_CONTRACT_VERSION, 'status is unsupported')
  }
  return value as unknown as CasoSoporte
}

export const TIPOS_ACCION_WHATSAPP = [
  'search',
  'quote',
  'cart',
  'status',
  'handoff',
  'confirm',
] as const

export type TipoAccionWhatsApp = (typeof TIPOS_ACCION_WHATSAPP)[number]

export interface AccionWhatsApp {
  contractVersion: TusContractVersion
  type: TipoAccionWhatsApp
  tenantId: string
  commitmentId?: string
  confirmationId?: string
}

export function validarAccionWhatsApp(value: unknown): AccionWhatsApp {
  if (!isRecord(value)) throw new ContractValidationError('tus-whatsapp-action', undefined, 'payload must be an object')
  assertTusVersion('tus-whatsapp-action', value['contractVersion'])
  if (typeof value['tenantId'] !== 'string' || value['tenantId'].trim().length === 0) {
    throw new ContractValidationError('tus-whatsapp-action', TUS_CONTRACT_VERSION, 'tenantId is required')
  }
  if (!TIPOS_ACCION_WHATSAPP.includes(value['type'] as TipoAccionWhatsApp)) {
    throw new ContractValidationError('tus-whatsapp-action', TUS_CONTRACT_VERSION, 'action type is unsupported')
  }
  for (const field of ['commitmentId', 'confirmationId']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].trim().length === 0)) {
      throw new ContractValidationError('tus-whatsapp-action', TUS_CONTRACT_VERSION, `${field} is invalid`)
    }
  }
  return value as unknown as AccionWhatsApp
}

export interface MercadoPagoHandoff {
  contractVersion: TusContractVersion
  provider: 'mercado-pago'
  tenantId: string
  redirectUrl: string
  credentialsCollected: false
}

export type EstadoTareaEntrega = 'queued' | 'accepted' | 'picked-up' | 'in-transit' | 'handed-off' | 'returned' | 'incident-review'

export interface TareaEntrega {
  contractVersion: TusContractVersion
  taskId: string
  tenantId: string
  commitmentId: string
  merchantId: string
  context: 'product'
  zoneId: string
  shiftId: string
  operatorId: string | null
  status: EstadoTareaEntrega
  version: number
  proof?: ComprobanteEntrega | null
  incident?: IncidenteEntrega | null
  settlementClaim: 'not-claimed'
}

export interface ComprobanteEntrega {
  contractVersion: TusContractVersion
  proofId: string
  tenantId: string
  taskId: string
  commitmentId: string
  recipientName: string
  capturedAt: string
  evidenceSource: 'authorized' | 'deterministic-test-only'
}

export interface IncidenteEntrega {
  contractVersion: TusContractVersion
  incidentId: string
  tenantId: string
  taskId: string
  reason: string
  status: 'open' | 'resolved'
  createdAt: string
}

export interface DispositivoPOS {
  contractVersion: TusContractVersion
  deviceId: string
  tenantId: string
  label: string
  fingerprint: string
  status: 'active' | 'revoked'
  createdAt: string
  updatedAt: string
}

export interface SesionPOS {
  contractVersion: TusContractVersion
  sessionId: string
  tenantId: string
  deviceId: string
  actorId: string
  shiftId: string
  status: 'open' | 'closed'
  openedAt: string
  closedAt?: string
}

export interface ComprobantePOS {
  contractVersion: TusContractVersion
  receiptId: string
  tenantId: string
  operationId: string
  kind: TipoOperacionPOS
  context: ContextoCompromiso
  amount: number
  currency: string
  status: 'pending' | 'accepted'
  source: 'authorized' | 'deterministic-test-only'
  providerCapture: 'not-claimed'
  settlement: 'not-claimed'
  integrityHash: string
  createdAt: string
}

export interface ConflictoPOS {
  contractVersion: TusContractVersion
  conflictId: string
  tenantId: string
  operationId: string
  reason: 'idempotency_conflict' | 'version_conflict' | 'uncertain_sync'
  expectedVersion?: number
  actualVersion?: number
  status: 'open' | 'resolved' | 'discarded'
  createdAt: string
}

export type TipoOperacionPOS = 'manual-sale' | 'manual-service'

export interface OperacionPOS {
  contractVersion: TusContractVersion
  operationId: string
  tenantId: string
  actorId: string
  deviceId: string
  shiftId: string
  idempotencyKey: string
  schemaVersion: string
  createdAt: string
  expectedVersion?: number
  kind: TipoOperacionPOS
  context: ContextoCompromiso
  amount: number
  currency: string
}

export function validarPublicacionMercadoServicios(value: unknown): PublicacionMercadoServicios {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-marketplace-listing', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-marketplace-listing', value['contractVersion'])
  for (const field of ['listingId', 'tenantId', 'merchantId', 'name', 'description', 'locationId', 'currency', 'policyVersion']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (!['product', 'service'].includes(String(value['kind'])) || !['beauty-personal-care', 'repairs-trades'].includes(String(value['cohort']))) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'listing kind or cohort is unsupported')
  }
  if (typeof value['price'] !== 'number' || !Number.isFinite(value['price']) || value['price'] <= 0) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'price must be positive')
  }
  if (typeof value['availabilityVersion'] !== 'number' || !Number.isInteger(value['availabilityVersion']) || value['availabilityVersion'] < 1 || typeof value['published'] !== 'boolean') {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'availabilityVersion or published is invalid')
  }
  if (value['calendarId'] !== undefined && (typeof value['calendarId'] !== 'string' || value['calendarId'].trim().length === 0)) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'calendarId is invalid')
  }
  if (value['bookingMode'] !== undefined && value['bookingMode'] !== null && !Object.values(MODALIDADES_RESERVA_MERCADO_SERVICIOS).includes(String(value['bookingMode']) as ModalidadReservaMercadoServicios)) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'bookingMode is unsupported')
  }
  if (value['estimatedDurationMinutes'] !== undefined && value['estimatedDurationMinutes'] !== null && (!Number.isInteger(value['estimatedDurationMinutes']) || Number(value['estimatedDurationMinutes']) < 1)) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'estimatedDurationMinutes is invalid')
  }
  if (value['priceMode'] !== undefined && !Object.values(MODALIDADES_PRECIO_MERCADO_SERVICIOS).includes(String(value['priceMode']) as ModalidadPrecioMercadoServicios)) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'priceMode is unsupported')
  }
  if (value['availabilityStatus'] !== undefined && !['configured', 'not_configured'].includes(String(value['availabilityStatus']))) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'availabilityStatus is unsupported')
  }
  if (value['kind'] === 'product' && (typeof value['stock'] !== 'number' || !Number.isInteger(value['stock']) || value['stock'] < 0)) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'product stock is required')
  }
  const bookingMode = value['bookingMode'] === undefined || value['bookingMode'] === null
    ? (value['durationMinutes'] === null ? 'variable_duration' : 'fixed_shift')
    : value['bookingMode']
  const hasFixedDuration = typeof value['durationMinutes'] === 'number' && Number.isInteger(value['durationMinutes']) && value['durationMinutes'] > 0
  const hasEstimatedDuration = typeof value['estimatedDurationMinutes'] === 'number' && Number.isInteger(value['estimatedDurationMinutes']) && value['estimatedDurationMinutes'] > 0
  const fixedBookingModes = ['fixed_shift', 'visita_diagnostico'].includes(String(bookingMode))
  const estimatedBookingModes = ['variable_duration', 'duracion_estimada'].includes(String(bookingMode))
  if (value['kind'] === 'service' && (typeof value['capacity'] !== 'number' || !Number.isInteger(value['capacity']) || value['capacity'] <= 0 || !Array.isArray(value['workingHours']) || value['workingHours'].length === 0 || fixedBookingModes && !hasFixedDuration || estimatedBookingModes && !hasEstimatedDuration)) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'service availability is required')
  }
  return value as unknown as PublicacionMercadoServicios
}

export function validarRespuestaDescubrimientoMercadoServicios(value: unknown): RespuestaDescubrimientoMercadoServicios {
  if (!isRecord(value)) throw new ContractValidationError('tus-marketplace-discovery', undefined, 'payload must be an object')
  assertTusVersion('tus-marketplace-discovery', value['contractVersion'])
  if (!['local-deterministic', 'local-postgresql-http', 'authorized-external', 'deferred'].includes(String(value['evidence']))) {
    throw new ContractValidationError('tus-marketplace-discovery', TUS_CONTRACT_VERSION, 'evidence is unsupported')
  }
  if (!Array.isArray(value['items'])) throw new ContractValidationError('tus-marketplace-discovery', TUS_CONTRACT_VERSION, 'items are required')
  for (const item of value['items']) {
    validarPublicacionMercadoServicios(item)
    if (!isRecord(item) || typeof item['timezone'] !== 'string' || item['timezone'].trim().length === 0) {
      throw new ContractValidationError('tus-marketplace-discovery', TUS_CONTRACT_VERSION, 'item timezone is required')
    }
    if (item['availableQuantity'] !== undefined && (!Number.isInteger(item['availableQuantity']) || Number(item['availableQuantity']) < 0)) {
      throw new ContractValidationError('tus-marketplace-discovery', TUS_CONTRACT_VERSION, 'availableQuantity is invalid')
    }
    if (item['kind'] === 'service' && item['availabilityStatus'] === 'configured' && (typeof item['calendarId'] !== 'string' || item['calendarId'].trim().length === 0)) {
      throw new ContractValidationError('tus-marketplace-discovery', TUS_CONTRACT_VERSION, 'configured service calendarId is required')
    }
    if (item['kind'] === 'service' && item['availabilityStatus'] === 'not_configured' && item['calendarId'] !== undefined) {
      throw new ContractValidationError('tus-marketplace-discovery', TUS_CONTRACT_VERSION, 'not_configured service cannot expose calendarId')
    }
  }
  return value as unknown as RespuestaDescubrimientoMercadoServicios
}

export const CLAVES_REQUISITOS_HABILITACION = [
  'legal',
  'kyc',
  'kyb',
  'tax',
  'mercadoPago',
  'posPilot',
  'aws',
  'groqMigration',
  'runtimeProvider',
] as const

export type ClaveRequisitoHabilitacion = (typeof CLAVES_REQUISITOS_HABILITACION)[number]

export type CapacidadHabilitacion =
  | 'publication'
  | 'provider-actions'
  | 'settlement'
  | 'fleet'
  | 'release-jobs'

export type FuenteEvidenciaHabilitacion =
  | 'authorized-external'
  | 'local-deterministic'
  | 'local-postgresql-http'
  | 'deferred'
  | 'authorized'
  | 'deterministic-test-only'

export interface EvidenciaHabilitacion {
  contractVersion: TusContractVersion
  evidenceId: string
  tenantId: string
  capability: CapacidadHabilitacion
  gate: ClaveRequisitoHabilitacion
  owner: string
  scope: string
  evidenceType: string
  evidenceRef: string
  policyVersion: string
  issuedAt: string
  expiresAt: string | null
  revoked: boolean
  source: FuenteEvidenciaHabilitacion
  profile?: 'native-local' | 'render-native' | 'aws-terraform' | 'local-postgresql-http'
  execution?: 'local-verification' | 'live'
  evidenceClass?: 'authorized-external' | 'local-deterministic' | 'local-postgresql-http' | 'deferred'
  liveConformance?: boolean
}

export type MotivoFallaHabilitacion =
  | 'evidence_missing'
  | 'evidence_out_of_scope'
  | 'evidence_expired'
  | 'evidence_revoked'
  | 'evidence_not_yet_valid'
  | 'evidence_malformed'
  | 'evidence_conflict'
  | 'evidence_deferred'
  | 'deterministic_test_only'
  | 'legacy_conflict'

export interface FallaRequisitoHabilitacion {
  gate: ClaveRequisitoHabilitacion
  reason: MotivoFallaHabilitacion
}

export interface ConflictoHabilitacion {
  gate: ClaveRequisitoHabilitacion
  evidenceIds: string[]
  source?: 'evidence' | 'legacy-boolean'
}

export interface DecisionHabilitacion {
  contractVersion: TusContractVersion
  tenantId: string
  capability: CapacidadHabilitacion
  evaluatedAt: string
  enabled: boolean
  disposition: 'authorized' | 'disabled' | 'unavailable-deferred'
  failedGates: FallaRequisitoHabilitacion[]
  evidenceIds: string[]
  deterministic: boolean
  conflicts?: ConflictoHabilitacion[]
  reason?: string
  evidencePreserved?: true
  auditPreserved?: true
  profile?: 'native-local' | 'render-native' | 'aws-terraform' | 'local-postgresql-http'
  execution?: 'local-verification' | 'live'
  evidenceClass?: 'authorized-external' | 'local-deterministic' | 'local-postgresql-http' | 'deferred'
  policyVersion?: string
  scope?: string
  actorId?: string
  jobId?: string
  correlationId?: string
}

export function validateTusCommitment(value: unknown): Compromiso {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-commitment', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-commitment', value['contractVersion'])
  for (const field of ['commitmentId', 'cartId', 'tenantId', 'merchantId', 'currency', 'createdAt']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (value['context'] !== 'product' && value['context'] !== 'service') {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'context is unsupported')
  }
  if (!isCommitmentStatus(value['status'])) {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'status is unsupported')
  }
  if (typeof value['amount'] !== 'number' || !Number.isFinite(value['amount']) || value['amount'] < 0) {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'amount must be non-negative')
  }
  if (!Array.isArray(value['lineIds']) || value['lineIds'].some((lineId) => typeof lineId !== 'string')) {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'lineIds are required')
  }
  if (typeof value['version'] !== 'number' || !Number.isInteger(value['version']) || value['version'] < 1) {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'version must be a positive integer')
  }
  return value as unknown as Compromiso
}

export function validarInstantaneaLiquidacion(value: unknown): InstantaneaLiquidacion {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-settlement-snapshot', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-settlement-snapshot', value['contractVersion'])
  for (const field of ['commitmentId', 'ruleVersion', 'currency', 'evidenceId']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new ContractValidationError('tus-settlement-snapshot', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (value['context'] !== 'product' && value['context'] !== 'service') {
    throw new ContractValidationError('tus-settlement-snapshot', TUS_CONTRACT_VERSION, 'context is unsupported')
  }
  for (const field of ['commissionableBase', 'rateBps', 'commissionAmount']) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0) {
      throw new ContractValidationError('tus-settlement-snapshot', TUS_CONTRACT_VERSION, `${field} must be non-negative`)
    }
  }
  return value as unknown as InstantaneaLiquidacion
}

export function validarEvidenciaHabilitacion(value: unknown): EvidenciaHabilitacion {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-readiness-evidence', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-readiness-evidence', value['contractVersion'])
  for (const field of [
    'evidenceId',
    'tenantId',
    'owner',
    'scope',
    'evidenceType',
    'evidenceRef',
    'policyVersion',
  ]) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (typeof value['issuedAt'] !== 'string' || !isIsoTimestamp(value['issuedAt'])) {
    throw new ContractValidationError(
      'tus-readiness-evidence',
      TUS_CONTRACT_VERSION,
      'issuedAt must be a valid ISO timestamp',
    )
  }
  if (!esCapacidadHabilitacion(value['capability'])) {
    throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, 'capability is unsupported')
  }
  if (!esClaveRequisitoHabilitacion(value['gate'])) {
    throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, 'gate is unsupported')
  }
  if (value['expiresAt'] !== null && (typeof value['expiresAt'] !== 'string' || !isIsoTimestamp(value['expiresAt']))) {
    throw new ContractValidationError(
      'tus-readiness-evidence',
      TUS_CONTRACT_VERSION,
      'expiresAt must be a valid ISO timestamp or null',
    )
  }
  if (typeof value['revoked'] !== 'boolean') {
    throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, 'revoked is required')
  }
  if (
    ![
      'authorized-external',
      'local-deterministic',
      'local-postgresql-http',
      'deferred',
      'authorized',
      'deterministic-test-only',
    ].includes(String(value['source']))
  ) {
    throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, 'source is unsupported')
  }
  validarMetadatosHabilitacion(value, 'tus-readiness-evidence')
  return value as unknown as EvidenciaHabilitacion
}

export function validarDecisionHabilitacion(value: unknown): DecisionHabilitacion {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-readiness-decision', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-readiness-decision', value['contractVersion'])
  for (const field of ['tenantId', 'evaluatedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (!isIsoTimestamp(value['evaluatedAt'])) {
    throw new ContractValidationError(
      'tus-readiness-decision',
      TUS_CONTRACT_VERSION,
      'evaluatedAt must be a valid ISO timestamp',
    )
  }
  if (!esCapacidadHabilitacion(value['capability'])) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'capability is unsupported')
  }
  if (typeof value['enabled'] !== 'boolean' || typeof value['deterministic'] !== 'boolean') {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'boolean decision fields are required')
  }
  if (!['authorized', 'disabled', 'unavailable-deferred'].includes(String(value['disposition']))) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'disposition is unsupported')
  }
  if (!Array.isArray(value['evidenceIds']) || value['evidenceIds'].some((id) => typeof id !== 'string')) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'evidenceIds are required')
  }
  if (!Array.isArray(value['failedGates'])) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'failedGates are required')
  }
  if (
    value['conflicts'] !== undefined &&
    (!Array.isArray(value['conflicts']) ||
      value['conflicts'].some(
        (conflict) =>
          !isRecord(conflict) ||
          !esClaveRequisitoHabilitacion(conflict['gate']) ||
          !Array.isArray(conflict['evidenceIds']) ||
          conflict['evidenceIds'].some((id) => typeof id !== 'string') ||
          (conflict['source'] !== undefined && !['evidence', 'legacy-boolean'].includes(String(conflict['source']))),
      ))
  ) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'conflicts are unsupported')
  }
  for (const failure of value['failedGates']) {
    if (!isRecord(failure) || !esClaveRequisitoHabilitacion(failure['gate']) || !esMotivoFallaHabilitacion(failure['reason'])) {
      throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'failedGates contain an unsupported entry')
    }
  }
  if (
    !esDecisionHabilitacionConsistente(
      value['enabled'] === true,
      value['deterministic'] === true,
      String(value['disposition']),
      value['failedGates'].length,
      typeof value['reason'] === 'string' ? value['reason'] : undefined,
    )
  ) {
    throw new ContractValidationError(
      'tus-readiness-decision',
      TUS_CONTRACT_VERSION,
      'disposition must match readiness state',
    )
  }
  if (value['enabled'] === true && Array.isArray(value['conflicts']) && value['conflicts'].length > 0) {
    throw new ContractValidationError(
      'tus-readiness-decision',
      TUS_CONTRACT_VERSION,
      'enabled readiness cannot contain conflicts',
    )
  }
  validarMetadatosHabilitacion(value, 'tus-readiness-decision')
  return value as unknown as DecisionHabilitacion
}

function validarMetadatosHabilitacion(value: Record<string, unknown>, contract: string): void {
  if (value['profile'] !== undefined && !['native-local', 'render-native', 'aws-terraform', 'local-postgresql-http'].includes(String(value['profile']))) {
    throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, 'profile is unsupported')
  }
  if (value['execution'] !== undefined && !['local-verification', 'live'].includes(String(value['execution']))) {
    throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, 'execution is unsupported')
  }
  if (value['evidenceClass'] !== undefined && !['authorized-external', 'local-deterministic', 'local-postgresql-http', 'deferred'].includes(String(value['evidenceClass']))) {
    throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, 'evidenceClass is unsupported')
  }
  if (value['liveConformance'] !== undefined && typeof value['liveConformance'] !== 'boolean') {
    throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, 'liveConformance must be boolean')
  }
  for (const field of ['policyVersion', 'scope', 'actorId', 'jobId', 'correlationId']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].trim().length === 0)) {
      throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, `${field} must be a non-empty string`)
    }
  }
}

export function validarTareaEntrega(value: unknown): TareaEntrega {
  if (!isRecord(value)) throw new ContractValidationError('tus-delivery-task', undefined, 'payload must be an object')
  assertTusVersion('tus-delivery-task', value['contractVersion'])
  for (const field of ['taskId', 'tenantId', 'commitmentId', 'merchantId', 'zoneId', 'shiftId', 'settlementClaim']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (value['context'] !== 'product' || !['queued', 'accepted', 'picked-up', 'in-transit', 'handed-off', 'returned', 'incident-review'].includes(String(value['status'])) || value['settlementClaim'] !== 'not-claimed') throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'delivery task lifecycle is unsupported')
  if (typeof value['operatorId'] !== 'string' && value['operatorId'] !== null) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'operatorId is required')
  if (typeof value['version'] !== 'number' || !Number.isInteger(value['version']) || value['version'] < 0) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'version must be a non-negative integer')
  if (value['proof'] !== undefined && value['proof'] !== null && !isRecord(value['proof'])) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'proof must be an object or null')
  if (value['incident'] !== undefined && value['incident'] !== null && !isRecord(value['incident'])) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'incident must be an object or null')
  return value as unknown as TareaEntrega
}

export function validarOperacionPOS(value: unknown): OperacionPOS {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-operation', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-operation', value['contractVersion'])
  for (const field of ['operationId', 'tenantId', 'actorId', 'deviceId', 'shiftId', 'idempotencyKey', 'schemaVersion', 'createdAt', 'currency']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-operation', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['manual-sale', 'manual-service'].includes(String(value['kind'])) || !['product', 'service'].includes(String(value['context'])) || (value['kind'] === 'manual-sale' && value['context'] !== 'product') || (value['kind'] === 'manual-service' && value['context'] !== 'service')) throw new ContractValidationError('tus-pos-operation', TUS_CONTRACT_VERSION, 'POS lifecycle context is unsupported')
  if (typeof value['amount'] !== 'number' || !Number.isFinite(value['amount']) || value['amount'] < 0 || !isIsoTimestamp(value['createdAt'])) throw new ContractValidationError('tus-pos-operation', TUS_CONTRACT_VERSION, 'POS amount or timestamp is invalid')
  if (value['expectedVersion'] !== undefined && (typeof value['expectedVersion'] !== 'number' || !Number.isInteger(value['expectedVersion']) || value['expectedVersion'] < 0)) throw new ContractValidationError('tus-pos-operation', TUS_CONTRACT_VERSION, 'expectedVersion is invalid')
  return value as unknown as OperacionPOS
}

export function validarComprobantePOS(value: unknown): ComprobantePOS {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-receipt', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-receipt', value['contractVersion'])
  for (const field of ['receiptId', 'tenantId', 'operationId', 'currency', 'source', 'providerCapture', 'settlement', 'integrityHash', 'createdAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-receipt', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['manual-sale', 'manual-service'].includes(String(value['kind'])) || !['product', 'service'].includes(String(value['context'])) || (value['kind'] === 'manual-sale' && value['context'] !== 'product') || (value['kind'] === 'manual-service' && value['context'] !== 'service')) throw new ContractValidationError('tus-pos-receipt', TUS_CONTRACT_VERSION, 'receipt lifecycle context is unsupported')
  if (!['pending', 'accepted'].includes(String(value['status'])) || value['source'] !== 'authorized' && value['source'] !== 'deterministic-test-only' || value['providerCapture'] !== 'not-claimed' || value['settlement'] !== 'not-claimed' || typeof value['amount'] !== 'number' || !Number.isFinite(value['amount']) || value['amount'] < 0 || !/^[a-f0-9]{64}$/.test(String(value['integrityHash'])) || !isIsoTimestamp(value['createdAt'])) throw new ContractValidationError('tus-pos-receipt', TUS_CONTRACT_VERSION, 'receipt integrity or settlement state is invalid')
  return value as unknown as ComprobantePOS
}

export function validarDispositivoPOS(value: unknown): DispositivoPOS {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-device', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-device', value['contractVersion'])
  for (const field of ['deviceId', 'tenantId', 'label', 'fingerprint', 'createdAt', 'updatedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-device', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['active', 'revoked'].includes(String(value['status'])) || !isIsoTimestamp(value['createdAt']) || !isIsoTimestamp(value['updatedAt'])) throw new ContractValidationError('tus-pos-device', TUS_CONTRACT_VERSION, 'device status or timestamps are invalid')
  return value as unknown as DispositivoPOS
}

export function validarSesionPOS(value: unknown): SesionPOS {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-session', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-session', value['contractVersion'])
  for (const field of ['sessionId', 'tenantId', 'deviceId', 'actorId', 'shiftId', 'openedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-session', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['open', 'closed'].includes(String(value['status'])) || !isIsoTimestamp(value['openedAt']) || (value['closedAt'] !== undefined && (typeof value['closedAt'] !== 'string' || !isIsoTimestamp(value['closedAt'])))) throw new ContractValidationError('tus-pos-session', TUS_CONTRACT_VERSION, 'session status or timestamps are invalid')
  return value as unknown as SesionPOS
}

export function validarConflictoPOS(value: unknown): ConflictoPOS {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-conflict', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-conflict', value['contractVersion'])
  for (const field of ['conflictId', 'tenantId', 'operationId', 'createdAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-conflict', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['idempotency_conflict', 'version_conflict', 'uncertain_sync'].includes(String(value['reason'])) || !['open', 'resolved', 'discarded'].includes(String(value['status'])) || !isIsoTimestamp(value['createdAt'])) throw new ContractValidationError('tus-pos-conflict', TUS_CONTRACT_VERSION, 'conflict state is invalid')
  return value as unknown as ConflictoPOS
}

function assertTusVersion(contract: string, version: unknown): asserts version is TusContractVersion {
  if (version !== TUS_CONTRACT_VERSION) {
    throw new ContractValidationError(contract, version, 'unsupported contract version')
  }
}

function isCommitmentStatus(value: unknown): value is EstadoCompromiso {
  return Object.values(ESTADOS_COMPROMISO).includes(value as EstadoCompromiso)
}

function esClaveRequisitoHabilitacion(value: unknown): value is ClaveRequisitoHabilitacion {
  return CLAVES_REQUISITOS_HABILITACION.includes(value as ClaveRequisitoHabilitacion)
}

function esCapacidadHabilitacion(value: unknown): value is CapacidadHabilitacion {
  return ['publication', 'provider-actions', 'settlement', 'fleet', 'release-jobs'].includes(String(value))
}

function esMotivoFallaHabilitacion(value: unknown): value is MotivoFallaHabilitacion {
  return [
    'evidence_missing',
    'evidence_out_of_scope',
    'evidence_expired',
    'evidence_revoked',
    'evidence_not_yet_valid',
    'evidence_malformed',
    'evidence_conflict',
    'evidence_deferred',
    'deterministic_test_only',
    'legacy_conflict',
  ].includes(String(value))
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function esDecisionHabilitacionConsistente(
  enabled: boolean,
  deterministic: boolean,
  disposition: string,
  failedGateCount: number,
  reason: string | undefined,
): boolean {
  if (enabled) return disposition === 'authorized' && !deterministic && failedGateCount === 0
  return disposition === 'disabled' || (disposition === 'unavailable-deferred' && (deterministic || reason === 'evidence_deferred'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
