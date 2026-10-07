import { enmascararTelefono } from '@factory/contracts'

import { vinculosDePrestadores, type ClientePrismaVinculoPrestador } from '../directorio/cuenta-prestador.ts'

// PRESTADOR-CUENTA-01. Who is behind a provider profile, resolved by ids and persisted relations
// (never by a name, an email or an order of creation):
//
//   perfil -> prestadores.cuenta_id -> "Account".id -> "User"      (directorio/cuenta-prestador.ts)
//
// The same resolver the backend notifies the provider with. A provider with no linked account
// shows none here, with the reason: it is reconciled by hand, never guessed.
//
// What each state means, and the evidence behind it:
// - phone verified: "User"."phoneNumber" + "phoneVerifiedAt" (a code the person answered, or an
//   administrator that certified it). A pending number is not a verified one.
// - WhatsApp linked: a row of contactos_whatsapp (channel whatsapp) whose cuenta_vinculada_id is
//   that account. Having a phone is NOT having WhatsApp linked.
// - can be written now: that contact has an active conversation in bot mode whose last inbound
//   message is less than 24 hours old (Meta's customer service window).
// - outside that window TUS may only send an approved template; whether the request template is
//   approved is configuration (WHATSAPP_APPROVED_TEMPLATES), reported as it is.

export type DestinoWhatsappPrestador =
  // Linked and inside the 24 hour window: requests arrive with their buttons.
  | 'listo'
  // Linked, window closed, the request template is approved: requests arrive as a template.
  | 'plantilla'
  // Linked, window closed and no approved template: nothing can be sent until the person writes.
  | 'ventana_cerrada'
  // No WhatsApp linked to the account (whatever its phone says).
  | 'no_vinculado'
  // No account behind the profile.
  | 'sin_cuenta'

export interface CuentaPrestadorAdmin {
  cuentaId: string
  usuarioId: string
  nombre: string
  email: string
  estado: string
  emailVerificado: boolean
  documento: { tipo: string; numero: string } | null
  telefono: { numero: string | null; verificado: boolean; pendiente: string | null }
  whatsapp: { vinculado: boolean; vinculadoEn: string | null; ultimoMensajeEn: string | null; ventanaAbierta: boolean; destino: DestinoWhatsappPrestador }
  // State of the latest identity verification of that person (null: never started).
  identidad: string | null
  // Accounts of the provider's tenant (more than one is worth a look; only the linked one counts).
  cuentasEnTenant: number
}

// Why a provider shows no account, for the administration to reconcile it.
export type ProblemaCuentaPrestador = 'sin_vincular' | 'ambiguo' | 'cuenta_invalida'

export interface CuentasPrestadores {
  cuentas: Map<string, CuentaPrestadorAdmin>
  // Tenants whose provider has no usable account, with the reason and how many accounts the
  // tenant has (candidates a person may pick from; the code never picks).
  problemas: Map<string, { motivo: ProblemaCuentaPrestador; cuentasEnTenant: number }>
}

interface FilaCuenta {
  id: string
  tenantId: string
  status: string
  emailVerifiedAt: Date | null
  createdAt: Date
  user: { id: string; email: string; displayName: string; firstName: string | null; lastName: string | null; documentType: string | null; documentNumber: string | null; phoneNumber: string | null; phoneVerifiedAt: Date | null; phonePending: string | null }
}

export interface ClientePrismaCuentaPrestador extends ClientePrismaVinculoPrestador {
  account: { findMany(args: unknown): Promise<FilaCuenta[]> } & ClientePrismaVinculoPrestador['account']
  contactoWhatsapp: { findMany(args: unknown): Promise<Array<{ id: string; cuentaVinculadaId: string | null; vinculadoEn: Date | null }>> }
  conversacionWhatsapp: { findMany(args: unknown): Promise<Array<{ contactoId: string; modo: string; ultimoEntranteEn: Date | null }>> }
  verificacionIdentidad: { findMany(args: unknown): Promise<Array<{ usuarioId: string; estado: string; fechaCreacion: Date }>> }
}

const VENTANA_MS = 24 * 60 * 60 * 1000

