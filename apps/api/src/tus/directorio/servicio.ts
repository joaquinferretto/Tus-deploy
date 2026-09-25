import { randomUUID } from 'node:crypto'

import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import {
  distanciaEntreZonas,
  interpretarNecesidad,
  proyectarPerfil,
  proyectarPublico,
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
import type { AlmacenPerfiles, FuentesDirectorio } from './puertos.ts'

const PERFILES_MAXIMOS = 300
export const TAMANO_PAGINA = 12
export const CANDIDATOS_MAXIMOS = 5

export type OrdenDirectorio = 'relevancia' | 'trabajos' | 'cercania'

export interface FiltrosDirectorio {
  oficio?: unknown
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
  publico: PrestadorPublico
}

// Caso de uso compartido por el directorio Web ("Buscar trabajador"), el asistente Web ("Buscar
// servicios") y las herramientas del asistente de WhatsApp. Solo lee datos reales: si un prestador
// no está aprobado o no tiene perfil visible, no aparece; nunca se completan datos faltantes.
export class ServicioDirectorio {
  private readonly now: () => number
  private readonly newId: () => string

  constructor(
    private readonly deps: { perfiles: AlmacenPerfiles; fuentes: FuentesDirectorio; now?: () => number; newId?: () => string }
  ) {
    this.now = deps.now ?? Date.now
    this.newId = deps.newId ?? randomUUID
  }

  // ---- perfil del prestador autenticado -------------------------------------------------------

  async miPerfil(context: TusAuthenticatedTenantContext): Promise<(PerfilPrestadorPublico & { visible: boolean }) | null> {
    const perfil = await this.deps.perfiles.porTenant(context.tenantId)
    if (!perfil) return null
    return { ...proyectarPerfil(perfil, await this.deps.fuentes.hechos(context.tenantId), this.now()), visible: perfil.visible }
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
      ...validacion.valor,
      creadoEn: actual?.creadoEn ?? ahora,
      actualizadoEn: ahora,
    }
    await this.deps.perfiles.guardar(perfil)
    return { ok: true, perfil: { ...proyectarPerfil(perfil, await this.deps.fuentes.hechos(context.tenantId), ahora), visible: perfil.visible } }
  }

  // ---- lectura pública ------------------------------------------------------------------------

  async listar(filtros: FiltrosDirectorio = {}): Promise<{ items: PrestadorPublico[]; total: number; page: number; hasMore: boolean }> {
    const oficioFiltro = esOficio(filtros.oficio) ? filtros.oficio : undefined
    const zona = typeof filtros.zona === 'string' && filtros.zona.trim() ? filtros.zona.trim() : null
    const q = typeof filtros.q === 'string' ? normalizarTexto(filtros.q.slice(0, 80)) : ''
    const orden: OrdenDirectorio = filtros.orden === 'trabajos' || filtros.orden === 'cercania' ? filtros.orden : 'relevancia'
    const pagina = Math.max(1, Math.min(50, Number.parseInt(String(filtros.pagina ?? '1'), 10) || 1))
    // Si el texto nombra un oficio ("electricista"), se usa como filtro de oficio.
    const oficioTexto = !oficioFiltro && q ? interpretarNecesidad(q).category : null

    let items = await this.enriquecerVisibles(oficioFiltro ?? oficioTexto ?? undefined)
    if (q) {
      const terminos = q.split(' ').filter((termino) => termino.length >= 3)
      items = items.filter(({ perfil, hechos }) => {
        if (oficioTexto && perfil.oficio === oficioTexto) return true
        const info = oficio(perfil.oficio)
        const texto = normalizarTexto(`${perfil.nombrePublico} ${info.label} ${info.profesion} ${info.palabrasClave} ${perfil.descripcion ?? ''} ${hechos.servicios.map((servicio) => servicio.nombre).join(' ')}`)
        return terminos.every((termino) => texto.includes(termino))
      })
    }
    if (zona) items = items.filter(({ perfil }) => normalizarTexto(perfil.zona) === normalizarTexto(zona))
    if (filtros.verificados === true || filtros.verificados === 'true' || filtros.verificados === '1') items = items.filter((item) => item.publico.verified)
    if (filtros.atiendeHoy === true || filtros.atiendeHoy === 'true' || filtros.atiendeHoy === '1') items = items.filter((item) => item.publico.availability.status === 'atiende_hoy')

    const ordenados = this.ordenar(items, orden, zona)
    const inicio = (pagina - 1) * TAMANO_PAGINA
    return {
      items: ordenados.slice(inicio, inicio + TAMANO_PAGINA).map((item) => item.publico),
      total: ordenados.length,
      page: pagina,
      hasMore: inicio + TAMANO_PAGINA < ordenados.length,
    }
  }

  async perfil(id: unknown): Promise<PerfilPrestadorPublico | null> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/u.test(id)) return null
    const perfil = await this.deps.perfiles.porId(id)
    if (!perfil || !perfil.visible) return null
    const hechos = await this.deps.fuentes.hechos(perfil.tenantId)
    if (!hechos.aprobado) return null
    return proyectarPerfil(perfil, hechos, this.now())
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

  // ---- asistente ------------------------------------------------------------------------------

  interpretar(texto: unknown): Interpretacion {
    return interpretarNecesidad(typeof texto === 'string' ? texto : '')
  }

  // Candidatos compatibles (3 a 5 cuando existen). El cliente elige; nunca se elige por él.
  async buscarCandidatos(input: { oficio: unknown; zona?: unknown; limite?: number }): Promise<{ items: CandidatoPrestador[]; reason: 'ok' | 'no_providers' | 'invalid_profession' }> {
    if (!esOficio(input.oficio)) return { items: [], reason: 'invalid_profession' }
    const zona = typeof input.zona === 'string' && input.zona.trim() ? input.zona.trim() : null
    const limite = Math.max(1, Math.min(CANDIDATOS_MAXIMOS, input.limite ?? CANDIDATOS_MAXIMOS))
    const items = this.ordenar(await this.enriquecerVisibles(input.oficio as OficioId), 'relevancia', zona).slice(0, limite)
    return {
      items: items.map((item) => ({ ...item.publico, distanceKm: zona ? distanciaEntreZonas(zona, item.perfil.zona) : null })),
      reason: items.length > 0 ? 'ok' : 'no_providers',
    }
  }

  // ---- internos -------------------------------------------------------------------------------

  private async enriquecerVisibles(oficioFiltro?: OficioId): Promise<Enriquecido[]> {
    const perfiles = await this.deps.perfiles.visibles({ ...(oficioFiltro ? { oficio: oficioFiltro } : {}), limite: PERFILES_MAXIMOS })
    const now = this.now()
    const enriquecidos = await Promise.all(
      perfiles.map(async (perfil) => {
        const hechos = await this.deps.fuentes.hechos(perfil.tenantId)
        return hechos.aprobado ? { perfil, hechos, publico: proyectarPublico(perfil, hechos, now) } : null
      })
    )
    return enriquecidos.filter((item): item is Enriquecido => item !== null)
  }

  // Relevancia: verificados primero, luego cercanía de barrio (si hay zona), trabajos completados,
  // quien atiende hoy y quien tiene servicios publicados. Todo sobre datos reales.
  private ordenar(items: Enriquecido[], orden: OrdenDirectorio, zona: string | null): Enriquecido[] {
    const distancia = (item: Enriquecido) => (zona ? distanciaEntreZonas(zona, item.perfil.zona) ?? 99 : 0)
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
