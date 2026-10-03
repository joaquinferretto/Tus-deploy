import { randomUUID } from 'node:crypto'

import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import {
  GEOGRAFIA_VACIA,
  distanciaEntreZonas,
  interpretarNecesidad,
  proyectarPerfil,
  proyectarPublico,
  resolverUbicacionDePerfil,
  validarPerfil,
  type CampoPerfil,
  type CandidatoPrestador,
  type HechosPrestador,
  type Interpretacion,
  type PerfilPrestadorPublico,
  type PerfilPublico,
  type PrestadorPublico,
} from './modelo.ts'
import { esOficio, normalizarTexto, oficio, type OficioId } from './oficios.ts'
import { asociarPunto, resolverPuntoMapa, type GeocodificadorInverso, type PuntoMapa } from '../geo/resolucion.ts'
import { coordenadasValidas } from '../geo/geometria.ts'
import type { AlmacenPerfiles, FuentesDirectorio } from './puertos.ts'
import { barriosDeUbicacion, catalogoVigente, oficiosVigentes } from '../catalogo/vigente.ts'
import { ErrorFotoPerfil, prepararFotoPerfil, rutaFotoPerfil, type AlmacenFotosPerfil, type CodigoFoto, type FotoPerfil } from './foto.ts'

export interface FilaAdminPrestador {
  id: string; tenantId: string; nombre: string; oficio: string; oficioLabel: string; zona: string | null; zonasCobertura: string[]
  // Every service of the provider (N:M), principal first.
  oficios: { id: string; label: string }[]
  visible: boolean; aprobado: boolean; registrado: boolean; verificado: boolean; ubicaciones: number; enMapa: boolean
  motivos: string[]; creadoEn: string; actualizadoEn: string
  // FASE 10: Mercado Pago link status (never tokens), reputation and completed works.
  mercadoPago: string; rating: { average: number; count: number } | null; trabajosCompletados: number
}

const PERFILES_MAXIMOS = 300
export const TAMANO_PAGINA = 12
export const CANDIDATOS_MAXIMOS = 5

export type OrdenDirectorio = 'relevancia' | 'trabajos' | 'cercania'

export interface FiltrosDirectorio {
  // A service: providers offering it. A category: providers offering ANY of its services.
  oficio?: unknown
  categoria?: unknown
  // Public map: every visible provider that matches (up to PERFILES_MAXIMOS) in one page, so the
  // map can draw and cluster all of them; the list keeps its pages of TAMANO_PAGINA.
  mapa?: unknown
  zona?: unknown
  q?: unknown
  verificados?: unknown
  atiendeHoy?: unknown
  orden?: unknown
  pagina?: unknown
}

export type ResultadoPerfil =
  | { ok: true; perfil: PerfilPrestadorPublico & { visible: boolean } }
  | { ok: false; code: 'INVALID_PROFILE'; fields: CampoPerfil[] }
  | { ok: false; code: 'PROVIDER_REQUIRED'; fields?: undefined }

interface Enriquecido {
  perfil: PerfilPublico
  hechos: HechosPrestador
  ubicacion: ReturnType<typeof resolverUbicacionDePerfil>
  publico: PrestadorPublico
}

// Current services of a category (catalog snapshot, no query).
function idsOficiosDeCategoria(categoriaId: string): OficioId[] {
  return oficiosVigentes().filter((item) => item.categoriaId === categoriaId).map((item) => item.id)
}

// Input of a location change: an exact point (and whether it may be published) or its removal.
export type EntradaUbicacion = { quitar: true } | { lat: unknown; lng: unknown; mostrarExacta?: unknown }

export type ResultadoUbicacion =
  | { ok: true; ubicacion: UbicacionPrestador }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_LOCATION' }

// What the provider / admin sees about the location (never published as such).
export interface UbicacionPrestador {
  lat: number | null
  lng: number | null
  showExact: boolean
  association: PerfilPublico['ubicacionAsociacion']
  barrio: { id: string; name: string } | null
  zone: { id: string; name: string } | null
  // Where the public map places the provider now (null = not on the map, "Sin ubicación").
  mapPoint: PuntoMapa | null
}

