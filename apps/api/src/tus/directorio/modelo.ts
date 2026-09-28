import type { CandidatoPrestador, DisponibilidadPublica, PerfilPrestadorPublico, PrestadorPublico } from '@factory/contracts'

import { contieneContacto, zonasCorrientes } from '../solicitudes/modelo.ts'
import { buscarBarrio, ubicacionesReconocibles } from '../catalogo/vigente.ts'
import { esOficio, normalizarTexto, oficio, oficiosInterpretables, type OficioId } from './oficios.ts'
import { resolverUbicacionPublicaPrestador, type AreaDomicilioFallback, type ResolucionUbicacionPublica } from './ubicacion.ts'

// Directorio "Buscar trabajador" y búsqueda del asistente. Todo lo que sale de acá es público:
// nombre que el prestador eligió mostrar, oficio, barrio, descripción, experiencia y hechos
// calculados por TUS (verificación, trabajos completados, servicios publicados). Nunca dirección,
// teléfono, email, documento, coordenadas ni ids internos (tenant/prestador).

export interface PerfilPublico {
  id: string
  tenantId: string
  prestadorId: string
  nombrePublico: string
  oficio: OficioId
  zona: string | null
  zonasCobertura: string[]
  modalidadAtencion: 'local' | 'domicilio' | 'mixto'
  radioCoberturaKm: number | null
  descripcion: string | null
  aniosExperiencia: number | null
  visible: boolean
  creadoEn: number
  actualizadoEn: number
}

export interface HorarioServicio {
  day: number
  start: string
  end: string
}

export interface ServicioResumen {
  listingId: string
  nombre: string
  precio: number | null
  moneda: string
  modalidadPrecio: string | null
  horario: HorarioServicio[]
}

// Hechos reales que TUS conoce del prestador (no los declara el prestador).
export interface HechosPrestador {
  aprobado: boolean
  verificado: boolean
  trabajosCompletados: number
  servicios: ServicioResumen[]
}

export type EstadoDisponibilidad = Disponibilidad['status']

// ---- DTO públicos: son los contratos de @factory/contracts (tus-directorio.ts) ------------------

export type Disponibilidad = DisponibilidadPublica
export type { CandidatoPrestador, PerfilPrestadorPublico, PrestadorPublico }

// ---- validación del perfil que edita el prestador ----------------------------------------------

export type CampoPerfil = 'displayName' | 'profession' | 'zone' | 'serviceZones' | 'serviceMode' | 'coverageRadiusKm' | 'description' | 'yearsOfExperience' | 'visible'

export interface EntradaPerfil {
  nombrePublico: string
  oficio: OficioId
  zona: string | null
  zonasCobertura: string[]
  modalidadAtencion: 'local' | 'domicilio' | 'mixto'
  radioCoberturaKm: number | null
  descripcion: string | null
  aniosExperiencia: number | null
  visible: boolean
}

export function validarPerfil(body: Record<string, unknown>): { ok: true; valor: EntradaPerfil } | { ok: false; campos: CampoPerfil[] } {
  const campos: CampoPerfil[] = []
  const texto = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '')
  const nombre = texto(body['displayName'])
  const descripcion = texto(body['description'])
  const zonaInput = typeof body['zone'] === 'string' ? body['zone'].trim() : ''
  const zona = zonasCorrientes().find((item) => item.nombre === zonaInput)?.nombre ?? null
  const zonasInput = [zona, ...(Array.isArray(body['serviceZones']) ? body['serviceZones'] : [])]
  const zonasCobertura = [...new Set(zonasInput.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))]
  const zonasValidas = zonasCobertura.length <= 40 && zonasCobertura.every((value) => zonasCorrientes().some((item) => item.nombre === value))
  const modalidadCruda = body['serviceMode'] ?? 'domicilio'
  const modalidadAtencion = modalidadCruda === 'local' || modalidadCruda === 'domicilio' || modalidadCruda === 'mixto' ? modalidadCruda : null
  const radioCrudo = body['coverageRadiusKm']
  const radioCoberturaKm = radioCrudo === null || radioCrudo === undefined || radioCrudo === '' ? null : radioCrudo
  const experienciaCruda = body['yearsOfExperience']
  const experiencia = experienciaCruda === null || experienciaCruda === undefined || experienciaCruda === '' ? null : experienciaCruda
  const visible = body['visible'] === undefined ? true : body['visible']

  if (nombre.length < 2 || nombre.length > 60 || contieneContacto(nombre) || /\d{3,}/u.test(nombre)) campos.push('displayName')
  if (!esOficio(body['profession'])) campos.push('profession')
  if (body['zone'] !== undefined && body['zone'] !== null && zonaInput && !zona) campos.push('zone')
  if (!zonasValidas) campos.push('serviceZones')
  if (!modalidadAtencion) campos.push('serviceMode')
  if (radioCoberturaKm !== null && (typeof radioCoberturaKm !== 'number' || !Number.isInteger(radioCoberturaKm) || radioCoberturaKm < 1 || radioCoberturaKm > 100)) campos.push('coverageRadiusKm')
  if (descripcion.length > 600 || contieneContacto(descripcion)) campos.push('description')
  if (experiencia !== null && (typeof experiencia !== 'number' || !Number.isInteger(experiencia) || experiencia < 0 || experiencia > 70)) campos.push('yearsOfExperience')
  if (typeof visible !== 'boolean') campos.push('visible')
  if (campos.length > 0) return { ok: false, campos }
  return {
    ok: true,
    valor: {
      nombrePublico: nombre,
      oficio: body['profession'] as OficioId,
      zona,
      zonasCobertura: zonasCobertura.length > 0 ? zonasCobertura : zona ? [zona] : [],
      modalidadAtencion: modalidadAtencion!,
      radioCoberturaKm: radioCoberturaKm as number | null,
      descripcion: descripcion || null,
      aniosExperiencia: experiencia as number | null,
      visible: visible as boolean,
    },
  }
}

