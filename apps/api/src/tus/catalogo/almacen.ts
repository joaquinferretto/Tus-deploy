import { Prisma } from '@prisma/client'
import { sinAcentos } from '../texto.ts'
import { slugificar, validarPoligono, type BarrioCatalogo, type CatalogoTus, type CategoriaCatalogo, type LocalidadCatalogo, type OficioCatalogo, type ZonaCatalogo } from './modelo.ts'
import { SEMILLA_CATALOGO } from './semilla.ts'

// Persistence of the administered catalog. Same semantics in memory (tests / local) and in
// PostgreSQL. Only upserts: nothing is deleted (a record is deactivated instead).
export type EntidadListable = 'categorias' | 'oficios' | 'localidades' | 'zonas' | 'barrios'

export interface FiltroCatalogo {
  pagina: number
  tamano: number
  q: string
  activo: boolean | null
  categoriaId: string
  localidadId: string
  zonaId: string
}

type ItemDe<E extends EntidadListable> = CatalogoTus[E][number]

export interface AlmacenCatalogo {
  cargar(): Promise<CatalogoTus>
  // One page of an entity for the admin lists: filtered, ordered by (orden, nombre, id) and cut
  // by the store (LIMIT/OFFSET in PostgreSQL), plus the filtered total.
  pagina<E extends EntidadListable>(entidad: E, filtro: FiltroCatalogo): Promise<{ items: ItemDe<E>[]; total: number }>
  guardarCategoria(item: CategoriaCatalogo): Promise<void>
  guardarOficio(item: OficioCatalogo): Promise<void>
  guardarLocalidad(item: LocalidadCatalogo): Promise<void>
  guardarZona(item: ZonaCatalogo): Promise<void>
  guardarBarrio(item: BarrioCatalogo): Promise<void>
}

const copia = (catalogo: CatalogoTus): CatalogoTus => structuredClone(catalogo)
const clave = (value: string) => sinAcentos(value.toLowerCase()).replace(/s+/gu, ' ').trim()

export class AlmacenCatalogoEnMemoria implements AlmacenCatalogo {
  private datos: CatalogoTus

  constructor(inicial: CatalogoTus = SEMILLA_CATALOGO) {
    this.datos = copia(inicial)
  }

  async cargar() {
    return copia(this.datos)
  }

  async pagina<E extends EntidadListable>(entidad: E, filtro: FiltroCatalogo): Promise<{ items: ItemDe<E>[]; total: number }> {
    const q = clave(filtro.q)
    const lista = (this.datos[entidad] as ItemDe<E>[]).filter((item) => {
      const fila = item as ItemDe<E> & { categoriaId?: string | null; localidadId?: string; zonaId?: string | null; sinonimos?: string[]; slug?: string }
      if (filtro.activo !== null && item.activo !== filtro.activo) return false
      if (filtro.categoriaId && fila.categoriaId !== filtro.categoriaId) return false
      if (filtro.localidadId && fila.localidadId !== filtro.localidadId) return false
      if (filtro.zonaId && fila.zonaId !== filtro.zonaId) return false
      return !q || clave(item.nombre).includes(q) || (fila.sinonimos ?? []).some((termino) => termino.includes(q))
    }).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre) || a.id.localeCompare(b.id))
    return { items: structuredClone(lista.slice((filtro.pagina - 1) * filtro.tamano, filtro.pagina * filtro.tamano)), total: lista.length }
  }

  private upsert<T extends { id: string }>(lista: T[], item: T) {
    const index = lista.findIndex((actual) => actual.id === item.id)
    if (index >= 0) lista[index] = structuredClone(item)
    else lista.push(structuredClone(item))
  }

  async guardarCategoria(item: CategoriaCatalogo) { this.upsert(this.datos.categorias, item) }
  async guardarOficio(item: OficioCatalogo) { this.upsert(this.datos.oficios, item) }
  async guardarLocalidad(item: LocalidadCatalogo) { this.upsert(this.datos.localidades, item) }
  async guardarZona(item: ZonaCatalogo) { this.upsert(this.datos.zonas, item) }
  async guardarBarrio(item: BarrioCatalogo) { this.upsert(this.datos.barrios, item) }
}

type Fila = Record<string, unknown>

interface Delegado {
  findMany(input?: { where?: Fila; include?: Fila; orderBy?: Fila | Fila[]; skip?: number; take?: number }): Promise<Fila[]>
  count(input: { where: Fila }): Promise<number>
  upsert(input: { where: Fila; create: Fila; update: Fila }): Promise<unknown>
}