// Caso de uso compartido por el directorio Web ("Buscar trabajador"), el asistente Web ("Buscar
// servicios") y las herramientas del asistente de WhatsApp. Solo lee datos reales: si un prestador
// no está aprobado o no tiene perfil visible, no aparece; nunca se completan datos faltantes.
export type ResultadoFoto = { ok: true; photoUrl: string | null } | { ok: false; code: 'NOT_FOUND' | 'UNAVAILABLE' | 'RATE_LIMITED' | CodigoFoto }

// A provider changes its photo rarely: a handful of uploads per hour is plenty.
const SUBIDAS_FOTO_POR_HORA = 10
const VENTANA_SUBIDAS_FOTO_MS = 60 * 60 * 1000
const idPerfilValido = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/u.test(id)

export class ServicioDirectorio {
  private readonly now: () => number
  private readonly newId: () => string
  private readonly subidasDeFoto = new Map<string, number[]>()

  constructor(
    private readonly deps: {
      perfiles: AlmacenPerfiles
      fuentes: FuentesDirectorio
      // Profile photos. Absent: no photo can be uploaded and no profile shows one.
      fotos?: AlmacenFotosPerfil | null
      now?: () => number
      newId?: () => string
      // Reverse geocoder: only to MATCH existing areas when no polygon contains a saved point.
      geocodificador?: GeocodificadorInverso | null
    }
  ) {
    this.now = deps.now ?? Date.now
    this.newId = deps.newId ?? randomUUID
  }

  // ---- perfil del prestador autenticado -------------------------------------------------------

  async miPerfil(context: TusAuthenticatedTenantContext): Promise<(PerfilPrestadorPublico & { visible: boolean }) | null> {
    const perfil = await this.deps.perfiles.porTenant(context.tenantId)
    if (!perfil) return null
    const [hechos, fallback] = await Promise.all([
      this.hechosConCalificacion(context.tenantId),
      this.deps.fuentes.ubicacionIdentidadVerificada?.(context.tenantId) ?? Promise.resolve(null),
    ])
    return { ...proyectarPerfil(perfil, hechos, this.now(), resolverUbicacionDePerfil(perfil, fallback)), visible: perfil.visible }
  }

  async guardarPerfil(context: TusAuthenticatedTenantContext, body: Record<string, unknown>): Promise<ResultadoPerfil> {
    const prestador = await this.deps.fuentes.prestador(context.tenantId)
    if (!prestador) return { ok: false, code: 'PROVIDER_REQUIRED' }
    const validacion = validarPerfil(body)
    if (!validacion.ok) return { ok: false, code: 'INVALID_PROFILE', fields: validacion.campos }
    const actual = await this.deps.perfiles.porTenant(context.tenantId)
    const ahora = this.now()
    const perfil: PerfilPublico = {
      id: actual?.id ?? this.newId(),
      tenantId: context.tenantId,
      prestadorId: prestador.prestadorId,
      // Editing the profile never touches its map location (a separate, explicit operation).
      ...GEOGRAFIA_VACIA,
      ...(actual ? pickGeografia(actual) : {}),
      fotoSha256: actual?.fotoSha256 ?? null,
      ...validacion.valor,
      creadoEn: actual?.creadoEn ?? ahora,
      actualizadoEn: ahora,
    }
    await this.deps.perfiles.guardar(perfil)
    const [hechos, fallback] = await Promise.all([
      this.hechosConCalificacion(context.tenantId),
      this.deps.fuentes.ubicacionIdentidadVerificada?.(context.tenantId) ?? Promise.resolve(null),
    ])
    return { ok: true, perfil: { ...proyectarPerfil(perfil, hechos, ahora, resolverUbicacionDePerfil(perfil, fallback)), visible: perfil.visible } }
  }

  // ---- foto de perfil ---------------------------------------------------------------------------

