// Provider / request counts shown next to each catalog row in the admin panel (Servicios, Zonas,
// Barrios, Categorías). Every method answers a whole page of ids with a fixed number of aggregate
// queries (GROUP BY), never one query per trade, zone or neighbourhood.
//
// Criteria (same in memory and in PostgreSQL):
// - trade `prestadores`: profiles OFFERING that trade (perfil_servicios, N:M) whose provider
//   (prestadores.estado) is approved;
//   `enMapa`: of those, the visible ones with at least one zone (what the map can place).
// - neighbourhood / zone `prestadores`: visible profiles of approved providers whose zone or
//   coverage includes the neighbourhood (for a zone: any of its neighbourhoods, counted once).
// - neighbourhood `solicitudes`: service requests whose zone is that neighbourhood.

import type { ServicioDirectorio } from '../directorio/servicio.ts'
import type { ServicioSolicitudes } from '../solicitudes/servicio.ts'
import type { ServicioCatalogo } from '../catalogo/servicio.ts'

export interface ConteosCatalogo {
  porOficio(ids: readonly string[]): Promise<Map<string, { prestadores: number; enMapa: number }>>
  porBarrio(nombres: readonly string[]): Promise<Map<string, { prestadores: number; solicitudes: number }>>
  porZona(zonaIds: readonly string[]): Promise<Map<string, { prestadores: number; barrios: number }>>
  oficiosPorCategoria(categoriaIds: readonly string[]): Promise<Map<string, number>>
  // Any profile (visible or not) or request that stores this neighbourhood NAME: renaming it
  // would orphan them.
  referenciasBarrio(nombre: string): Promise<number>
}

type Fila = Record<string, unknown>

interface DelegadoAgrupable {
  groupBy(input: { by: string[]; where: Fila; _count: { _all: true } }): Promise<Fila[]>
  count(input: { where: Fila }): Promise<number>
}

export interface ClientePrismaConteos {
  perfilPublicoPrestador: DelegadoAgrupable
  solicitudServicio: DelegadoAgrupable
  oficioServicio: DelegadoAgrupable
  barrio: DelegadoAgrupable
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

const total = (fila: Fila) => Number((fila['_count'] as { _all?: number } | undefined)?._all ?? 0)

// Place of a profile = its zone + its coverage (unnest), joined to its approved provider.
const lugaresVisibles = (joins = '') => `
  FROM public."perfiles_publicos_prestador" p
  JOIN public."prestadores" m ON m."tenant_id" = p."tenant_id" AND m."prestador_id" = p."prestador_id" AND m."estado" = 'approved'
  CROSS JOIN LATERAL unnest(array_append(p."zonas_cobertura", p."zona")) AS l(lugar)
  ${joins}
  WHERE p."visible" = true`

export class ConteosCatalogoPrisma implements ConteosCatalogo {
  constructor(private readonly client: ClientePrismaConteos) {}

  // A provider counts in EVERY service it offers (perfil_servicios, N:M): one grouped query.
  async porOficio(ids: readonly string[]) {
    const resultado = new Map(ids.map((id) => [id, { prestadores: 0, enMapa: 0 }]))
    if (ids.length === 0) return resultado
    const filas = await this.client.$queryRawUnsafe<{ id: string; prestadores: number; en_mapa: number }[]>(
      `SELECT s."oficio_id" AS id,
              count(DISTINCT p."id")::int AS prestadores,
              (count(DISTINCT p."id") FILTER (WHERE p."visible" AND (p."zona" IS NOT NULL OR cardinality(p."zonas_cobertura") > 0)))::int AS en_mapa
         FROM public."perfil_servicios" s
         JOIN public."perfiles_publicos_prestador" p ON p."id" = s."perfil_id"
         JOIN public."prestadores" m ON m."tenant_id" = p."tenant_id" AND m."prestador_id" = p."prestador_id" AND m."estado" = 'approved'
        WHERE s."oficio_id" = ANY($1::text[])
        GROUP BY s."oficio_id"`,
      [...ids]
    )
    for (const fila of filas) {
      const actual = resultado.get(String(fila.id))
      if (actual) Object.assign(actual, { prestadores: Number(fila.prestadores), enMapa: Number(fila.en_mapa) })
    }
    return resultado
  }

  async porBarrio(nombres: readonly string[]) {
    const resultado = new Map(nombres.map((nombre) => [nombre, { prestadores: 0, solicitudes: 0 }]))
    if (nombres.length === 0) return resultado
    const [prestadores, solicitudes] = await Promise.all([
      this.client.$queryRawUnsafe<{ nombre: string; total: number }[]>(
        `SELECT l.lugar AS nombre, count(DISTINCT p."id")::int AS total ${lugaresVisibles()} AND l.lugar = ANY($1::text[]) GROUP BY l.lugar`,
        [...nombres]
      ),
      this.client.solicitudServicio.groupBy({ by: ['zona'], where: { zona: { in: [...nombres] } }, _count: { _all: true } }),
    ])
    for (const fila of prestadores) {
      const item = resultado.get(fila.nombre)
      if (item) item.prestadores = Number(fila.total)
    }
    for (const fila of solicitudes) {
      const item = resultado.get(String(fila['zona']))
      if (item) item.solicitudes = total(fila)
    }
    return resultado
  }

