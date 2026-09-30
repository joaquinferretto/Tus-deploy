import { normalizarTelefono } from '@factory/contracts'

import type { AuthService } from '../application/auth-service.js'
import { FixedWindowRateLimiter } from '../adapters/in-memory-auxiliaries.js'
import { PostgresRateLimiter, type RawQueryClient } from '../adapters/postgres/postgres-rate-limiter.js'
import type { Account } from '../domain/models.js'
import type { AuditSink, RateLimiter } from '../ports/security.js'
import type { AlmacenTelefonos } from './puertos.ts'
import { ServicioVerificacionTelefono } from './servicio.ts'

// Limits of the phone flows. Durable (auth_rate_limits, the same table as sign-in) when the Prisma
// client can run raw SQL; in memory otherwise (tests / local).
const LIMITES = {
  porCuenta: { scope: 'phone-challenge-account', max: 5, windowMs: 15 * 60_000 },
  porTelefono: { scope: 'phone-challenge-phone', max: 5, windowMs: 60 * 60_000 },
  porIp: { scope: 'phone-challenge-ip', max: 30, windowMs: 15 * 60_000 },
  recuperacion: { scope: 'phone-recovery', max: 3, windowMs: 15 * 60_000 },
} as const

// TUS_WHATSAPP_PUBLIC_NUMBER: the official TUS WhatsApp number people write to (public, it is
// shown to every user; never a token). Invalid or absent -> null: the Web shows the code to
// send by hand and the verification still works.
export function leerNumeroOficialWhatsapp(env: Record<string, string | undefined>): string | null {
  const valor = env['TUS_WHATSAPP_PUBLIC_NUMBER']?.trim()
  if (!valor) return null
  const normalizado = normalizarTelefono(valor.startsWith('+') ? valor : `+${valor}`)
  return normalizado.ok ? normalizado.e164 : null
}

export function crearServicioTelefono(input: {
  auth: { service: Pick<AuthService, 'issueRecoveryTokenForAccount'>; store: { getAccount(accountId: string): Promise<Account | undefined> }; audit: AuditSink }
  telefonos: AlmacenTelefonos
  env: Record<string, string | undefined>
  raw?: RawQueryClient | null
  now?: () => number
  limitadores?: { porCuenta?: RateLimiter; porTelefono?: RateLimiter; porIp?: RateLimiter; recuperacion?: RateLimiter }
}): ServicioVerificacionTelefono {
  const limitador = (definicion: { scope: string; max: number; windowMs: number }): RateLimiter =>
    input.raw ? new PostgresRateLimiter(input.raw, definicion.scope, definicion.max, definicion.windowMs) : new FixedWindowRateLimiter(definicion.max, definicion.windowMs)
  return new ServicioVerificacionTelefono({
    telefonos: input.telefonos,
    cuentas: input.auth.store,
    audit: input.auth.audit,
    now: input.now ?? Date.now,
    numeroOficial: leerNumeroOficialWhatsapp(input.env),
    limitadores: input.limitadores ?? {
      porCuenta: limitador(LIMITES.porCuenta),
      porTelefono: limitador(LIMITES.porTelefono),
      porIp: limitador(LIMITES.porIp),
      recuperacion: limitador(LIMITES.recuperacion),
    },
    emitirTokenRecuperacion: (accountId) => input.auth.service.issueRecoveryTokenForAccount(accountId),
  })
}
