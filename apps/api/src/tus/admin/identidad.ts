import type { PerfilUsuarioAdminDTO } from '@factory/contracts'

import type { EstadoIdentidadAdmin } from '../identidad/servicio.ts'
import type { ResultadoIdentidadAdmin } from '../perfil/servicio.ts'

// ADMIN-IDENTIDAD-01. An administrator loads or corrects the identity of an account (first name,
// last name, document). One operation: the profile service validates and saves (same rules the
// owner gets in "Mi perfil", unique document), and the change is audited with the other
// administrative actions — who, on whom, which fields, masked values, the reason when given.
// The actor is always the session; an administrator never edits its own account from the sheet.
export interface DependenciasIdentidadAdmin {
  perfiles: { actualizarIdentidadAdmin(accountId: string, body: Record<string, unknown>): Promise<ResultadoIdentidadAdmin> }
  auditar(input: { actorId: string; accountId: string; details: Record<string, string | boolean> }): Promise<unknown>
}

export type ResultadoIdentidadUsuario = { ok: true; perfil: PerfilUsuarioAdminDTO } | { ok: false; code: string; errores?: Record<string, string> }

export function crearIdentidadUsuarioAdmin(deps: DependenciasIdentidadAdmin) {
  return async ({ actorId, accountId, body }: { actorId: string; accountId: string; body: Record<string, unknown> }): Promise<ResultadoIdentidadUsuario> => {
    if (actorId === accountId) return { ok: false, code: 'FORBIDDEN' }
    const resultado = await deps.perfiles.actualizarIdentidadAdmin(accountId, body)
    if (!resultado.ok) return resultado.code === 'INVALID_IDENTITY' ? { ok: false, code: resultado.code, errores: resultado.errores } : { ok: false, code: resultado.code }
    // Saving the same values again changes nothing and is not an event.
    if (resultado.cambio.changedFields.length > 0)
      await deps.auditar({
        actorId,
        accountId,
        details: {
          changedFields: resultado.cambio.changedFields.join(','),
          ...(resultado.cambio.documentBefore ? { documentBefore: resultado.cambio.documentBefore } : {}),
          documentAfter: resultado.cambio.documentAfter,
          profileCompleteBefore: resultado.cambio.profileCompleteBefore,
          profileCompleteAfter: resultado.cambio.profileCompleteAfter,
          ...(typeof body['motivo'] === 'string' && body['motivo'].trim() ? { reason: body['motivo'].trim().slice(0, 300) } : {}),
        },
      })
    return { ok: true, perfil: resultado.perfil }
  }
}

// ADMIN-IDENTIDAD-MANUAL-01. An administrator verifies, rejects, revokes or reopens the identity
// of the provider behind an account. The account is the one of the path, the actor is the session
// and the document is the one already loaded on that account: nothing of that comes from the
// request. The decision is taken on the canonical identity records (the ones payments read) and is
// audited twice: in the identity audit and with the other administrative actions on the account.
export interface DependenciasVerificacionIdentidadAdmin {
  leerUsuario(accountId: string): Promise<{ id: string; tenantId: string } | null>
  perfilUsuario(accountId: string): Promise<{ nombre: string | null; apellido: string | null; documento: { tipo: string; numero: string } | null } | null>
  identidad: {
    estadoAdmin(tenantId: string): Promise<EstadoIdentidadAdmin>
    decisionManualAdmin(context: { tenantId: string; actorId: string; correlationId: string }, input: { tenantId: string; userId: string; documentNumber: string | null; firstName: string | null; lastName: string | null; action: unknown; reason: unknown }): Promise<EstadoIdentidadAdmin>
  }
  auditar(input: { actorId: string; accountId: string; details: Record<string, string | boolean> }): Promise<unknown>
}

export type ResultadoVerificacionIdentidad = { ok: true; verificacion: EstadoIdentidadAdmin } | { ok: false; status: number; code: string }

export function crearVerificacionIdentidadAdmin(deps: DependenciasVerificacionIdentidadAdmin) {
  return {
    async estado(accountId: string): Promise<EstadoIdentidadAdmin | null> {
      const cuenta = await deps.leerUsuario(accountId)
      return cuenta ? deps.identidad.estadoAdmin(cuenta.tenantId) : null
    },
    async decidir({ actor, accountId, accion, motivo }: { actor: { subjectId: string; tenantId: string; correlationId: string }; accountId: string; accion: unknown; motivo: unknown }): Promise<ResultadoVerificacionIdentidad> {
      // Nobody decides on its own identity: not its own account, not the provider it belongs to.
      if (actor.subjectId === accountId) return { ok: false, status: 403, code: 'FORBIDDEN' }
      const cuenta = await deps.leerUsuario(accountId)
      if (!cuenta) return { ok: false, status: 404, code: 'NOT_FOUND' }
      if (cuenta.tenantId === actor.tenantId) return { ok: false, status: 403, code: 'FORBIDDEN' }
      const perfil = await deps.perfilUsuario(accountId)
      try {
        const antes = await deps.identidad.estadoAdmin(cuenta.tenantId)
        const verificacion = await deps.identidad.decisionManualAdmin(
          { tenantId: actor.tenantId, actorId: actor.subjectId, correlationId: actor.correlationId },
          { tenantId: cuenta.tenantId, userId: cuenta.id, documentNumber: perfil?.documento?.tipo === 'DNI' ? perfil.documento.numero : null, firstName: perfil?.nombre ?? null, lastName: perfil?.apellido ?? null, action: accion, reason: motivo }
        )
        if (antes.estado !== verificacion.estado)
          await deps.auditar({ actorId: actor.subjectId, accountId, details: { identityVerification: String(accion), previousState: antes.estado, newState: verificacion.estado, reason: String(motivo).trim().slice(0, 300), channel: 'admin' } })
        return { ok: true, verificacion }
      } catch (error) {
        const fallo = error as { status?: unknown; code?: unknown }
        if (typeof fallo.status === 'number' && typeof fallo.code === 'string') return { ok: false, status: fallo.status, code: fallo.code }
        throw error
      }
    },
  }
}
