import { randomUUID } from 'node:crypto'
import { TIPOS_PRESTADOR, nombrePublicoPersonaFisica, type TipoPrestador } from '@factory/contracts'

import { contieneContacto } from '../solicitudes/modelo.ts'
import { cuentaDePrestador, type ClientePrismaVinculoPrestador } from './cuenta-prestador.ts'

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
//   persona física: the public name is DERIVED, never typed: every first name and every last name
//      of the holder of the account, capitalized by the one helper (nombrePublicoPersonaFisica).
//      It follows the holder when its name changes (sincronizarTitular).
//   empresa: the public name is free (the trade name), validated as any public name.
//
// The holder is the account linked to the provider (cuenta-prestador.ts, the one way to know it).

export interface FilaPerfilTipo {
  id: string
  tenantId: string
  prestadorId: string
  nombrePublico: string
  tipoPrestador: string
}

export interface ClientePrismaTipoPrestador extends ClientePrismaVinculoPrestador {
  perfilPublicoPrestador: {
    findUnique(args: { where: { id: string } }): Promise<FilaPerfilTipo | null>
    findFirst(args: { where: { tenantId: string } }): Promise<FilaPerfilTipo | null>
    update(args: { where: { id: string }; data: { tipoPrestador?: string; nombrePublico: string; fechaActualizacion: Date } }): Promise<FilaPerfilTipo>
  }
  account: ClientePrismaVinculoPrestador['account'] & {
    findUnique(args: { where: { id: string }; include: { user: true } }): Promise<{ id: string; tenantId: string; user: { firstName: string | null; lastName: string | null } } | null>
  }
  auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> }
  $transaction<T>(operation: (tx: ClientePrismaTipoPrestador) => Promise<T>): Promise<T>
}

export interface TitularPrestador {
  cuentaId: string | null
  nombre: string | null
  apellido: string | null
  // Every first name and every last name, capitalized; only when BOTH exist.
  nombreCompleto: string | null
}

export type ResultadoTipoPrestador =
  | { ok: true; cambio: boolean; tipo: TipoPrestador; nombrePublico: string; tipoAnterior: TipoPrestador; nombrePublicoAnterior: string }
  | { ok: false; status: number; code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_TYPE' | 'INVALID_PUBLIC_NAME' | 'HOLDER_NAME_REQUIRED' | 'HOLDER_NAME_TOO_LONG' | 'INVALID_REASON' }

// What decides the public name of the provider of a tenant: its type and, for a person, the name
// it must carry (null: the holder has no usable first and last name).
export interface ReglaNombrePublico {
  tipo: TipoPrestador
  nombre: string | null
}

const limpio = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '')
const tipoDe = (value: string): TipoPrestador => (value === 'empresa' ? 'empresa' : 'persona_fisica')

// The same rule the profile form applies to a public name (directorio/modelo.ts).
export function nombrePublicoValido(nombre: string): boolean {
  return nombre.length >= 2 && nombre.length <= 60 && !contieneContacto(nombre) && !/\d{3,}/u.test(nombre)
}