  // The provider's own photo: the profile ALWAYS comes from the session's tenant. The bytes are
  // untrusted (see foto.ts); a new photo replaces the previous one.
  async guardarMiFoto(tenantId: string, bytes: unknown): Promise<ResultadoFoto> {
    const fotos = this.deps.fotos
    if (!fotos) return { ok: false, code: 'UNAVAILABLE' }
    const perfil = await this.deps.perfiles.porTenant(tenantId)
    if (!perfil) return { ok: false, code: 'NOT_FOUND' }
    const ahora = this.now()
    const recientes = (this.subidasDeFoto.get(tenantId) ?? []).filter((momento) => ahora - momento < VENTANA_SUBIDAS_FOTO_MS)
    if (recientes.length >= SUBIDAS_FOTO_POR_HORA) return { ok: false, code: 'RATE_LIMITED' }
    let foto: ReturnType<typeof prepararFotoPerfil>
    try {
      foto = prepararFotoPerfil(bytes)
    } catch (error) {
      return { ok: false, code: error instanceof ErrorFotoPerfil ? error.code : 'PHOTO_CORRUPT' }
    }
    this.subidasDeFoto.set(tenantId, [...recientes, ahora])
    await fotos.guardar({ ...foto, perfilId: perfil.id, actualizadaEn: ahora })
    return { ok: true, photoUrl: rutaFotoPerfil(perfil.id, foto.sha256) }
  }

  async quitarMiFoto(tenantId: string): Promise<ResultadoFoto> {
    const perfil = await this.deps.perfiles.porTenant(tenantId)
    return perfil ? this.quitarFoto(perfil.id) : { ok: false, code: 'NOT_FOUND' }
  }

  // Platform administration (moderation): removes the photo of any profile by its public id.
  async quitarFotoDePerfil(id: unknown): Promise<ResultadoFoto> {
    const perfil = idPerfilValido(id) ? await this.deps.perfiles.porId(id) : null
    return perfil ? this.quitarFoto(perfil.id) : { ok: false, code: 'NOT_FOUND' }
  }

  private async quitarFoto(perfilId: string): Promise<ResultadoFoto> {
    if (!this.deps.fotos) return { ok: false, code: 'UNAVAILABLE' }
    await this.deps.fotos.quitar(perfilId)
    return { ok: true, photoUrl: null }
  }

  // The photo anyone may see: only of a VISIBLE profile and only the one the profile points to.
  async fotoPublica(id: unknown): Promise<FotoPerfil | null> {
    if (!this.deps.fotos || !idPerfilValido(id)) return null
    const perfil = await this.deps.perfiles.porId(id)
    if (!perfil || !perfil.visible || !perfil.fotoSha256) return null
    const foto = await this.deps.fotos.obtener(perfil.id)
    return foto && foto.sha256 === perfil.fotoSha256 ? foto : null
  }

  // ---- ubicación en el mapa (el prestador desde su sesión, el admin por id) --------------------

  // The provider's own location: the tenant ALWAYS comes from the session, never from the body.
  async miUbicacion(tenantId: string): Promise<UbicacionPrestador | null> {
    const perfil = await this.deps.perfiles.porTenant(tenantId)
    return perfil ? vistaUbicacion(perfil) : null
  }

  async guardarMiUbicacion(tenantId: string, entrada: EntradaUbicacion): Promise<ResultadoUbicacion> {
    const perfil = await this.deps.perfiles.porTenant(tenantId)
    return perfil ? this.aplicarUbicacion(perfil, entrada) : { ok: false, code: 'NOT_FOUND' }
  }

  // Platform administration (authorized by the admin gate): any profile by its public id.
  async ubicacionDePerfil(perfilId: string): Promise<UbicacionPrestador | null> {
    const perfil = await this.deps.perfiles.porId(perfilId)
    return perfil ? vistaUbicacion(perfil) : null
  }

  async guardarUbicacionDePerfil(perfilId: string, entrada: EntradaUbicacion): Promise<ResultadoUbicacion> {
    const perfil = await this.deps.perfiles.porId(perfilId)
    return perfil ? this.aplicarUbicacion(perfil, entrada) : { ok: false, code: 'NOT_FOUND' }
  }

