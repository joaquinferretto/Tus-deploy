import { randomUUID } from 'node:crypto'
import { TIPOS_PRESTADOR, type TipoPrestador } from '@factory/contracts'

import { contieneContacto } from '../solicitudes/modelo.ts'

// PRESTADOR-TIPO-01. A provider is presented as a person (persona física) or as a business
// (empresa). It is ONLY how the provider is presented in TUS:
//
//   holder of the account  = the real person: "User".firstName / lastName. Never written here.
//   type of the provider   = perfiles_publicos_prestador.tipo_prestador.
//   public name            = perfiles_publicos_prestador.nombre_publico (what clients see).
//
// Changing the type keeps the same account, tenant, provider and profile rows: services, turnos,
// reservations, reviews, Mercado Pago, earnings, identity and history hang from those ids and are
// not touched. It is no requirement to work, to charge or to withdraw.
//
//   -> persona física: the public name becomes the first and last name of the holder of the
//      account. Missing: the change is refused (a name is never made up).
//   -> empresa: the public name is kept, or replaced by the one given (optional).

export interface FilaPerfilTipo {
  id: string
  tenantId: string
  prestadorId: string
  nombrePublico: string
  tipoPrestador: string
}

export interface ClientePrismaTipoPrestador {
  perfilPublicoPrestador: {
    findUnique(args: { where: { id: string } }): Promise<FilaPerfilTipo | null>
    update(args: { where: { id: string }; data: { tipoPrestador: string; nombrePublico: string; fechaActualizacion: Date } }): Promise<FilaPerfilTipo>
  }
  prestador: { findFirst(args: { where: { tenantId: string; prestadorId: string }; select: { cuentaId: true } }): Promise<{ cuentaId: string | null } | null> }
  account: { findUnique(args: { where: { id: string }; include: { user: true } }): Promise<{ id: string; user: { firstName: string | null; lastName: string | null } } | null> }
  auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> }
  $transaction<T>(operation: (tx: ClientePrismaTipoPrestador) => Promise<T>): Promise<T>
}

export interface TitularPrestador {
  cuentaId: string | null
  nombre: string | null
  apellido: string | null
  // First and last name together, only when BOTH exist.
  nombreCompleto: string | null
}

export type ResultadoTipoPrestador =
  | { ok: true; cambio: boolean; tipo: TipoPrestador; nombrePublico: string; tipoAnterior: TipoPrestador; nombrePublicoAnterior: string }
  | { ok: false; status: number; code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_TYPE' | 'INVALID_PUBLIC_NAME' | 'HOLDER_NAME_REQUIRED' | 'HOLDER_NAME_TOO_LONG' | 'INVALID_REASON' }

const limpio = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '')
const tipoDe = (value: string): TipoPrestador => (value === 'empresa' ? 'empresa' : 'persona_fisica')

// The same rule the profile form applies to a public name (directorio/modelo.ts).
export function nombrePublicoValido(nombre: string): boolean {
  return nombre.length >= 2 && nombre.length <= 60 && !contieneContacto(nombre) && !/\d{3,}/u.test(nombre)
}