export function crearTipoPrestadorAdmin(prisma: ClientePrismaTipoPrestador, now: () => number = Date.now) {
  const titularDe = async (cliente: ClientePrismaTipoPrestador, tenantId: string): Promise<TitularPrestador> => {
    const cuentaId = await cuentaDePrestador(cliente, tenantId)
    const cuenta = cuentaId ? await cliente.account.findUnique({ where: { id: cuentaId }, include: { user: true } }) : null
    const nombre = limpio(cuenta?.user.firstName) || null
    const apellido = limpio(cuenta?.user.lastName) || null
    return { cuentaId: cuenta?.id ?? null, nombre, apellido, nombreCompleto: nombrePublicoPersonaFisica(nombre, apellido) }
  }
  const auditar = (tx: ClientePrismaTipoPrestador, perfil: FilaPerfilTipo, actor: { actorId: string; correlationId: string }, cambio: { holderAccountId: string | null; previousType: TipoPrestador; newType: TipoPrestador; newPublicName: string; reason?: string }, ahora: Date) =>
    tx.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: perfil.tenantId,
        actorId: actor.actorId,
        correlationId: actor.correlationId,
        eventType: cambio.previousType === cambio.newType ? 'provider.public_name_changed' : 'provider.type_changed',
        outcome: 'success',
        metadata: { perfilId: perfil.id, prestadorId: perfil.prestadorId, holderAccountId: cambio.holderAccountId, previousType: cambio.previousType, newType: cambio.newType, previousPublicName: perfil.nombrePublico, newPublicName: cambio.newPublicName, ...(cambio.reason ? { reason: cambio.reason } : {}) },
        occurredAt: ahora,
      },
    })

  return {
    // What the administration reads before deciding: the type, and the holder of the account.
    async estado(perfilId: string): Promise<{ tipo: TipoPrestador; nombrePublico: string; titular: TitularPrestador } | null> {
      const perfil = await prisma.perfilPublicoPrestador.findUnique({ where: { id: perfilId } })
      if (!perfil) return null
      return { tipo: tipoDe(perfil.tipoPrestador), nombrePublico: perfil.nombrePublico, titular: await titularDe(prisma, perfil.tenantId) }
    },

    // The rule every save of a profile obeys (ServicioDirectorio.guardarPerfil). A provider with
    // no profile yet starts as a person when its holder has a usable name, as a business (a free
    // name) when there is no name to derive.
    async reglaNombre(tenantId: string): Promise<ReglaNombrePublico> {
      const perfil = await prisma.perfilPublicoPrestador.findFirst({ where: { tenantId } })
      if (perfil && tipoDe(perfil.tipoPrestador) === 'empresa') return { tipo: 'empresa', nombre: null }
      const completo = (await titularDe(prisma, tenantId)).nombreCompleto
      const nombre = completo && nombrePublicoValido(completo) ? completo : null
      if (perfil) return { tipo: 'persona_fisica', nombre }
      return nombre ? { tipo: 'persona_fisica', nombre } : { tipo: 'empresa', nombre: null }
    },

    // The holder of an account changed its first or last name: the provider it is behind, when it
    // is presented as a person, follows. Nothing else is written; a name that cannot be a public
    // name (missing, too long) leaves the profile as it is.
    async sincronizarTitular(cuentaId: string, actor?: { actorId: string; correlationId: string }): Promise<boolean> {
      return prisma.$transaction(async (tx) => {
        const cuenta = await tx.account.findUnique({ where: { id: cuentaId }, include: { user: true } })
        if (!cuenta) return false
        const perfil = await tx.perfilPublicoPrestador.findFirst({ where: { tenantId: cuenta.tenantId } })
        if (!perfil || tipoDe(perfil.tipoPrestador) !== 'persona_fisica') return false
        const titular = await titularDe(tx, perfil.tenantId)
        if (titular.cuentaId !== cuentaId || !titular.nombreCompleto || !nombrePublicoValido(titular.nombreCompleto) || titular.nombreCompleto === perfil.nombrePublico) return false
        const ahora = new Date(now())
        await tx.perfilPublicoPrestador.update({ where: { id: perfil.id }, data: { nombrePublico: titular.nombreCompleto, fechaActualizacion: ahora } })
        await auditar(tx, perfil, actor ?? { actorId: cuentaId, correlationId: 'holder-name-sync' }, { holderAccountId: cuentaId, previousType: 'persona_fisica', newType: 'persona_fisica', newPublicName: titular.nombreCompleto, reason: 'holder_name_changed' }, ahora)
        return true
      })
    },

    // The actor is the session (already authorized as platform administration by the router); the
    // profile is the one of the path. The body gives only the type, the public name of a business
    // (optional; ignored for a person) and an optional note.
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
        const titular = await titularDe(tx, perfil.tenantId)
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
        await auditar(tx, perfil, { actorId: actor.subjectId, correlationId: actor.correlationId }, { holderAccountId: titular.cuentaId, previousType: tipoAnterior, newType: tipo as TipoPrestador, newPublicName: nombrePublico, ...(motivo ? { reason: motivo } : {}) }, ahora)
        return { ...resultado, cambio: true }
      })
    },
  }
}
