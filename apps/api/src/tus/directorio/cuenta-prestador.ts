// PRESTADOR-CUENTA-01. The ONE way to know which account is behind a provider.
//
//   prestadores.cuenta_id -> "Account".id        (a persisted relation, by id)
//
// A provider with no linked account, or whose linked account is not active or belongs to another
// tenant, resolves to nobody: nothing is inferred from the tenant, from an order of creation,
// from a name or from an email. Those rows are reconciled by hand in the administration.

export type VinculoPrestador =
  | { estado: 'vinculada'; cuentaId: string }
  // No provider row of that tenant has an account linked.
  | { estado: 'sin_vincular' }
  // More than one provider row of the tenant, linked to different accounts.
  | { estado: 'ambiguo' }
  // The linked account does not exist, is not active or belongs to another tenant.
  | { estado: 'cuenta_invalida'; cuentaId: string }

export interface ClientePrismaVinculoPrestador {
  prestador: { findMany(args: unknown): Promise<Array<{ tenantId: string; cuentaId: string | null }>> }
  account: { findMany(args: unknown): Promise<Array<{ id: string; tenantId: string; status: string }>> }
}

// The link of each tenant (two queries for the whole list).
export async function vinculosDePrestadores(db: ClientePrismaVinculoPrestador, tenantIds: readonly string[]): Promise<Map<string, VinculoPrestador>> {
  const resultado = new Map<string, VinculoPrestador>()
  const tenants = [...new Set(tenantIds)].filter(Boolean)
  if (tenants.length === 0) return resultado
  const filas = await db.prestador.findMany({ where: { tenantId: { in: tenants } }, select: { tenantId: true, cuentaId: true } })
  const vinculadas = new Map<string, Set<string>>()
  for (const tenantId of tenants) vinculadas.set(tenantId, new Set())
  for (const fila of filas) if (fila.cuentaId) vinculadas.get(fila.tenantId)?.add(fila.cuentaId)
  const ids = [...vinculadas.values()].flatMap((conjunto) => [...conjunto])
  const cuentas = ids.length === 0 ? [] : await db.account.findMany({ where: { id: { in: ids } }, select: { id: true, tenantId: true, status: true } })
  const cuentaDe = new Map(cuentas.map((cuenta) => [cuenta.id, cuenta]))
  for (const [tenantId, conjunto] of vinculadas) {
    if (conjunto.size === 0) resultado.set(tenantId, { estado: 'sin_vincular' })
    else if (conjunto.size > 1) resultado.set(tenantId, { estado: 'ambiguo' })
    else {
      const cuentaId = [...conjunto][0]!
      const cuenta = cuentaDe.get(cuentaId)
      resultado.set(tenantId, cuenta && cuenta.tenantId === tenantId && cuenta.status === 'active' ? { estado: 'vinculada', cuentaId } : { estado: 'cuenta_invalida', cuentaId })
    }
  }
  return resultado
}

// The account of the provider of a tenant, or null when there is none to be sure of.
export async function cuentaDePrestador(db: ClientePrismaVinculoPrestador, tenantId: string): Promise<string | null> {
  const vinculo = (await vinculosDePrestadores(db, [tenantId])).get(tenantId)
  return vinculo?.estado === 'vinculada' ? vinculo.cuentaId : null
}
