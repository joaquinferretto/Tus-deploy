import type { PerfilUsuarioAdminDTO } from '@factory/contracts'

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