export interface ClientePrismaCatalogo {
  categoriaServicio: Delegado
  oficioServicio: Delegado
  sinonimoOficio: Delegado & { deleteMany(input: { where: Fila }): Promise<unknown>; createMany(input: { data: Fila[] }): Promise<unknown> }
  localidad: Delegado
  zonaUbicacion: Delegado
  barrio: Delegado
  $transaction<T>(fn: (tx: ClientePrismaCatalogo) => Promise<T>): Promise<T>
}

const ahora = () => new Date()

const MAPEOS = {
  categorias: (fila: Fila): CategoriaCatalogo => ({ id: String(fila['id']), nombre: String(fila['nombre']), slug: String(fila['slug']), descripcion: (fila['descripcion'] as string | null) ?? null, activo: Boolean(fila['activo']), orden: Number(fila['orden']) }),
  oficios: (fila: Fila): OficioCatalogo => ({
    id: String(fila['id']),
    categoriaId: (fila['categoriaId'] as string | null) ?? null,
    nombre: String(fila['nombre']),
    profesion: String(fila['profesion']),
    slug: String(fila['slug']),
    descripcion: (fila['descripcion'] as string | null) ?? null,
    icono: String(fila['icono']),
    activo: Boolean(fila['activo']),
    orden: Number(fila['orden']),
    sinonimos: ((fila['sinonimos'] as Fila[] | undefined) ?? []).filter((item) => item['activo'] !== false).map((item) => String(item['termino'])),
  }),
  localidades: (fila: Fila): LocalidadCatalogo => ({ id: String(fila['id']), nombre: String(fila['nombre']), provincia: String(fila['provincia']), activo: Boolean(fila['activo']), orden: Number(fila['orden']) }),
  zonas: (fila: Fila): ZonaCatalogo => ({
    id: String(fila['id']),
    localidadId: String(fila['localidadId']),
    nombre: String(fila['nombre']),
    slug: String(fila['slug']),
    activo: Boolean(fila['activo']),
    orden: Number(fila['orden']),
    poligono: fila['poligono'] ? validarPoligono(fila['poligono']) : null,
    lat: typeof fila['latitud'] === 'number' ? fila['latitud'] : null,
    lng: typeof fila['longitud'] === 'number' ? fila['longitud'] : null,
  }),
  barrios: (fila: Fila): BarrioCatalogo => ({
    id: String(fila['id']),
    localidadId: String(fila['localidadId']),
    zonaId: (fila['zonaId'] as string | null) ?? null,
    nombre: String(fila['nombre']),
    slug: String(fila['slug']),
    lat: typeof fila['latitud'] === 'number' ? fila['latitud'] : null,
    lng: typeof fila['longitud'] === 'number' ? fila['longitud'] : null,
    // Optional since 20261016100000 (CHECK in SQL); validated again on every write.
    poligono: fila['poligono'] ? validarPoligono(fila['poligono']) : null,
    activo: Boolean(fila['activo']),
    orden: Number(fila['orden']),
  }),
}

export class AlmacenCatalogoPrisma implements AlmacenCatalogo {
  constructor(private readonly client: ClientePrismaCatalogo) {}

  async cargar(): Promise<CatalogoTus> {
    const [categorias, oficios, localidades, zonas, barrios] = await Promise.all([
      this.client.categoriaServicio.findMany({}),
      this.client.oficioServicio.findMany({ include: { sinonimos: true } }),
      this.client.localidad.findMany({}),
      this.client.zonaUbicacion.findMany({}),
      this.client.barrio.findMany({}),
    ])
    return {
      categorias: categorias.map(MAPEOS.categorias),
      oficios: oficios.map(MAPEOS.oficios),
      localidades: localidades.map(MAPEOS.localidades),
      zonas: zonas.map(MAPEOS.zonas),
      barrios: barrios.map(MAPEOS.barrios),
    }
  }

