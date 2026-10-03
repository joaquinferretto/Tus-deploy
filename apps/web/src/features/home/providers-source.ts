import type { PaginaDirectorio, PrestadorPublico } from '@factory/contracts'

import { createDirectoryClient, type DirectoryFilters } from '../directory/directory-client'

export interface ProviderMapFilters {
  query: string
  profession: string
  zone: string
  // A category: providers offering ANY of its services (the service filter, when set, wins).
  category?: string
}

export interface ProvidersSource {
  list(filters: ProviderMapFilters, signal?: AbortSignal): Promise<PrestadorPublico[]>
}

export function toProviderFilters(filters: ProviderMapFilters): DirectoryFilters {
  return {
    q: filters.query,
    oficio: filters.profession,
    ...(filters.category && !filters.profession ? { categoria: filters.category } : {}),
    mapa: true,
    zona: filters.zone,
  }
}

export function createApiProvidersSource(): ProvidersSource {
  const client = createDirectoryClient()
  return {
    async list(filters, signal) {
      const result: PaginaDirectorio = await client.list(toProviderFilters(filters), signal)
      return result.items
    },
  }
}

const apiProvidersSource = createApiProvidersSource()

export function getProvidersSource(): ProvidersSource {
  return apiProvidersSource
}