// ---- proyecciones públicas ----------------------------------------------------------------------

export function iniciales(nombre: string): string {
  const partes = nombre.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/u).filter(Boolean)
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || 'T'
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Día de la semana en Argentina (los horarios de las publicaciones usan 0 = domingo).
export function diaArgentina(now: number): number {
  const nombre = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(now))
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nombre)
}

// Solo se afirma lo que dicen los horarios publicados: "atiende hoy" no garantiza un turno libre.
export function disponibilidad(servicios: ServicioResumen[], now: number): Disponibilidad {
  const horarios = servicios.flatMap((servicio) => servicio.horario)
  if (horarios.length === 0) return { status: 'sin_agenda', label: 'Sin horarios publicados', today: null }
  const hoy = diaArgentina(now)
  const deHoy = horarios.filter((item) => item.day === hoy).sort((a, b) => a.start.localeCompare(b.start))
  if (deHoy.length > 0) {
    const today = { start: deHoy[0]!.start, end: deHoy.map((item) => item.end).sort().at(-1)! }
    return { status: 'atiende_hoy', label: `Atiende hoy de ${today.start} a ${today.end}`, today }
  }
  const dias = [...new Set(horarios.map((item) => item.day))].sort((a, b) => a - b)
  return { status: 'otros_dias', label: `Atiende ${dias.map((dia) => DIAS[dia] ?? '').filter(Boolean).join(', ')}`, today: null }
}

export function proyectarPublico(perfil: PerfilPublico, hechos: HechosPrestador, now: number, ubicacion?: ResolucionUbicacionPublica): PrestadorPublico {
  const info = oficio(perfil.oficio)
  const resolved = ubicacion ?? resolverUbicacionPublicaPrestador({ zone: perfil.zona, serviceZones: perfil.zonasCobertura, mode: perfil.modalidadAtencion, radiusKm: perfil.radioCoberturaKm })
  const precios = hechos.servicios.filter((servicio) => servicio.precio !== null && servicio.precio > 0)
  const minimo = precios.sort((a, b) => a.precio! - b.precio!)[0]
  return {
    id: perfil.id,
    displayName: perfil.nombrePublico,
    initials: iniciales(perfil.nombrePublico),
    profession: { id: info.id, label: info.label, title: info.profesion },
    approximateArea: resolved.publicArea,
    publicArea: resolved.publicArea,
    serviceZones: resolved.serviceZones,
    locationSource: resolved.source,
    mapLocations: resolved.mapLocations,
    coverage: resolved.coverage,
    verified: hechos.verificado,
    completedJobs: hechos.trabajosCompletados,
    rating: null,
    availability: disponibilidad(hechos.servicios, now),
    yearsOfExperience: perfil.aniosExperiencia,
    startingPrice: minimo ? { amount: minimo.precio!, currency: minimo.moneda } : null,
  }
}

export function proyectarPerfil(perfil: PerfilPublico, hechos: HechosPrestador, now: number, ubicacion?: ResolucionUbicacionPublica): PerfilPrestadorPublico {
  return {
    ...proyectarPublico(perfil, hechos, now, ubicacion),
    description: perfil.descripcion,
    services: hechos.servicios.map((servicio) => ({
      listingId: servicio.listingId,
      name: servicio.nombre,
      price: servicio.precio,
      currency: servicio.moneda,
      priceMode: servicio.modalidadPrecio,
      days: [...new Set(servicio.horario.map((item) => item.day))].sort((a, b) => a - b),
    })),
  }
}

export function resolverUbicacionDePerfil(perfil: PerfilPublico, identityFallback?: AreaDomicilioFallback | null): ResolucionUbicacionPublica {
  return resolverUbicacionPublicaPrestador({
    zone: perfil.zona,
    serviceZones: perfil.zonasCobertura,
    mode: perfil.modalidadAtencion,
    radiusKm: perfil.radioCoberturaKm,
    identityFallback,
  })
}

// ---- distancia aproximada entre barrios ---------------------------------------------------------