  // WHERE + ORDER BY + OFFSET/LIMIT in PostgreSQL: only the requested page leaves the database.
  async pagina<E extends EntidadListable>(entidad: E, filtro: FiltroCatalogo): Promise<{ items: ItemDe<E>[]; total: number }> {
    const q = filtro.q.trim()
    const busqueda: Fila[] = q
      ? [
          { nombre: { contains: q, mode: 'insensitive' } },
          // slug and synonyms are stored without accents: "plomeria" finds "Plomería" (localities
          // have no slug column).
          ...(entidad !== 'localidades' && slugificar(q) ? [{ slug: { contains: slugificar(q) } }] : []),
          ...(entidad === 'oficios' ? [{ sinonimos: { some: { termino: { contains: clave(q) } } } }] : []),
        ]
      : []
    const where: Fila = { AND: [
      ...(busqueda.length ? [{ OR: busqueda }] : []),
      ...(filtro.activo === null ? [] : [{ activo: filtro.activo }]),
      ...(filtro.categoriaId && entidad === 'oficios' ? [{ categoriaId: filtro.categoriaId }] : []),
      ...(filtro.localidadId && (entidad === 'zonas' || entidad === 'barrios') ? [{ localidadId: filtro.localidadId }] : []),
      ...(filtro.zonaId && entidad === 'barrios' ? [{ zonaId: filtro.zonaId }] : []),
    ] }
    const delegado = this.delegado(entidad)
    const [filas, total] = await Promise.all([
      delegado.findMany({
        where,
        ...(entidad === 'oficios' ? { include: { sinonimos: true } } : {}),
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
        skip: (filtro.pagina - 1) * filtro.tamano,
        take: filtro.tamano,
      }),
      delegado.count({ where }),
    ])
    return { items: filas.map(MAPEOS[entidad] as (fila: Fila) => ItemDe<E>), total }
  }

  private delegado(entidad: EntidadListable): Delegado {
    return { categorias: this.client.categoriaServicio, oficios: this.client.oficioServicio, localidades: this.client.localidad, zonas: this.client.zonaUbicacion, barrios: this.client.barrio }[entidad]
  }

  async guardarCategoria(item: CategoriaCatalogo) {
    const datos = { nombre: item.nombre, slug: item.slug, descripcion: item.descripcion, activo: item.activo, orden: item.orden, actualizadoEn: ahora() }
    await this.client.categoriaServicio.upsert({ where: { id: item.id }, create: { id: item.id, ...datos, creadoEn: ahora() }, update: datos })
  }

  // The trade and its synonyms change together (one transaction).
  async guardarOficio(item: OficioCatalogo) {
    await this.client.$transaction(async (tx) => {
      const datos = { categoriaId: item.categoriaId, nombre: item.nombre, profesion: item.profesion, slug: item.slug, descripcion: item.descripcion, icono: item.icono, activo: item.activo, orden: item.orden, actualizadoEn: ahora() }
      await tx.oficioServicio.upsert({ where: { id: item.id }, create: { id: item.id, ...datos, creadoEn: ahora() }, update: datos })
      await tx.sinonimoOficio.deleteMany({ where: { oficioId: item.id } })
      if (item.sinonimos.length > 0)
        await tx.sinonimoOficio.createMany({ data: item.sinonimos.map((termino) => ({ id: `${item.id}:${termino}`, oficioId: item.id, termino, activo: true })) })
    })
  }

  async guardarLocalidad(item: LocalidadCatalogo) {
    const datos = { nombre: item.nombre, provincia: item.provincia, activo: item.activo, orden: item.orden, actualizadoEn: ahora() }
    await this.client.localidad.upsert({ where: { id: item.id }, create: { id: item.id, ...datos, creadoEn: ahora() }, update: datos })
  }

  async guardarZona(item: ZonaCatalogo) {
    const datos = { localidadId: item.localidadId, nombre: item.nombre, slug: item.slug, poligono: item.poligono ?? Prisma.DbNull, latitud: item.lat, longitud: item.lng, activo: item.activo, orden: item.orden, actualizadoEn: ahora() }
    await this.client.zonaUbicacion.upsert({ where: { id: item.id }, create: { id: item.id, ...datos, creadoEn: ahora() }, update: datos })
  }

  async guardarBarrio(item: BarrioCatalogo) {
    const datos = { localidadId: item.localidadId, zonaId: item.zonaId, nombre: item.nombre, slug: item.slug, latitud: item.lat, longitud: item.lng, poligono: item.poligono ?? Prisma.DbNull, activo: item.activo, orden: item.orden, actualizadoEn: ahora() }
    await this.client.barrio.upsert({ where: { id: item.id }, create: { id: item.id, ...datos, creadoEn: ahora() }, update: datos })
  }
}
