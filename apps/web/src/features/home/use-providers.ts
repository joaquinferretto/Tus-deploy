'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getProvidersSource, type ProviderMapFilters } from './providers-source'
import { useDebouncedValue } from './use-requests'

export function useHomeProviders(filters: ProviderMapFilters) {
  const debounced = useDebouncedValue(filters, 300)
  const source = useMemo(() => getProvidersSource(), [])
  return useQuery({
    queryKey: ['home-providers', debounced.category ?? '', debounced.profession, debounced.zone, debounced.query],
    queryFn: () => source.list(debounced),
    staleTime: 30_000,
  })
}
