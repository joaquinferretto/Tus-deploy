// Pagination of the administration lists (users, providers, requests, catalog, identity,
// WhatsApp, audit). The store cuts the page (LIMIT/OFFSET in PostgreSQL); this module only
// normalizes what the client asked for.
//
// pageSize 10, 25 (default) or 50; more than 50 (51, 100, 100000) is capped at 50; anything else
// (0, -1, 7, "abc", missing) is 25. page is an integer from 1 (a page past the end is empty).

export const TAMANOS_PAGINA = [10, 25, 50] as const
export const TAMANO_PAGINA_DEFECTO = 25
export const TAMANO_PAGINA_MAXIMO = 50
const PAGINA_MAXIMA = 10_000

export function paginacion(query: Record<string, unknown>): { pagina: number; tamano: number } {
  const pagina = Math.min(PAGINA_MAXIMA, Math.max(1, Number.parseInt(String(query['page'] ?? '1'), 10) || 1))
  const pedido = Number.parseInt(String(query['pageSize'] ?? ''), 10)
  const tamano = (TAMANOS_PAGINA as readonly number[]).includes(pedido)
    ? pedido
    : pedido > TAMANO_PAGINA_MAXIMO
      ? TAMANO_PAGINA_MAXIMO
      : TAMANO_PAGINA_DEFECTO
  return { pagina, tamano }
}

export const paginaJson = <T>(items: T[], pagina: number, tamano: number, total: number) => ({
  items,
  page: pagina,
  pageSize: tamano,
  total,
  totalPages: Math.max(1, Math.ceil(total / tamano)),
})
