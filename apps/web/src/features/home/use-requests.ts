'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { getRequestsSource } from './requests-source'
import type { RequestFilters } from './types'

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs, value])
  return debounced
}

// ONE query feeds both the map and the list (never two arrays that can diverge).
export function useRecentRequests(filters: RequestFilters) {
  const debounced = useDebouncedValue(filters)
  const source = getRequestsSource()
  const query = useQuery({
    queryKey: ['home-requests', source.kind, debounced.query, debounced.category, debounced.zone],
    queryFn: () => source.list(debounced),
    staleTime: 60_000,
  })
  return { ...query, sourceKind: source.kind }
}
