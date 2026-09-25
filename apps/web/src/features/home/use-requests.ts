'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { getRequestsSource, matchesFilters } from './requests-source'
import type { RequestFilters } from './types'

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs, value])
  return debounced
}

// ONE query feeds both the map and the list (never two arrays that can diverge). It is keyed by
// category only; text and zone are applied to the same result in the browser.
export function useRecentRequests(filters: RequestFilters) {
  const debounced = useDebouncedValue(filters)
  const source = getRequestsSource()
  return useQuery({
    queryKey: ['home-requests', debounced.category],
    queryFn: () => source.list({ category: debounced.category }),
    select: (requests) => requests.filter((request) => matchesFilters(request, debounced)),
    staleTime: 30_000,
  })
}
