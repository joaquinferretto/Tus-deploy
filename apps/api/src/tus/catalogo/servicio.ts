import { randomUUID } from 'node:crypto'

import { sinAcentos } from '../texto.ts'
import type { AlmacenCatalogo, EntidadListable, FiltroCatalogo } from './almacen.ts'
import { ICONOS_OFICIO, slugificar, validarPoligono, type BarrioCatalogo, type CatalogoTus, type CategoriaCatalogo, type LocalidadCatalogo, type OficioCatalogo, type ZonaCatalogo } from './modelo.ts'
import { establecerCatalogo } from './vigente.ts'

// Administration of the catalog (ABM). Validates, keeps names unique (case/accents-insensitive),
// never deletes (activo = false), audits every change and refreshes the current snapshot so the
// interpreter, forms and map use the change at once.

export type ResultadoCatalogo<T> = { ok: true; valor: T } | { ok: false; code: string; campos?: string[] }

export interface EventoCatalogo {
  accion: string
  entidad: 'categoria' | 'oficio' | 'localidad' | 'zona' | 'barrio'
  id: string
  nombre: string
  actorId: string
}

export interface DependenciasCatalogo {
  almacen: AlmacenCatalogo
  auditar?: (evento: EventoCatalogo) => Promise<void>
  // Profiles + requests that use a neighbourhood NAME (renaming it would orphan them).
  referenciasBarrio?: (nombre: string) => Promise<number>
  now?: () => number
}

const clave = (value: string) => sinAcentos(value.toLowerCase()).replace(/\s+/gu, ' ').trim()
const texto = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, max + 1) : '')
const orden = (value: unknown) => (value === undefined || value === null || value === '' ? 0 : Number(value))
const booleano = (value: unknown, defecto: boolean) => (value === undefined ? defecto : value)

export class ServicioCatalogo {
  constructor(private readonly deps: DependenciasCatalogo) {}

  async leer(): Promise<CatalogoTus> {
    return this.deps.almacen.cargar()
  }

  // Admin lists: the page is cut by the store (never the whole table sliced here).
  async pagina<E extends EntidadListable>(entidad: E, filtro: FiltroCatalogo) {
    return this.deps.almacen.pagina(entidad, filtro)
  }

  private async aplicar(evento: Omit<EventoCatalogo, 'actorId'>, actorId: string) {
    establecerCatalogo(await this.deps.almacen.cargar())
    await this.deps.auditar?.({ ...evento, actorId }).catch(() => undefined)
  }

  // ---- categories --------------------------------------------------------------------------

  async guardarCategoria(actorId: string, id: string | null, body: Record<string, unknown>): Promise<ResultadoCatalogo<CategoriaCatalogo>> {
    const catalogo = await this.leer()
    const actual = id ? catalogo.categorias.find((item) => item.id === id) : undefined
    if (id && !actual) return { ok: false, code: 'NOT_FOUND' }
    const nombre = body['nombre'] === undefined && actual ? actual.nombre : texto(body['nombre'], 60)
    const descripcion = body['descripcion'] === undefined ? (actual?.descripcion ?? null) : texto(body['descripcion'], 200) || null
    const campos: string[] = []
    if (nombre.length < 2 || nombre.length > 60) campos.push('nombre')
    if ((descripcion?.length ?? 0) > 200) campos.push('descripcion')
    const valorOrden = body['orden'] === undefined && actual ? actual.orden : orden(body['orden'])
    if (!Number.isInteger(valorOrden) || valorOrden < 0 || valorOrden > 999) campos.push('orden')
    const activo = booleano(body['activo'], actual?.activo ?? true)
    if (typeof activo !== 'boolean') campos.push('activo')
    if (campos.length) return { ok: false, code: 'INVALID', campos }
    if (catalogo.categorias.some((item) => item.id !== actual?.id && clave(item.nombre) === clave(nombre))) return { ok: false, code: 'DUPLICATE', campos: ['nombre'] }
    const slug = actual?.slug ?? slugificar(nombre)
    if (!slug || (!actual && catalogo.categorias.some((item) => item.slug === slug || item.id === slug))) return { ok: false, code: 'DUPLICATE', campos: ['nombre'] }
    const valor: CategoriaCatalogo = { id: actual?.id ?? slug, nombre, slug, descripcion, activo: activo as boolean, orden: valorOrden }
    await this.deps.almacen.guardarCategoria(valor)
    await this.aplicar({ accion: actual ? (actual.activo !== valor.activo ? (valor.activo ? 'activada' : 'desactivada') : 'modificada') : 'creada', entidad: 'categoria', id: valor.id, nombre }, actorId)
    return { ok: true, valor }
  }