  async porZona(zonaIds: readonly string[]) {
    const resultado = new Map(zonaIds.map((id) => [id, { prestadores: 0, barrios: 0 }]))
    if (zonaIds.length === 0) return resultado
    const [prestadores, barrios] = await Promise.all([
      this.client.$queryRawUnsafe<{ id: string; total: number }[]>(
        `SELECT b."zona_id" AS id, count(DISTINCT p."id")::int AS total ${lugaresVisibles('JOIN public."barrios" b ON b."nombre" = l.lugar')} AND b."zona_id" = ANY($1::text[]) GROUP BY b."zona_id"`,
        [...zonaIds]
      ),
      this.client.barrio.groupBy({ by: ['zonaId'], where: { zonaId: { in: [...zonaIds] } }, _count: { _all: true } }),
    ])
    for (const fila of prestadores) {
      const item = resultado.get(fila.id)
      if (item) item.prestadores = Number(fila.total)
    }
    for (const fila of barrios) {
      const item = resultado.get(String(fila['zonaId']))
      if (item) item.barrios = total(fila)
    }
    return resultado
  }

  async oficiosPorCategoria(categoriaIds: readonly string[]) {
    const resultado = new Map(categoriaIds.map((id) => [id, 0]))
    if (categoriaIds.length === 0) return resultado
    const filas = await this.client.oficioServicio.groupBy({ by: ['categoriaId'], where: { categoriaId: { in: [...categoriaIds] } }, _count: { _all: true } })
    for (const fila of filas) resultado.set(String(fila['categoriaId']), total(fila))
    return resultado
  }

  async referenciasBarrio(nombre: string) {
    const [perfiles, solicitudes] = await Promise.all([
      this.client.perfilPublicoPrestador.count({ where: { OR: [{ zona: nombre }, { zonasCobertura: { has: nombre } }] } }),
      this.client.solicitudServicio.count({ where: { zona: nombre } }),
    ])
    return perfiles + solicitudes
  }
}

// In memory (tests / local compositions without PostgreSQL): the same criteria computed over the
// in-memory directory and requests.
export class ConteosCatalogoEnMemoria implements ConteosCatalogo {
  constructor(private readonly deps: { directorio: ServicioDirectorio; solicitudes: ServicioSolicitudes; catalogo?: ServicioCatalogo }) {}

  private async perfiles() {
    return (await this.deps.directorio.listarParaAdmin()).filter((perfil) => perfil.aprobado)
  }

  async porOficio(ids: readonly string[]) {
    const perfiles = await this.perfiles()
    return new Map(ids.map((id) => {
      const propios = perfiles.filter((perfil) => perfil.oficios.some((item) => item.id === id))
      return [id, { prestadores: propios.length, enMapa: propios.filter((perfil) => perfil.visible && (perfil.zona !== null || perfil.zonasCobertura.length > 0)).length }]
    }))
  }

  async porBarrio(nombres: readonly string[]) {
    const [perfiles, solicitudes] = await Promise.all([this.perfiles(), this.deps.solicitudes.listarParaAdmin(500)])
    return new Map(nombres.map((nombre) => [nombre, {
      prestadores: perfiles.filter((perfil) => perfil.visible && (perfil.zona === nombre || perfil.zonasCobertura.includes(nombre))).length,
      solicitudes: solicitudes.filter((item) => item.zona === nombre).length,
    }]))
  }

  async porZona(zonaIds: readonly string[]) {
    const [perfiles, catalogo] = await Promise.all([this.perfiles(), this.deps.catalogo?.leer()])
    return new Map(zonaIds.map((id) => {
      const barrios = (catalogo?.barrios ?? []).filter((barrio) => barrio.zonaId === id).map((barrio) => barrio.nombre)
      const prestadores = perfiles.filter((perfil) => perfil.visible && barrios.some((nombre) => perfil.zona === nombre || perfil.zonasCobertura.includes(nombre))).length
      return [id, { prestadores, barrios: barrios.length }]
    }))
  }

  async oficiosPorCategoria(categoriaIds: readonly string[]) {
    const catalogo = await this.deps.catalogo?.leer()
    return new Map(categoriaIds.map((id) => [id, (catalogo?.oficios ?? []).filter((oficio) => oficio.categoriaId === id).length]))
  }

  async referenciasBarrio(nombre: string) {
    const [perfiles, solicitudes] = await Promise.all([this.deps.directorio.listarParaAdmin(), this.deps.solicitudes.listarParaAdmin(500)])
    return perfiles.filter((perfil) => perfil.zona === nombre || perfil.zonasCobertura.includes(nombre)).length + solicitudes.filter((item) => item.zona === nombre).length
  }
}