export function distanciaEntreZonas(a: string | null, b: string | null): number | null {
  const origen = buscarBarrio(a)
  const destino = buscarBarrio(b)
  if (!origen || !destino || origen.lat === null || origen.lng === null || destino.lat === null || destino.lng === null) return null
  const rad = (value: number) => (value * Math.PI) / 180
  const dLat = rad(destino.lat - origen.lat)
  const dLng = rad(destino.lng - origen.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(origen.lat)) * Math.cos(rad(destino.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10
}

// ---- interpretación de la necesidad (asistente Web y WhatsApp) ----------------------------------

export type UrgenciaInterpretada = 'urgente' | 'hoy_manana' | 'esta_semana' | 'sin_apuro'

export interface Interpretacion {
  category: OficioId | null
  // Oficios empatados cuando el texto es ambiguo: el cliente elige.
  alternatives: OficioId[]
  zone: string | null
  urgency: UrgenciaInterpretada | null
  budgetMax: number | null
}

// Interpretación determinística y auditable: palabras clave del catálogo, barrios conocidos y
// expresiones de urgencia/presupuesto. No inventa: si no reconoce algo, devuelve null.
// Palabras que por sí solas no alcanzan para decidir el oficio ("se rompió el motor" puede ser un
// auto, una bomba de agua, un portón o un aire). Solas, devuelven sus oficios posibles como
// alternativas para que el cliente elija; con más contexto, puntúan como cualquier otra palabra.
const TERMINOS_AMBIGUOS: Readonly<Record<string, readonly OficioId[]>> = {
  motor: ['mecanica', 'plomeria', 'aire', 'otros'],
}

export function interpretarNecesidad(texto: string): Interpretacion {
  const normalizado = normalizarTexto(texto.slice(0, 600))
  const todas = normalizado.split(' ').filter((palabra) => palabra.length >= 3)
  const ambiguas = todas.filter((palabra) => palabra in TERMINOS_AMBIGUOS)
  const palabras = todas.filter((palabra) => !(palabra in TERMINOS_AMBIGUOS))
  // Trades, synonyms and places come from the administered catalog (catalogo/vigente.ts).
  // Single-word synonyms match words (and 5-letter stems); multi-word synonyms ("perdida de
  // agua", "puerta trabada") match as phrases and weigh double.
  const puntajes = oficiosInterpretables().map((item) => {
    const terminos = [...item.sinonimos, item.nombre, item.profesion].map((termino) => normalizarTexto(termino)).filter(Boolean)
    const claves = [...new Set(terminos.flatMap((termino) => (termino.includes(' ') ? [] : [termino])).filter((clave) => clave.length >= 3))]
    const frases = terminos.filter((termino) => termino.includes(' '))
    const puntaje = palabras.reduce((total, palabra) => total + (claves.some((clave) => clave === palabra || (palabra.length >= 5 && clave.startsWith(palabra.slice(0, 5)))) ? 1 : 0), 0)
    const frase = frases.reduce((total, termino) => total + (new RegExp(`\\b${termino}\\b`, 'u').test(normalizado) ? 2 : 0), 0)
    return { id: item.id, puntaje: puntaje + frase }
  }).filter((item) => item.puntaje > 0)
  const maximo = Math.max(0, ...puntajes.map((item) => item.puntaje))
  const mejores = puntajes.filter((item) => item.puntaje === maximo).map((item) => item.id)

  // Neighbourhoods first (more specific), then administered zones; longer names first.
  const lugares = ubicacionesReconocibles().sort((a, b) => b.nombre.length - a.nombre.length)
  const zona = lugares.find((item) => new RegExp(`\\b${normalizarTexto(item.nombre)}\\b`, 'u').test(normalizado))?.nombre ?? null

  const urgencia: UrgenciaInterpretada | null = /\b(urgente|urgencia|emergencia|ya mismo|inmediato|ahora mismo)\b/u.test(normalizado)
    ? 'urgente'
    : /\b(hoy|manana)\b/u.test(normalizado)
      ? 'hoy_manana'
      : /\b(esta semana|en la semana|proximos dias)\b/u.test(normalizado)
        ? 'esta_semana'
        : /\b(sin apuro|cuando pueda|no es urgente)\b/u.test(normalizado)
          ? 'sin_apuro'
          : null

  const monto = /(?:\$\s*|hasta\s+)(\d{1,3}(?:[.\s]\d{3})+|\d{3,9})(?!\d)|(\d{1,3}(?:[.\s]\d{3})+|\d{4,9})\s*(?:pesos|\$)/iu.exec(texto)
  const presupuesto = monto ? Number((monto[1] ?? monto[2] ?? '').replace(/[.\s]/gu, '')) : null

  // Sin otra evidencia que un término ambiguo: se pregunta, no se elige.
  const alternativasAmbiguas = mejores.length === 0 && ambiguas.length > 0 ? [...new Set(ambiguas.flatMap((palabra) => TERMINOS_AMBIGUOS[palabra] ?? []))] : []

  return {
    category: mejores.length === 1 ? mejores[0]! : null,
    alternatives: mejores.length > 1 ? mejores : alternativasAmbiguas,
    zone: zona,
    urgency: urgencia,
    budgetMax: presupuesto && Number.isInteger(presupuesto) && presupuesto > 0 && presupuesto <= 100_000_000 ? presupuesto : null,
  }
}