  // ---- trades + synonyms -----------------------------------------------------------------------

  async guardarOficio(actorId: string, id: string | null, body: Record<string, unknown>): Promise<ResultadoCatalogo<OficioCatalogo>> {
    const catalogo = await this.leer()
    const actual = id ? catalogo.oficios.find((item) => item.id === id) : undefined
    if (id && !actual) return { ok: false, code: 'NOT_FOUND' }
    const nombre = body['nombre'] === undefined && actual ? actual.nombre : texto(body['nombre'], 60)
    const profesion = body['profesion'] === undefined ? (actual?.profesion ?? nombre) : texto(body['profesion'], 60) || nombre
    const descripcion = body['descripcion'] === undefined ? (actual?.descripcion ?? null) : texto(body['descripcion'], 200) || null
    const categoriaId = body['categoriaId'] === undefined ? (actual?.categoriaId ?? null) : body['categoriaId'] === null || body['categoriaId'] === '' ? null : String(body['categoriaId'])
    const icono = body['icono'] === undefined ? (actual?.icono ?? 'herramienta') : String(body['icono'])
    const valorOrden = body['orden'] === undefined && actual ? actual.orden : orden(body['orden'])
    const activo = booleano(body['activo'], actual?.activo ?? true)
    const sinonimosCrudos = body['sinonimos'] === undefined ? (actual?.sinonimos ?? []) : body['sinonimos']
    const campos: string[] = []
    if (nombre.length < 2 || nombre.length > 60) campos.push('nombre')
    if (profesion.length < 2 || profesion.length > 60) campos.push('profesion')
    if ((descripcion?.length ?? 0) > 200) campos.push('descripcion')
    if (categoriaId !== null && !catalogo.categorias.some((item) => item.id === categoriaId)) campos.push('categoriaId')
    if (!(ICONOS_OFICIO as readonly string[]).includes(icono)) campos.push('icono')
    if (!Number.isInteger(valorOrden) || valorOrden < 0 || valorOrden > 999) campos.push('orden')
    if (typeof activo !== 'boolean') campos.push('activo')
    // Synonyms are stored normalized (lower case, no accents): the interpreter compares that way.
    const sinonimos = Array.isArray(sinonimosCrudos) ? [...new Set(sinonimosCrudos.map((item) => clave(String(item ?? ''))).filter(Boolean))] : null
    if (!sinonimos || sinonimos.length > 80 || sinonimos.some((item) => item.length < 2 || item.length > 40)) campos.push('sinonimos')
    if (campos.length) return { ok: false, code: 'INVALID', campos }
    if (catalogo.oficios.some((item) => item.id !== actual?.id && clave(item.nombre) === clave(nombre))) return { ok: false, code: 'DUPLICATE', campos: ['nombre'] }
    const slug = actual?.slug ?? slugificar(nombre)
    if (!slug || (!actual && catalogo.oficios.some((item) => item.slug === slug || item.id === slug))) return { ok: false, code: 'DUPLICATE', campos: ['nombre'] }
    const valor: OficioCatalogo = { id: actual?.id ?? slug, categoriaId, nombre, profesion, slug, descripcion, icono, activo: activo as boolean, orden: valorOrden, sinonimos: sinonimos! }
    await this.deps.almacen.guardarOficio(valor)
    const accion = !actual ? 'creado' : actual.activo !== valor.activo ? (valor.activo ? 'activado' : 'desactivado') : actual.sinonimos.join('|') !== valor.sinonimos.join('|') ? 'sinonimos_modificados' : 'modificado'
    await this.aplicar({ accion, entidad: 'oficio', id: valor.id, nombre }, actorId)
    return { ok: true, valor }
  }