export function crearLectorCuentasPrestador(prisma: ClientePrismaCuentaPrestador, opciones: { plantillaAprobada: () => boolean; now?: () => number }) {
  const now = opciones.now ?? Date.now
  // One query per table for the whole page of providers (never one per row).
  return async function cuentasDePrestadores(tenantIds: readonly string[]): Promise<CuentasPrestadores> {
    const resultado = new Map<string, CuentaPrestadorAdmin>()
    const problemas: CuentasPrestadores['problemas'] = new Map()
    const tenants = [...new Set(tenantIds)].filter(Boolean)
    if (tenants.length === 0) return { cuentas: resultado, problemas }
    const [vinculos, cuentas] = await Promise.all([
      vinculosDePrestadores(prisma, tenants),
      (prisma.account.findMany as (args: unknown) => Promise<FilaCuenta[]>)({ where: { tenantId: { in: tenants } }, include: { user: true }, orderBy: { createdAt: 'asc' } }),
    ])
    const enTenant = new Map<string, number>()
    for (const cuenta of cuentas) enTenant.set(cuenta.tenantId, (enTenant.get(cuenta.tenantId) ?? 0) + 1)
    const elegidas = new Map<string, { cuenta: FilaCuenta; activas: number }>()
    for (const tenantId of tenants) {
      const vinculo = vinculos.get(tenantId)
      const cuenta = vinculo?.estado === 'vinculada' ? cuentas.find((item) => item.id === vinculo.cuentaId) : undefined
      if (cuenta) elegidas.set(tenantId, { cuenta, activas: enTenant.get(tenantId) ?? 0 })
      else problemas.set(tenantId, { motivo: vinculo?.estado === 'ambiguo' ? 'ambiguo' : vinculo?.estado === 'cuenta_invalida' ? 'cuenta_invalida' : 'sin_vincular', cuentasEnTenant: enTenant.get(tenantId) ?? 0 })
    }
    const cuentaIds = [...elegidas.values()].map((item) => item.cuenta.id)
    const usuarioIds = [...elegidas.values()].map((item) => item.cuenta.user.id)
    const [contactos, verificaciones] = await Promise.all([
      prisma.contactoWhatsapp.findMany({ where: { canal: 'whatsapp', cuentaVinculadaId: { in: cuentaIds } }, select: { id: true, cuentaVinculadaId: true, vinculadoEn: true } }),
      prisma.verificacionIdentidad.findMany({ where: { usuarioId: { in: [...cuentaIds, ...usuarioIds] } }, select: { usuarioId: true, estado: true, fechaCreacion: true }, orderBy: { fechaCreacion: 'desc' } }),
    ])
    const conversaciones = contactos.length === 0 ? [] : await prisma.conversacionWhatsapp.findMany({ where: { contactoId: { in: contactos.map((contacto) => contacto.id) }, estado: 'active', canal: 'whatsapp' }, select: { contactoId: true, modo: true, ultimoEntranteEn: true } })
    const conversacionDe = new Map(conversaciones.map((conversacion) => [conversacion.contactoId, conversacion]))
    const identidadDe = new Map<string, string>()
    for (const verificacion of verificaciones) if (!identidadDe.has(verificacion.usuarioId)) identidadDe.set(verificacion.usuarioId, verificacion.estado)
    for (const [tenantId, { cuenta, activas }] of elegidas) {
      const propios = contactos.filter((contacto) => contacto.cuentaVinculadaId === cuenta.id)
      const ahora = now()
      let ultimo: Date | null = null
      let abierta = false
      for (const contacto of propios) {
        const conversacion = conversacionDe.get(contacto.id)
        if (!conversacion?.ultimoEntranteEn) continue
        if (!ultimo || conversacion.ultimoEntranteEn > ultimo) ultimo = conversacion.ultimoEntranteEn
        if (conversacion.modo === 'bot' && ahora - conversacion.ultimoEntranteEn.getTime() < VENTANA_MS) abierta = true
      }
      const vinculado = propios.length > 0
      const destino: DestinoWhatsappPrestador = !vinculado ? 'no_vinculado' : abierta ? 'listo' : opciones.plantillaAprobada() ? 'plantilla' : 'ventana_cerrada'
      const user = cuenta.user
      const real = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
      resultado.set(tenantId, {
        cuentaId: cuenta.id,
        usuarioId: user.id,
        nombre: real || user.displayName,
        email: user.email,
        estado: cuenta.status,
        emailVerificado: cuenta.emailVerifiedAt !== null,
        documento: user.documentType && user.documentNumber ? { tipo: user.documentType, numero: user.documentNumber } : null,
        telefono: { numero: user.phoneNumber ? enmascararTelefono(user.phoneNumber) : null, verificado: Boolean(user.phoneNumber && user.phoneVerifiedAt), pendiente: user.phonePending ? enmascararTelefono(user.phonePending) : null },
        whatsapp: { vinculado, vinculadoEn: propios.map((contacto) => contacto.vinculadoEn).filter((fecha): fecha is Date => fecha !== null).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null, ultimoMensajeEn: ultimo?.toISOString() ?? null, ventanaAbierta: abierta, destino },
        identidad: identidadDe.get(cuenta.id) ?? identidadDe.get(user.id) ?? null,
        cuentasEnTenant: activas,
      })
    }
    return { cuentas: resultado, problemas }
  }
}
