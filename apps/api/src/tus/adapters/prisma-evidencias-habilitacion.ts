import { randomUUID } from 'node:crypto'
import { TUS_CONTRACT_VERSION, type CapacidadHabilitacion, type EvidenciaHabilitacion } from '@factory/contracts'
import {
  referenciaUsada,
  yaVigente,
  type AuditoriaEvidencia,
  type PuertoAdminEvidencias,
  type RegistroEvidencia,
} from '../readiness/evidencias-admin.ts'

type Fila = Record<string, unknown>

interface ClienteTransaccional {
  evidenciaHabilitacion: {
    findMany(input: { where: Record<string, unknown>; orderBy?: Record<string, string> }): Promise<Fila[]>
    create(input: { data: Record<string, unknown> }): Promise<unknown>
    updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  }
  auditEvent: { create(input: { data: Record<string, unknown> }): Promise<unknown> }
}

export interface ClientePrismaEvidenciasHabilitacion extends ClienteTransaccional {
  $transaction<T>(callback: (tx: ClienteTransaccional) => Promise<T>, options?: { isolationLevel?: 'Serializable' }): Promise<T>
}

// Registry of readiness evidence over PostgreSQL. Every write shares its transaction with the
// audit record (`AuditEvent`); the serializable isolation makes "one current record per
// requirement" hold under concurrent registrations.
export class AlmacenAdminEvidenciasPrisma implements PuertoAdminEvidencias {
  constructor(private readonly client: ClientePrismaEvidenciasHabilitacion) {}

  async listar(tenantId: string): Promise<RegistroEvidencia[]> {
    const filas = await this.client.evidenciaHabilitacion.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
    return filas.map(registroDe)
  }

  async registrar(evidencia: RegistroEvidencia, vigente: (existente: RegistroEvidencia) => boolean, auditoria: AuditoriaEvidencia): Promise<void> {
    try {
      await this.client.$transaction(
        async (tx) => {
          const delRequisito = (await tx.evidenciaHabilitacion.findMany({ where: { tenantId: evidencia.tenantId, capability: evidencia.capability, gate: evidencia.gate } })).map(registroDe)
          if (delRequisito.some((item) => item.evidenceRef === evidencia.evidenceRef)) throw referenciaUsada()
          if (delRequisito.some(vigente)) throw yaVigente()
          await tx.evidenciaHabilitacion.create({
            data: {
              id: evidencia.evidenceId,
              contractVersion: evidencia.contractVersion,
              tenantId: evidencia.tenantId,
              capability: evidencia.capability,
              gate: evidencia.gate,
              owner: evidencia.owner,
              scope: evidencia.scope,
              tipoEvidencia: evidencia.evidenceType,
              referenciaEvidencia: evidencia.evidenceRef,
              policyVersion: evidencia.policyVersion,
              issuedAt: new Date(evidencia.issuedAt),
              expiresAt: evidencia.expiresAt === null ? null : new Date(evidencia.expiresAt),
              revoked: false,
              source: evidencia.source,
              profile: evidencia.profile,
              execution: evidencia.execution,
              evidenceClass: evidencia.evidenceClass,
              liveConformance: evidencia.liveConformance,
              createdAt: new Date(evidencia.createdAt),
              updatedAt: new Date(evidencia.updatedAt),
            },
          })
          await tx.auditEvent.create({ data: eventoDe(auditoria) })
        },
        { isolationLevel: 'Serializable' }
      )
    } catch (error) {
      // The unique key (tenant, capability, requirement, reference) or a serialization failure
      // of two registrations racing for the same requirement.
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
      if (code === 'P2002') throw referenciaUsada()
      if (code === 'P2034') throw yaVigente()
      throw error
    }
  }

  async revocar(input: { tenantId: string; evidenceId: string; at: string }, auditoria: (registro: RegistroEvidencia) => AuditoriaEvidencia): Promise<RegistroEvidencia | null> {
    return this.client.$transaction(async (tx) => {
      const revocadas = await tx.evidenciaHabilitacion.updateMany({
        where: { id: input.evidenceId, tenantId: input.tenantId, revoked: false },
        data: { revoked: true, updatedAt: new Date(input.at) },
      })
      if (revocadas.count !== 1) return null
      const [fila] = await tx.evidenciaHabilitacion.findMany({ where: { id: input.evidenceId, tenantId: input.tenantId } })
      if (!fila) return null
      const registro = registroDe(fila)
      await tx.auditEvent.create({ data: eventoDe(auditoria(registro)) })
      return registro
    })
  }
}

function eventoDe(auditoria: AuditoriaEvidencia): Record<string, unknown> {
  return {
    id: randomUUID(),
    tenantId: auditoria.tenantId,
    actorId: auditoria.actorId,
    correlationId: auditoria.correlationId,
    eventType: auditoria.eventType,
    outcome: 'success',
    metadata: auditoria.metadata,
    occurredAt: new Date(auditoria.occurredAt),
  }
}

function registroDe(fila: Fila): RegistroEvidencia {
  const fecha = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString()
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    evidenceId: String(fila['id']),
    tenantId: String(fila['tenantId']),
    capability: fila['capability'] as CapacidadHabilitacion,
    gate: fila['gate'] as EvidenciaHabilitacion['gate'],
    owner: String(fila['owner']),
    scope: String(fila['scope']),
    evidenceType: String(fila['tipoEvidencia']),
    evidenceRef: String(fila['referenciaEvidencia']),
    policyVersion: String(fila['policyVersion']),
    issuedAt: fecha(fila['issuedAt']),
    expiresAt: fila['expiresAt'] === null || fila['expiresAt'] === undefined ? null : fecha(fila['expiresAt']),
    revoked: Boolean(fila['revoked']),
    source: fila['source'] as EvidenciaHabilitacion['source'],
    createdAt: fecha(fila['createdAt']),
    updatedAt: fecha(fila['updatedAt']),
  }
}