  // ---- localities, zones, neighbourhoods -------------------------------------------------------

  async guardarLocalidad(actorId: string, id: string | null, body: Record<string, unknown>): Promise<ResultadoCatalogo<LocalidadCatalogo>> {
    const catalogo = await this.leer()
    const actual = id ? catalogo.localidades.find((item) => item.id === id) : undefined
    if (id && !actual) return { ok: false, code: 'NOT_FOUND' }
    const nombre = body['nombre'] === undefined && actual ? actual.nombre : texto(body['nombre'], 60)
    const provincia = body['provincia'] === undefined && actual ? actual.provincia : texto(body['provincia'], 60)
    const valorOrden = body['orden'] === undefined && actual ? actual.orden : orden(body['orden'])
    const activo = booleano(body['activo'], actual?.activo ?? true)
    const campos: string[] = []
    if (nombre.length < 2 || nombre.length > 60) campos.push('nombre')
    if (provincia.length < 2 || provincia.length > 60) campos.push('provincia')
    if (!Number.isInteger(valorOrden) || valorOrden < 0 || valorOrden > 999) campos.push('orden')
    if (typeof activo !== 'boolean') campos.push('activo')
    if (campos.length) return { ok: false, code: 'INVALID', campos }
    if (catalogo.localidades.some((item) => item.id !== actual?.id && clave(item.nombre) === clave(nombre) && clave(item.provincia) === clave(provincia))) return { ok: false, code: 'DUPLICATE', campos: ['nombre'] }
    const valor: LocalidadCatalogo = { id: actual?.id ?? `${slugificar(nombre)}-${randomUUID().slice(0, 6)}`, nombre, provincia, activo: activo as boolean, orden: valorOrden }
    await this.deps.almacen.guardarLocalidad(valor)
    await this.aplicar({ accion: !actual ? 'creada' : actual.activo !== valor.activo ? (valor.activo ? 'activada' : 'desactivada') : 'modificada', entidad: 'localidad', id: valor.id, nombre }, actorId)
    return { ok: true, valor }
  }

  async guardarZona(actorId: string, id: string | null, body: Record<string, unknown>): Promise<ResultadoCatalogo<ZonaCatalogo>> {
    const catalogo = await this.leer()
    const actual = id ? catalogo.zonas.find((item) => item.id === id) : undefined
    if (id && !actual) return { ok: false, code: 'NOT_FOUND' }
    const nombre = body['nombre'] === undefined && actual ? actual.nombre : texto(body['nombre'], 60)
    const localidadId = body['localidadId'] === undefined && actual ? actual.localidadId : String(body['localidadId'] ?? '')
    const valorOrden = body['orden'] === undefined && actual ? actual.orden : orden(body['orden'])
    const activo = booleano(body['activo'], actual?.activo ?? true)
    const campos: string[] = []
    if (nombre.length < 2 || nombre.length > 60) campos.push('nombre')
    if (!catalogo.localidades.some((item) => item.id === localidadId)) campos.push('localidadId')
    if (!Number.isInteger(valorOrden) || valorOrden < 0 || valorOrden > 999) campos.push('orden')
    if (typeof activo !== 'boolean') campos.push('activo')
    // Moving a zone to another locality would leave its neighbourhoods in a different one.
    if (actual && localidadId !== actual.localidadId && catalogo.barrios.some((barrio) => barrio.zonaId === actual.id)) campos.push('localidadId')
    if (campos.length) return { ok: false, code: 'INVALID', campos }
    if (catalogo.zonas.some((item) => item.id !== actual?.id && item.localidadId === localidadId && clave(item.nombre) === clave(nombre))) return { ok: false, code: 'DUPLICATE', campos: ['nombre'] }
    const valor: ZonaCatalogo = { id: actual?.id ?? `zona-${slugificar(nombre)}-${randomUUID().slice(0, 6)}`, localidadId, nombre, slug: slugificar(nombre), activo: activo as boolean, orden: valorOrden }
    await this.deps.almacen.guardarZona(valor)
    await this.aplicar({ accion: !actual ? 'creada' : actual.activo !== valor.activo ? (valor.activo ? 'activada' : 'desactivada') : 'modificada', entidad: 'zona', id: valor.id, nombre }, actorId)
    return { ok: true, valor }
  }

