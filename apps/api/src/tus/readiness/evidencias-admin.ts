import { randomUUID } from 'node:crypto'
import {
  TUS_CONTRACT_VERSION,
  type CapacidadHabilitacion,
  type ClaveRequisitoHabilitacion,
  type EvidenciaHabilitacion,
} from '@factory/contracts'
import { requisitosDeCapacidad, requisitosNoRequeridos, requisitosPosiblesDeCapacidad, type MotivoRequisitoNoRequerido, type PerfilHabilitacion } from './index.ts'

// Administrative registry of readiness evidence. It is the only writer of
// `evidencias_habilitacion`: a platform administrator (MFA-elevated session, checked by the
// caller) records that a requirement of a capability is backed by a real, owner-held document,
// and can later revoke that record. Nothing here decides whether the document is good enough:
// the registry stores a reference to it, never the document, and never a secret.
//
// What the request may say: capability, requirement, owner, type, reference, policy version and
// validity. Everything else is the server's: tenant (the platform tenant), scope, profile,
// source, actor, identifiers and the revoked flag.

// Capabilities evaluated for the platform tenant. The other capabilities are evaluated for each
// merchant tenant; a platform record would mean nothing for them.
export const CAPACIDADES_EVIDENCIA_PLATAFORMA = ['service-payments', 'settlement'] as const
export type CapacidadEvidenciaPlataforma = (typeof CAPACIDADES_EVIDENCIA_PLATAFORMA)[number]

const CAMPOS_REGISTRO = ['capability', 'gate', 'owner', 'evidenceType', 'evidenceRef', 'policyVersion', 'issuedAt', 'expiresAt'] as const
const CAMPOS_REVOCACION = ['reason'] as const
const CAMPOS_TEXTO = ['owner', 'evidenceType', 'evidenceRef', 'policyVersion'] as const
const LARGO_MAXIMO = 200

export class ErrorEvidenciaHabilitacion extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    // Names of the offending fields only; never their values.
    readonly fields: string[] = []
  ) {
    super(message)
    this.name = 'ErrorEvidenciaHabilitacion'
  }
}

export type RegistroEvidencia = EvidenciaHabilitacion & { createdAt: string; updatedAt: string }

export interface AuditoriaEvidencia {
  tenantId: string
  actorId: string
  correlationId: string
  eventType: 'readiness.evidence_registered' | 'readiness.evidence_revoked'
  metadata: Record<string, string | null>
  occurredAt: string
}

// Each write and its audit record are one atomic operation.
export interface PuertoAdminEvidencias {
  listar(tenantId: string): Promise<RegistroEvidencia[]>
  // Fails with EVIDENCE_REFERENCE_ALREADY_USED / EVIDENCE_ALREADY_CURRENT (decided with the
  // records of that requirement read inside the same transaction).
  registrar(evidencia: RegistroEvidencia, vigente: (existente: RegistroEvidencia) => boolean, auditoria: AuditoriaEvidencia): Promise<void>
  // null when the record does not exist for that tenant or is already revoked.
  revocar(input: { tenantId: string; evidenceId: string; at: string }, auditoria: (registro: RegistroEvidencia) => AuditoriaEvidencia): Promise<RegistroEvidencia | null>
}

export class AlmacenAdminEvidenciasEnMemoria implements PuertoAdminEvidencias {
  readonly registros: RegistroEvidencia[] = []
  readonly auditoria: AuditoriaEvidencia[] = []

  async listar(tenantId: string): Promise<RegistroEvidencia[]> {
    return this.registros.filter((item) => item.tenantId === tenantId).map((item) => ({ ...item }))
  }

  async registrar(evidencia: RegistroEvidencia, vigente: (existente: RegistroEvidencia) => boolean, auditoria: AuditoriaEvidencia): Promise<void> {
    const delRequisito = this.registros.filter((item) => item.tenantId === evidencia.tenantId && item.capability === evidencia.capability && item.gate === evidencia.gate)
    if (delRequisito.some((item) => item.evidenceRef === evidencia.evidenceRef)) throw referenciaUsada()
    if (delRequisito.some(vigente)) throw yaVigente()
    this.registros.push({ ...evidencia })
    this.auditoria.push(auditoria)
  }

