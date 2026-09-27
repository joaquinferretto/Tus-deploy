import { ZONAS_CORRIENTES } from '../solicitudes/modelo.ts'

import type {
  CoberturaPublicaPrestador,
  FuenteUbicacionPublica,
  ModalidadAtencionPublica,
  UbicacionMapaPrestador,
} from '@factory/contracts'

export interface AreaDomicilioFallback {
  barrio: string | null
  localidad: string | null
  provincia: string | null
}

export interface ResolucionUbicacionPublica {
  source: FuenteUbicacionPublica
  publicArea: string
  serviceZones: string[]
  primaryZone: string | null
  mapLocations: UbicacionMapaPrestador[]
  coverage: CoberturaPublicaPrestador
}

const DEFAULT_MODE: ModalidadAtencionPublica = 'domicilio'

export function resolverUbicacionPublicaPrestador(input: {
  zone: string | null
  serviceZones: readonly string[]
  mode: ModalidadAtencionPublica
  radiusKm: number | null
  identityFallback?: AreaDomicilioFallback | null
}): ResolucionUbicacionPublica {
  const configured = uniqueZones([input.zone, ...input.serviceZones])
  const coverage = {
    mode: input.mode ?? DEFAULT_MODE,
    radiusKm: input.radiusKm,
  } satisfies CoberturaPublicaPrestador

  if (configured.length > 0) {
    return buildResolution('configured', configured, configured[0]!, coverage)
  }

  const fallbackZone = resolveKnownZone(input.identityFallback?.barrio)
  if (fallbackZone) return buildResolution('identity_fallback', [fallbackZone], fallbackZone, coverage)

  const fallbackArea = publicAreaFromIdentity(input.identityFallback)
  if (fallbackArea) {
    return {
      source: 'identity_fallback',
      publicArea: fallbackArea,
      serviceZones: [],
      primaryZone: null,
      mapLocations: [],
      coverage,
    }
  }

  return {
    source: 'none',
    publicArea: 'Zona no informada',
    serviceZones: [],
    primaryZone: null,
    mapLocations: [],
    coverage,
  }
}

function buildResolution(
  source: FuenteUbicacionPublica,
  zones: string[],
  primaryZone: string,
  coverage: CoberturaPublicaPrestador
): ResolucionUbicacionPublica {
  return {
    source,
    publicArea: primaryZone,
    serviceZones: zones,
    primaryZone,
    mapLocations: zones.flatMap((zone) => {
      const known = ZONAS_CORRIENTES.find((item) => item.nombre === zone)
      return known
        ? [{ label: zone, lat: round(known.lat), lng: round(known.lng), precision: 'zone' as const }]
        : []
    }),
    coverage,
  }
}

function uniqueZones(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = []
  for (const value of values) {
    const known = resolveKnownZone(value)
    if (known && !result.includes(known)) result.push(known)
  }
  return result
}

function resolveKnownZone(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = normalize(value)
  return ZONAS_CORRIENTES.find((item) => normalize(item.nombre) === normalized)?.nombre ?? null
}

function publicAreaFromIdentity(value: AreaDomicilioFallback | null | undefined): string | null {
  if (!value) return null
  const locality = safeLabel(value.localidad)
  const province = safeLabel(value.provincia)
  if (!locality && !province) return null
  return [locality, province].filter(Boolean).join(', ')
}

function safeLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized && normalized.length <= 80 && !/\d/iu.test(normalized) ? normalized : null
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9ñ\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