  async guardarBarrio(actorId: string, id: string | null, body: Record<string, unknown>): Promise<ResultadoCatalogo<BarrioCatalogo>> {
    const catalogo = await this.leer()
    const actual = id ? catalogo.barrios.find((item) => item.id === id) : undefined
    if (id && !actual) return { ok: false, code: 'NOT_FOUND' }
    const nombre = body['nombre'] === undefined && actual ? actual.nombre : texto(body['nombre'], 60)
    const localidadId = body['localidadId'] === undefined && actual ? actual.localidadId : String(body['localidadId'] ?? '')
    const zonaId = body['zonaId'] === undefined ? (actual?.zonaId ?? null) : body['zonaId'] === null || body['zonaId'] === '' ? null : String(body['zonaId'])
    const lat = body['lat'] === undefined ? (actual?.lat ?? null) : body['lat'] === null ? null : Number(body['lat'])
    const lng = body['lng'] === undefined ? (actual?.lng ?? null) : body['lng'] === null ? null : Number(body['lng'])
    const poligono = body['poligono'] === undefined && actual ? actual.poligono : validarPoligono(body['poligono'])
    const valorOrden = body['orden'] === undefined && actual ? actual.orden : orden(body['orden'])
    const activo = booleano(body['activo'], actual?.activo ?? true)
    const campos: string[] = []
    if (nombre.length < 2 || nombre.length > 60) campos.push('nombre')
    if (!catalogo.localidades.some((item) => item.id === localidadId)) campos.push('localidadId')
    const zona = zonaId ? catalogo.zonas.find((item) => item.id === zonaId) : null
    if (zonaId && (!zona || zona.localidadId !== localidadId)) campos.push('zonaId')
    // A neighbourhood needs its approximate point to be placed on the map.
    if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) campos.push('ubicacion')
    if (!poligono) campos.push('poligono')
    if (!Number.isInteger(valorOrden) || valorOrden < 0 || valorOrden > 999) campos.push('orden')
    if (typeof activo !== 'boolean') campos.push('activo')
    if (campos.length) return { ok: false, code: 'INVALID', campos }
    if (catalogo.barrios.some((item) => item.id !== actual?.id && item.localidadId === localidadId && clave(item.nombre) === clave(nombre))) return { ok: false, code: 'DUPLICATE', campos: ['nombre'] }
    // Profiles and requests store the neighbourhood name: renaming one in use would orphan them.
    if (actual && clave(actual.nombre) !== clave(nombre) && this.deps.referenciasBarrio && (await this.deps.referenciasBarrio(actual.nombre)) > 0)
      return { ok: false, code: 'IN_USE_RENAME', campos: ['nombre'] }
    const valor: BarrioCatalogo = { id: actual?.id ?? `barrio-${slugificar(nombre)}-${randomUUID().slice(0, 6)}`, localidadId, zonaId, nombre, slug: slugificar(nombre), lat, lng, poligono: poligono!, activo: activo as boolean, orden: valorOrden }
    await this.deps.almacen.guardarBarrio(valor)
    const accion = !actual ? 'creado' : actual.activo !== valor.activo ? (valor.activo ? 'activado' : 'desactivado') : actual.zonaId !== valor.zonaId ? 'movido_de_zona' : 'modificado'
    await this.aplicar({ accion, entidad: 'barrio', id: valor.id, nombre }, actorId)
    return { ok: true, valor }
  }
}
