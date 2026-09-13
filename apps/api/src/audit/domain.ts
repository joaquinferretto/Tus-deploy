import { createHash } from 'node:crypto'

export const RESULTADOS_AUDITORIA = {
  SUCCESS: 'success',
  DENIED: 'denied',
} as const

export type ResultadoAuditoria = (typeof RESULTADOS_AUDITORIA)[keyof typeof RESULTADOS_AUDITORIA]

export interface MetadatosAuditoria {
  [key: string]: string | number | boolean | null
}

export interface EventoAuditoria {
  id: string
  action: string
  actorId: string | null
  productId: string | null
  tenantId: string | null
  correlationId: string
  outcome: ResultadoAuditoria
  reason: string
  occurredAt: string
  metadata: MetadatosAuditoria
}

const REDACTED_KEYS = /token|secret|password|credential|authorization|cookie|email|sessionid/i

export function calcularHuellaAuditoria(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function redactarMetadatosAuditoria(metadata: MetadatosAuditoria): MetadatosAuditoria {
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => {
      if (REDACTED_KEYS.test(key)) return [[`${key}Hash`, calcularHuellaAuditoria(String(value))]]
      return [[key, value]]
    })
  )
}