  private async aplicarUbicacion(perfil: PerfilPublico, entrada: EntradaUbicacion): Promise<ResultadoUbicacion> {
    if ('quitar' in entrada && entrada.quitar === true) {
      // Removing the pin keeps the area the provider belongs to (it is not an address).
      const siguiente: PerfilPublico = { ...perfil, latitud: null, longitud: null, mostrarUbicacionExacta: false, actualizadoEn: this.now() }
      await this.deps.perfiles.guardar(siguiente)
      return { ok: true, ubicacion: vistaUbicacion(siguiente) }
    }
    const { lat, lng } = entrada as { lat: unknown; lng: unknown; mostrarExacta?: unknown }
    const mostrar = (entrada as { mostrarExacta?: unknown }).mostrarExacta
    if (!coordenadasValidas(lat, lng) || (mostrar !== undefined && typeof mostrar !== 'boolean')) return { ok: false, code: 'INVALID_LOCATION' }
    const punto = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round((lng as number) * 1e6) / 1e6 }
    // Stored polygons first; the geocoder only matches existing names (never creates areas).
    const asociacion = await asociarPunto(catalogoVigente(), punto.lat, punto.lng, this.deps.geocodificador ?? null)
    const barrio = asociacion.barrio
    const siguiente: PerfilPublico = {
      ...perfil,
      latitud: punto.lat,
      longitud: punto.lng,
      mostrarUbicacionExacta: typeof mostrar === 'boolean' ? mostrar : perfil.mostrarUbicacionExacta,
      barrioId: barrio?.id ?? null,
      zonaId: asociacion.zona?.id ?? null,
      ubicacionAsociacion: asociacion.origen,
      // A profile without a named zone adopts the neighbourhood that contains its point.
      zona: perfil.zona ?? barrio?.nombre ?? null,
      zonasCobertura: perfil.zonasCobertura.length || !barrio ? perfil.zonasCobertura : [barrio.nombre],
      actualizadoEn: this.now(),
    }
    await this.deps.perfiles.guardar(siguiente)
    return { ok: true, ubicacion: vistaUbicacion(siguiente) }
  }

  // ---- lectura pública ------------------------------------------------------------------------

  async listar(filtros: FiltrosDirectorio = {}): Promise<{ items: PrestadorPublico[]; total: number; page: number; hasMore: boolean }> {
    const oficioFiltro = esOficio(filtros.oficio) ? filtros.oficio : undefined
    const categoriaFiltro = typeof filtros.categoria === 'string' && filtros.categoria.trim() ? filtros.categoria.trim() : null
    const deCategoria = categoriaFiltro ? idsOficiosDeCategoria(categoriaFiltro) : null
    const zona = typeof filtros.zona === 'string' && filtros.zona.trim() ? filtros.zona.trim() : null
    const q = typeof filtros.q === 'string' ? normalizarTexto(filtros.q.slice(0, 80)) : ''
    const orden: OrdenDirectorio = filtros.orden === 'trabajos' || filtros.orden === 'cercania' ? filtros.orden : 'relevancia'
    const mapa = filtros.mapa === true || filtros.mapa === 'true' || filtros.mapa === '1'
    const tamano = mapa ? PERFILES_MAXIMOS : TAMANO_PAGINA
    const pagina = mapa ? 1 : Math.max(1, Math.min(50, Number.parseInt(String(filtros.pagina ?? '1'), 10) || 1))
    // Si el texto nombra un oficio ("electricista"), se usa como filtro de oficio.
    const oficioTexto = !oficioFiltro && q ? interpretarNecesidad(q).category : null

    // An unknown category yields no provider (never "all of them").
    if (deCategoria && deCategoria.length === 0) return { items: [], total: 0, page: pagina, hasMore: false }
    let items = await this.enriquecerVisibles(oficioFiltro ? [oficioFiltro] : oficioTexto ? [oficioTexto] : undefined)
    if (deCategoria) items = items.filter(({ perfil }) => perfil.oficios.some((id) => deCategoria.includes(id)))
    if (q) {
      const terminos = q.split(' ').filter((termino) => termino.length >= 3)
      items = items.filter(({ perfil, hechos, ubicacion }) => {
        if (oficioTexto && perfil.oficios.includes(oficioTexto)) return true
        const servicios = perfil.oficios.map((id) => oficio(id)).map((info) => `${info.label} ${info.profesion} ${info.palabrasClave}`).join(' ')
        const texto = normalizarTexto(`${perfil.nombrePublico} ${servicios} ${perfil.descripcion ?? ''} ${ubicacion.serviceZones.join(' ')} ${ubicacion.publicArea} ${hechos.servicios.map((servicio) => servicio.nombre).join(' ')}`)
        return terminos.every((termino) => texto.includes(termino))
      })
    }
    // A zone of the catalog ("Norte") covers its neighbourhoods; a neighbourhood covers itself.
    if (zona) {
      const lugares = barriosDeUbicacion(zona).map((item) => normalizarTexto(item))
      items = items.filter(({ ubicacion }) => ubicacion.serviceZones.some((item) => lugares.includes(normalizarTexto(item))) || lugares.includes(normalizarTexto(ubicacion.publicArea)))
    }
    if (filtros.verificados === true || filtros.verificados === 'true' || filtros.verificados === '1') items = items.filter((item) => item.publico.verified)
    if (filtros.atiendeHoy === true || filtros.atiendeHoy === 'true' || filtros.atiendeHoy === '1') items = items.filter((item) => item.publico.availability.status === 'atiende_hoy')

    const ordenados = this.ordenar(items, orden, zona)
    const inicio = (pagina - 1) * tamano
    return {
      items: ordenados.slice(inicio, inicio + tamano).map((item) => item.publico),
      total: ordenados.length,
      page: pagina,
      hasMore: inicio + tamano < ordenados.length,
    }
  }

  async perfil(id: unknown): Promise<PerfilPrestadorPublico | null> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/u.test(id)) return null
    const perfil = await this.deps.perfiles.porId(id)
    if (!perfil || !perfil.visible) return null
    const [hechos, fallback] = await Promise.all([
      this.hechosConCalificacion(perfil.tenantId),
      this.deps.fuentes.ubicacionIdentidadVerificada?.(perfil.tenantId) ?? Promise.resolve(null),
    ])
    if (!hechos.aprobado) return null
    return proyectarPerfil(perfil, hechos, this.now(), resolverUbicacionDePerfil(perfil, fallback))
  }

  // Destino interno de una solicitud dirigida: solo prestadores visibles y aprobados.
  async destino(id: unknown): Promise<{ perfil: PerfilPublico } | null> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/u.test(id)) return null
    const perfil = await this.deps.perfiles.porId(id)
    if (!perfil || !perfil.visible) return null
    const prestador = await this.deps.fuentes.prestador(perfil.tenantId)
    if (!prestador?.aprobado || prestador.prestadorId !== perfil.prestadorId) return null
    return { perfil }
  }

  async perfilPorTenant(tenantId: string): Promise<PerfilPublico | null> {
    return this.deps.perfiles.porTenant(tenantId)
  }

  async perfilesPorTenants(tenantIds: readonly string[]): Promise<Map<string, { id: string; nombrePublico: string }>> {
    return new Map((await this.deps.perfiles.porTenants(tenantIds)).map((p) => [p.tenantId, { id: p.id, nombrePublico: p.nombrePublico }]))
  }

  // Quién puede postularse a una solicitud pública: mismo criterio que el directorio (perfil
  // visible y prestador aprobado), sin filtrar por oficio.
  async postulante(tenantId: string): Promise<{ perfil: PerfilPublico } | null> {
    const perfil = await this.deps.perfiles.porTenant(tenantId)
    if (!perfil || !perfil.visible) return null
    const prestador = await this.deps.fuentes.prestador(tenantId)
    if (!prestador?.aprobado || prestador.prestadorId !== perfil.prestadorId) return null
    return { perfil }
  }

  async perfilPublicoDe(tenantId: string): Promise<{ id: string; nombrePublico: string; oficio: string; zona: string } | null> {
    const perfil = await this.deps.perfiles.porTenant(tenantId)
    return perfil ? { id: perfil.id, nombrePublico: perfil.nombrePublico, oficio: perfil.oficio, zona: perfil.zona ?? perfil.zonasCobertura[0] ?? '' } : null
  }

  // ---- asistente ------------------------------------------------------------------------------

  interpretar(texto: unknown): Interpretacion {
    return interpretarNecesidad(typeof texto === 'string' ? texto : '')
  }

  // Candidatos compatibles (3 a 5 cuando existen). El cliente elige; nunca se elige por él.
  async buscarCandidatos(input: { oficio: unknown; zona?: unknown; limite?: number; exigirCobertura?: boolean }): Promise<{ items: CandidatoPrestador[]; reason: 'ok' | 'no_providers' | 'invalid_profession' }> {
    if (!esOficio(input.oficio)) return { items: [], reason: 'invalid_profession' }
    const zona = typeof input.zona === 'string' && input.zona.trim() ? input.zona.trim() : null
    const limite = Math.max(1, Math.min(CANDIDATOS_MAXIMOS, input.limite ?? CANDIDATOS_MAXIMOS))
    const normalizarZona = (value: string) => normalizarTexto(value).replace(/^barrio\s+/u, '')
    const visibles = await this.enriquecerVisibles([input.oficio as OficioId])
    const compatibles = input.exigirCobertura && zona
      ? visibles.filter(item => item.ubicacion.serviceZones.some(value => barriosDeUbicacion(zona).some((lugar) => normalizarZona(value) === normalizarZona(lugar))))
      : visibles
    const items = this.ordenar(compatibles, 'relevancia', zona).slice(0, limite)
    return {
      items: items.map((item) => ({ ...item.publico, distanceKm: zona ? distanciaEntreZonas(zona, item.ubicacion.primaryZone) : null })),
      reason: items.length > 0 ? 'ok' : 'no_providers',
    }
  }

  // ---- internos -------------------------------------------------------------------------------

  private async hechosConCalificacion(tenantId: string): Promise<HechosPrestador> {
    const [hechos, calificaciones] = await Promise.all([
      this.deps.fuentes.hechos(tenantId),
      this.deps.fuentes.calificaciones?.([tenantId]) ?? Promise.resolve(new Map<string, { average: number; count: number }>()),
    ])
    return { ...hechos, calificacion: calificaciones.get(tenantId) ?? null }
  }

  private async enriquecerVisibles(oficiosFiltro?: readonly OficioId[]): Promise<Enriquecido[]> {
    const perfiles = await this.deps.perfiles.visibles({ ...(oficiosFiltro?.length ? { oficios: oficiosFiltro } : {}), limite: PERFILES_MAXIMOS })
    const now = this.now()
    // Ratings of the whole page in ONE grouped read.
    const tenantIds = perfiles.map((perfil) => perfil.tenantId)
    const [calificacionesLeidas, lote] = await Promise.all([
      this.deps.fuentes.calificaciones?.(tenantIds),
      this.deps.fuentes.hechosLote?.(tenantIds),
    ])
    const calificaciones: Map<string, { average: number; count: number }> = calificacionesLeidas ?? new Map()
    if (lote) {
      // Fixed number of reads for the whole map (no per-provider query).
      return perfiles.flatMap((perfil) => {
        const item = lote.get(perfil.tenantId)
        if (!item?.hechos.aprobado) return []
        const hechos: HechosPrestador = { ...item.hechos, calificacion: calificaciones.get(perfil.tenantId) ?? null }
        const ubicacion = resolverUbicacionDePerfil(perfil, item.ubicacionVerificada)
        return [{ perfil, hechos, ubicacion, publico: proyectarPublico(perfil, hechos, now, ubicacion) }]
      })
    }
    const enriquecidos = await Promise.all(
      perfiles.map(async (perfil) => {
        const [hechos, fallback] = await Promise.all([
          this.deps.fuentes.hechos(perfil.tenantId).then((item): HechosPrestador => ({ ...item, calificacion: calificaciones.get(perfil.tenantId) ?? null })),
          this.deps.fuentes.ubicacionIdentidadVerificada?.(perfil.tenantId) ?? Promise.resolve(null),
        ])
        const ubicacion = resolverUbicacionDePerfil(perfil, fallback)
        return hechos.aprobado ? { perfil, hechos, ubicacion, publico: proyectarPublico(perfil, hechos, now, ubicacion) } : null
      })
    )
    return enriquecidos.filter((item): item is Enriquecido => item !== null)
  }

  // Administración de la plataforma: perfiles (visibles u ocultos) con el MOTIVO real por el que
  // aparecen o no en el mapa. Mismas reglas que el directorio público. Una lectura de perfiles +
  // una lectura por lote de cada fuente (prestadores, identidad): nunca una consulta por perfil.
  private async filasAdmin(perfiles: PerfilPublico[]): Promise<FilaAdminPrestador[]> {
    const now = this.now()
    const tenantIds = perfiles.map((perfil) => perfil.tenantId)
    const [resumenes, calificaciones, operacion] = await Promise.all([
      this.deps.fuentes.resumenAdmin(tenantIds),
      this.deps.fuentes.calificaciones?.(tenantIds) ?? Promise.resolve(new Map<string, { average: number; count: number }>()),
      this.deps.fuentes.operacionAdmin?.(tenantIds) ?? Promise.resolve(new Map<string, { mercadoPago: string; completados: number }>()),
    ])
    return perfiles.map((perfil) => {
      const resumen = resumenes.get(perfil.tenantId) ?? { prestador: null, verificado: false, ubicacionVerificada: null }
      const prestador = resumen.prestador
      // La fila de administración muestra oficio, presencia en el mapa y estados: precios, horarios
      // y trabajos completados son del perfil público y no se leen acá.
      const hechos: HechosPrestador = { aprobado: prestador?.aprobado ?? false, verificado: resumen.verificado, trabajosCompletados: 0, servicios: [] }
      const publico = proyectarPublico(perfil, hechos, now, resolverUbicacionDePerfil(perfil, resumen.ubicacionVerificada))
      const motivos = [
        ...(perfil.visible ? [] : ['Perfil oculto']),
        ...(!prestador ? ['Sin alta como prestador'] : !hechos.aprobado ? ['Prestador no aprobado'] : []),
        ...(publico.mapLocations.length === 0 ? ['Sin zona reconocida para el mapa'] : []),
      ]
      return {
        id: perfil.id, tenantId: perfil.tenantId, nombre: perfil.nombrePublico, oficio: perfil.oficio, oficioLabel: publico.profession.label,
        oficios: perfil.oficios.map((id) => ({ id, label: oficio(id).label })),
        zona: perfil.zona, zonasCobertura: perfil.zonasCobertura, visible: perfil.visible, aprobado: hechos.aprobado,
        registrado: Boolean(prestador), verificado: hechos.verificado, ubicaciones: publico.mapLocations.length,
        enMapa: motivos.length === 0, motivos, creadoEn: new Date(perfil.creadoEn).toISOString(), actualizadoEn: new Date(perfil.actualizadoEn).toISOString(),
        mercadoPago: operacion.get(perfil.tenantId)?.mercadoPago ?? 'not_connected',
        rating: calificaciones.get(perfil.tenantId) ?? null,
        trabajosCompletados: operacion.get(perfil.tenantId)?.completados ?? 0,
      }
    })
  }

  async listarParaAdmin(): Promise<FilaAdminPrestador[]> {
    return this.filasAdmin(await this.deps.perfiles.todos({ limite: 500 }))
  }

  async paginaParaAdmin(input: { pagina: number; tamano: number; q: string; oficio: string; zona: string; visible: boolean | null; verificado: boolean | null }) {
    const resultado = await this.deps.perfiles.paginaAdmin(input)
    return { items: await this.filasAdmin(resultado.items), total: resultado.total }
  }

  // Tenants con perfil de prestador (rol "prestador" en Usuarios): una sola lectura de ids.
  async tenantsConPerfil(): Promise<string[]> {
    return this.deps.perfiles.tenants()
  }

  // Publicar u ocultar un perfil (única acción de estado que existe en el directorio).
  // Link from an account (admin user detail) to its provider profile, if any.
  async perfilDeTenantAdmin(tenantId: string): Promise<{ id: string; displayName: string; visible: boolean } | null> {
    const perfil = await this.deps.perfiles.porTenant(tenantId)
    return perfil ? { id: perfil.id, displayName: perfil.nombrePublico, visible: perfil.visible } : null
  }

  // Platform administration: the stored profile (every editable business field) of any provider.
  async perfilParaAdmin(id: string): Promise<PerfilPublico | null> {
    return this.deps.perfiles.porId(id)
  }

  // Same validation and invariants as the provider's own edit (principal service in the set,
  // contact data refused, geography untouched); the tenant comes from the stored profile.
  async guardarPerfilAdmin(id: string, body: Record<string, unknown>): Promise<ResultadoPerfil | { ok: false; code: 'NOT_FOUND' }> {
    const perfil = await this.deps.perfiles.porId(id)
    if (!perfil) return { ok: false, code: 'NOT_FOUND' }
    const context = { tenantId: perfil.tenantId, subjectId: 'platform-admin', sessionId: 'admin', roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'admin' }
    return this.guardarPerfil(context, body)
  }

  async cambiarVisibilidadAdmin(id: string, visible: boolean): Promise<{ id: string; tenantId: string; visible: boolean } | null> {
    const perfil = await this.deps.perfiles.porId(id)
    if (!perfil) return null
    await this.deps.perfiles.guardar({ ...perfil, visible, actualizadoEn: this.now() })
    return { id: perfil.id, tenantId: perfil.tenantId, visible }
  }

  // Relevancia: verificados primero, luego cercanía de barrio (si hay zona), trabajos completados,
  // quien atiende hoy y quien tiene servicios publicados. Todo sobre datos reales.
  private ordenar(items: Enriquecido[], orden: OrdenDirectorio, zona: string | null): Enriquecido[] {
    const distancia = (item: Enriquecido) => (zona ? distanciaEntreZonas(zona, item.ubicacion.primaryZone) ?? 99 : 0)
    const hoy = (item: Enriquecido) => (item.publico.availability.status === 'atiende_hoy' ? 1 : 0)
    return [...items].sort((a, b) => {
      if (orden === 'trabajos') return b.publico.completedJobs - a.publico.completedJobs || Number(b.publico.verified) - Number(a.publico.verified)
      if (orden === 'cercania') return distancia(a) - distancia(b) || Number(b.publico.verified) - Number(a.publico.verified)
      return (
        Number(b.publico.verified) - Number(a.publico.verified) ||
        distancia(a) - distancia(b) ||
        b.publico.completedJobs - a.publico.completedJobs ||
        hoy(b) - hoy(a) ||
        b.hechos.servicios.length - a.hechos.servicios.length ||
        a.perfil.nombrePublico.localeCompare(b.perfil.nombrePublico, 'es')
      )
    })
  }
}

function pickGeografia(perfil: PerfilPublico) {
  return {
    latitud: perfil.latitud,
    longitud: perfil.longitud,
    mostrarUbicacionExacta: perfil.mostrarUbicacionExacta,
    barrioId: perfil.barrioId,
    zonaId: perfil.zonaId,
    ubicacionAsociacion: perfil.ubicacionAsociacion,
  }
}

function vistaUbicacion(perfil: PerfilPublico): UbicacionPrestador {
  const catalogo = catalogoVigente()
  const barrio = perfil.barrioId ? catalogo.barrios.find((item) => item.id === perfil.barrioId) : undefined
  const zona = perfil.zonaId ? catalogo.zonas.find((item) => item.id === perfil.zonaId) : undefined
  return {
    lat: perfil.latitud,
    lng: perfil.longitud,
    showExact: perfil.mostrarUbicacionExacta,
    association: perfil.ubicacionAsociacion,
    barrio: barrio ? { id: barrio.id, name: barrio.nombre } : null,
    zone: zona ? { id: zona.id, name: zona.nombre } : null,
    mapPoint: resolverPuntoMapa(catalogo, { ...perfil, zonasCobertura: perfil.zonasCobertura }),
  }
}