  async revocar(input: { tenantId: string; evidenceId: string; at: string }, auditoria: (registro: RegistroEvidencia) => AuditoriaEvidencia): Promise<RegistroEvidencia | null> {
    const registro = this.registros.find((item) => item.tenantId === input.tenantId && item.evidenceId === input.evidenceId)
    if (!registro || registro.revoked) return null
    registro.revoked = true
    registro.updatedAt = input.at
    this.auditoria.push(auditoria(registro))
    return { ...registro }
  }
}

export function referenciaUsada(): ErrorEvidenciaHabilitacion {
  return new ErrorEvidenciaHabilitacion(409, 'EVIDENCE_REFERENCE_ALREADY_USED', 'that reference was already recorded for this requirement; a new record needs its own reference')
}

export function yaVigente(): ErrorEvidenciaHabilitacion {
  return new ErrorEvidenciaHabilitacion(409, 'EVIDENCE_ALREADY_CURRENT', 'this requirement already has a current record; revoke it before recording another')
}

// Defense in depth, not a guarantee: values that look like a credential, a provider payload or
// personal data are refused. The evidence itself stays with its owner; only a reference is kept.
const FORMAS_SENSIBLES: readonly RegExp[] = [
  /\b(APP_USR|TEST)-[A-Za-z0-9-]{8,}/u, // Mercado Pago credentials
  /\bbearer\s+\S+/iu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./u, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY/u,
  /\b(sk|gsk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}/u, // API keys
  /(password|passwd|contrase[nñ]a|secret|secreto|token|api[_-]?key|client[_-]?secret|access[_-]?key|authorization|cookie)\s*[=:]/iu,
  /:\/\/[^\s/@:]+:[^\s/@]+@/u, // credentials inside a URL
  /[?&#](token|key|secret|signature|sig|access_token|code|password)=/iu,
  /[{}<>]/u, // a JSON or HTML payload
  /[A-Za-z0-9+_=]{40,}/u, // long opaque value
  /\b[a-f0-9]{32,}\b/iu, // hash or hex key
  /[^\s@]+@[^\s@]+\.[^\s@]+/u, // e-mail address
  /\b(20|23|24|27|30|33|34)-?\d{8}-?\d\b/u, // CUIL/CUIT
  /\b(dni|documento|cuil|cuit)\b\D{0,6}\d{6,}/iu,
]

export function pareceDatoSensible(value: string): boolean {
  return FORMAS_SENSIBLES.some((forma) => forma.test(value))
}

export type EstadoEvidencia = 'current' | 'revoked' | 'expired' | 'not_yet_valid'

export interface VistaEvidencia {
  evidenceId: string
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
  status: EstadoEvidencia
  recordedAt: string
  updatedAt: string
}

export interface ContextoAdminEvidencias {
  actorId: string
  correlationId: string
}

export class ServicioEvidenciasHabilitacion {
  constructor(
    private readonly store: PuertoAdminEvidencias,
    // The tenant, profile and scope the gates are evaluated for: the same values the evaluator
    // of service payments uses, so a record made here is exactly the one it reads.
    private readonly opciones: { tenantId: string; profile: PerfilHabilitacion; scope: string },
    private readonly now: () => number = () => Date.now()
  ) {}

  async listar(): Promise<{
    scope: string
    capabilities: { capability: CapacidadEvidenciaPlataforma; requiredGates: readonly ClaveRequisitoHabilitacion[]; notRequired: { gate: ClaveRequisitoHabilitacion; reason: MotivoRequisitoNoRequerido }[]; evidence: VistaEvidencia[] }[]
  }> {
    const registros = await this.store.listar(this.opciones.tenantId)
    const ahora = this.now()
    return {
      scope: this.opciones.scope,
      capabilities: CAPACIDADES_EVIDENCIA_PLATAFORMA.map((capability) => ({
        capability,
        // For the runtime this process really runs with, and the ordinary (non POS) flow.
        requiredGates: requisitosDeCapacidad(capability, { profile: this.opciones.profile }),
        notRequired: requisitosNoRequeridos(capability, { profile: this.opciones.profile }),
        evidence: registros
          .filter((item) => item.capability === capability && item.scope === this.opciones.scope)
          .sort((left, right) => left.gate.localeCompare(right.gate) || right.createdAt.localeCompare(left.createdAt))
          .map((item) => vista(item, ahora)),
      })),
    }
  }

  async registrar(context: ContextoAdminEvidencias, input: Record<string, unknown>): Promise<VistaEvidencia> {
    soloCampos(input, CAMPOS_REGISTRO)
    const capability = input['capability']
    if (!CAPACIDADES_EVIDENCIA_PLATAFORMA.includes(capability as CapacidadEvidenciaPlataforma))
      throw new ErrorEvidenciaHabilitacion(400, 'INVALID', 'capability must be service-payments or settlement', ['capability'])
    // Evidence of a conditional requirement can be recorded before it is asked for.
    const requisitos = requisitosPosiblesDeCapacidad(capability as CapacidadEvidenciaPlataforma)
    const gate = input['gate']
    if (!requisitos.includes(gate as ClaveRequisitoHabilitacion))
      throw new ErrorEvidenciaHabilitacion(400, 'INVALID', 'gate is not a requirement of that capability', ['gate'])

    const textos = Object.fromEntries(CAMPOS_TEXTO.map((campo) => [campo, texto(input[campo], campo)])) as Record<(typeof CAMPOS_TEXTO)[number], string>
    const sensibles = CAMPOS_TEXTO.filter((campo) => pareceDatoSensible(textos[campo]))
    if (sensibles.length > 0)
      throw new ErrorEvidenciaHabilitacion(422, 'SENSITIVE_EVIDENCE_VALUE', 'evidence fields hold a reference to the document, never a credential, a payload or personal data', [...sensibles])

    const ahora = this.now()
    const issuedAt = input['issuedAt'] === undefined ? new Date(ahora).toISOString() : instante(input['issuedAt'], 'issuedAt')
    if (Date.parse(issuedAt) > ahora) throw new ErrorEvidenciaHabilitacion(400, 'INVALID', 'issuedAt cannot be in the future', ['issuedAt'])
    const expiresAt = input['expiresAt'] === undefined || input['expiresAt'] === null ? null : instante(input['expiresAt'], 'expiresAt')
    if (expiresAt !== null && Date.parse(expiresAt) <= ahora) throw new ErrorEvidenciaHabilitacion(400, 'INVALID', 'expiresAt must be in the future', ['expiresAt'])

    const instanteRegistro = new Date(ahora).toISOString()
    const registro: RegistroEvidencia = {
      contractVersion: TUS_CONTRACT_VERSION,
      evidenceId: `evidencia-habilitacion-${randomUUID()}`,
      tenantId: this.opciones.tenantId,
      capability: capability as CapacidadEvidenciaPlataforma,
      gate: gate as ClaveRequisitoHabilitacion,
      owner: textos.owner,
      scope: this.opciones.scope,
      evidenceType: textos.evidenceType,
      evidenceRef: textos.evidenceRef,
      policyVersion: textos.policyVersion,
      issuedAt,
      expiresAt,
      revoked: false,
      source: 'authorized-external',
      profile: this.opciones.profile,
      execution: this.opciones.profile === 'native-local' || this.opciones.profile === 'local-postgresql-http' ? 'local-verification' : 'live',
      evidenceClass: 'authorized-external',
      liveConformance: !(this.opciones.profile === 'native-local' || this.opciones.profile === 'local-postgresql-http'),
      createdAt: instanteRegistro,
      updatedAt: instanteRegistro,
    }
    await this.store.registrar(
      registro,
      (existente) => existente.scope === registro.scope && estadoDe(existente, ahora) !== 'revoked' && estadoDe(existente, ahora) !== 'expired',
      {
        tenantId: registro.tenantId,
        actorId: context.actorId,
        correlationId: context.correlationId,
        eventType: 'readiness.evidence_registered',
        metadata: { evidenceId: registro.evidenceId, capability: registro.capability, gate: registro.gate, owner: registro.owner, scope: registro.scope, profile: registro.profile ?? null, evidenceType: registro.evidenceType, evidenceRef: registro.evidenceRef, policyVersion: registro.policyVersion, issuedAt: registro.issuedAt, expiresAt: registro.expiresAt },
        occurredAt: instanteRegistro,
      }
    )
    return vista(registro, ahora)
  }

  async revocar(context: ContextoAdminEvidencias, evidenceId: string, input: Record<string, unknown>): Promise<VistaEvidencia> {
    soloCampos(input, CAMPOS_REVOCACION)
    const reason = texto(input['reason'], 'reason')
    if (pareceDatoSensible(reason))
      throw new ErrorEvidenciaHabilitacion(422, 'SENSITIVE_EVIDENCE_VALUE', 'the reason never carries a credential, a payload or personal data', ['reason'])
    const ahora = this.now()
    const at = new Date(ahora).toISOString()
    const revocada = await this.store.revocar({ tenantId: this.opciones.tenantId, evidenceId, at }, (registro) => ({
      tenantId: registro.tenantId,
      actorId: context.actorId,
      correlationId: context.correlationId,
      eventType: 'readiness.evidence_revoked',
      metadata: { evidenceId: registro.evidenceId, capability: registro.capability, gate: registro.gate, evidenceRef: registro.evidenceRef, reason },
      occurredAt: at,
    }))
    if (!revocada) throw new ErrorEvidenciaHabilitacion(404, 'NOT_FOUND', 'evidence record was not found or is already revoked')
    return vista(revocada, ahora)
  }
}

function soloCampos(input: Record<string, unknown>, permitidos: readonly string[]): void {
  const ajenos = Object.keys(input).filter((campo) => !permitidos.includes(campo))
  if (ajenos.length > 0)
    throw new ErrorEvidenciaHabilitacion(400, 'UNTRUSTED_EVIDENCE_FIELDS', 'tenant, actor, scope, source, status and identifiers are set by TUS', ajenos.sort())
}

function texto(value: unknown, campo: string): string {
  const limpio = typeof value === 'string' ? value.trim() : ''
  // One printable line: no control characters, no line breaks.
  if (limpio.length < 3 || limpio.length > LARGO_MAXIMO || /[\u0000-\u001f\u007f]/u.test(limpio))
    throw new ErrorEvidenciaHabilitacion(400, 'INVALID', `${campo} must be one line of 3 to ${LARGO_MAXIMO} characters`, [campo])
  return limpio
}

function instante(value: unknown, campo: string): string {
  const ms = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(ms)) throw new ErrorEvidenciaHabilitacion(400, 'INVALID', `${campo} must be an ISO-8601 timestamp`, [campo])
  return new Date(ms).toISOString()
}

function estadoDe(registro: EvidenciaHabilitacion, ahora: number): EstadoEvidencia {
  if (registro.revoked) return 'revoked'
  if (registro.expiresAt !== null && Date.parse(registro.expiresAt) <= ahora) return 'expired'
  if (Date.parse(registro.issuedAt) > ahora) return 'not_yet_valid'
  return 'current'
}

function vista(registro: RegistroEvidencia, ahora: number): VistaEvidencia {
  return {
    evidenceId: registro.evidenceId,
    capability: registro.capability,
    gate: registro.gate,
    owner: registro.owner,
    scope: registro.scope,
    evidenceType: registro.evidenceType,
    evidenceRef: registro.evidenceRef,
    policyVersion: registro.policyVersion,
    issuedAt: registro.issuedAt,
    expiresAt: registro.expiresAt,
    revoked: registro.revoked,
    status: estadoDe(registro, ahora),
    recordedAt: registro.createdAt,
    updatedAt: registro.updatedAt,
  }
}