export function crearTipoPrestadorAdmin(prisma: ClientePrismaTipoPrestador, now: () => number = Date.now) {
  const titularDe = async (cliente: ClientePrismaTipoPrestador, perfil: { tenantId: string; prestadorId: string }): Promise<TitularPrestador> => {
    const prestador = await cliente.prestador.findFirst({ where: { tenantId: perfil.tenantId, prestadorId: perfil.prestadorId }, select: { cuentaId: true } })
    const cuenta = prestador?.cuentaId ? await cliente.account.findUnique({ where: { id: prestador.cuentaId }, include: { user: true } }) : null
    const nombre = limpio(cuenta?.user.firstName) || null
    const apellido = limpio(cuenta?.user.lastName) || null
    return { cuentaId: cuenta?.id ?? null, nombre, apellido, nombreCompleto: nombre && apellido ? `${nombre} ${apellido}` : null }
  }

  return {
    // What the administration reads before deciding: the type, and the holder of the account.
    async estado(perfilId: string): Promise<{ tipo: TipoPrestador; nombrePublico: string; titular: TitularPrestador } | null> {
      const perfil = await prisma.perfilPublicoPrestador.findUnique({ where: { id: perfilId } })
      if (!perfil) return null
      return { tipo: tipoDe(perfil.tipoPrestador), nombrePublico: perfil.nombrePublico, titular: await titularDe(prisma, perfil) }
    },

    // The actor is the session (already authorized as platform administration by the router); the
    // profile is the one of the path. The body gives only the type, the optional public name of a
    // business and an optional note.
    async cambiar(actor: { subjectId: string; correlationId: string; permissions: readonly string[] }, perfilId: string, body: Record<string, unknown>): Promise<ResultadoTipoPrestador> {
      if (!actor.permissions.includes('tus:providers:admin')) return { ok: false, status: 403, code: 'FORBIDDEN' }
      const tipo = body['tipo']
      if (typeof tipo !== 'string' || !(TIPOS_PRESTADOR as readonly string[]).includes(tipo)) return { ok: false, status: 422, code: 'INVALID_TYPE' }
      const motivo = limpio(body['motivo'])
      if (motivo.length > 300) return { ok: false, status: 422, code: 'INVALID_REASON' }
      const pedido = limpio(body['nombrePublico'])
      return prisma.$transaction(async (tx) => {
        const perfil = await tx.perfilPublicoPrestador.findUnique({ where: { id: perfilId } })
        if (!perfil) return { ok: false as const, status: 404, code: 'NOT_FOUND' as const }
        const titular = await titularDe(tx, perfil)
        let nombrePublico: string
        if (tipo === 'persona_fisica') {
          // The name of the real holder, as it is on the account. Never made up, never typed here.
          if (!titular.nombreCompleto) return { ok: false as const, status: 409, code: 'HOLDER_NAME_REQUIRED' as const }
          if (!nombrePublicoValido(titular.nombreCompleto)) return { ok: false as const, status: 409, code: 'HOLDER_NAME_TOO_LONG' as const }
          nombrePublico = titular.nombreCompleto
        } else {
          nombrePublico = pedido || perfil.nombrePublico
          if (pedido && !nombrePublicoValido(pedido)) return { ok: false as const, status: 422, code: 'INVALID_PUBLIC_NAME' as const }
        }
        const tipoAnterior = tipoDe(perfil.tipoPrestador)
        const resultado = { ok: true as const, tipo: tipo as TipoPrestador, nombrePublico, tipoAnterior, nombrePublicoAnterior: perfil.nombrePublico }
        // Nothing changes: nothing is written and nothing is audited.
        if (tipoAnterior === tipo && perfil.nombrePublico === nombrePublico) return { ...resultado, cambio: false }
        const ahora = new Date(now())
        await tx.perfilPublicoPrestador.update({ where: { id: perfil.id }, data: { tipoPrestador: tipo, nombrePublico, fechaActualizacion: ahora } })
        await tx.auditEvent.create({
          data: {
            id: randomUUID(),
            tenantId: perfil.tenantId,
            actorId: actor.subjectId,
            correlationId: actor.correlationId,
            eventType: tipoAnterior === tipo ? 'provider.public_name_changed' : 'provider.type_changed',
            outcome: 'success',
            metadata: { perfilId: perfil.id, prestadorId: perfil.prestadorId, holderAccountId: titular.cuentaId, previousType: tipoAnterior, newType: tipo, previousPublicName: perfil.nombrePublico, newPublicName: nombrePublico, ...(motivo ? { reason: motivo } : {}) },
            occurredAt: ahora,
          },
        })
        return { ...resultado, cambio: true }
      })
    },
  }
}
