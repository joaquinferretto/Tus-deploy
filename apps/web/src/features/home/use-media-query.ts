'use client'

import { useSyncExternalStore } from 'react'

// True while the media query matches. On the server (and during hydration) it is false, so the
// first render is the same on both sides.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}
