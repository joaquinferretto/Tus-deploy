'use client'

import 'leaflet/dist/leaflet.css'

import { LeafletContext, createLeafletContext, type LeafletContextInterface } from '@react-leaflet/core'
import L from 'leaflet'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'

// The Leaflet map of TUS and its lifecycle. It replaces react-leaflet's MapContainer for one
// reason: WHEN the map is removed.
//
// Leaflet ends an animated zoom on a timer of its own (Map._animateZoom schedules
// _onZoomTransitionEnd 250 ms after every `zoomanim`). Map.remove() cancels a running pan and a
// running flyTo, but not that timer: removed in the middle of a zoom, the map gets one last
// callback that moves a pane which no longer exists, and it throws. MapContainer removes the map
// the instant React unmounts it, so any unmount within 250 ms of a zoom (a click on a cluster, a
// fitBounds, the zoom buttons, then a navigation) hit it.
//
// Here the map is created once per mount and removed exactly once, and the removal waits until
// no zoom timer can still be pending. By then React has already unmounted every child (their
// layers and listeners are gone) and nothing else holds the map: see useMapTimers for the timers
// of the application itself.
export const ZOOM_ANIMATION_MS = 250
export const ZOOM_REMOVAL_GRACE_MS = 50

type CancelMapOperation = () => void
type ScheduleMapOperation = (operation: () => void) => CancelMapOperation

const MapOperationContext = createContext<ScheduleMapOperation | null>(null)

export interface TusMapProps {
  center: [number, number]
  zoom: number
  dragging?: boolean
  scrollWheelZoom?: boolean
  children?: React.ReactNode
}

// How long after `now` a zoom animation that started at `lastZoomAnimation` may still call back.
export function pendingZoomMs(lastZoomAnimation: number | null, now: number): number {
  if (lastZoomAnimation === null) return 0
  // Leaflet registers its 250 ms fallback after `zoomanim` listeners return. The grace keeps our
  // removal strictly behind that registration instead of racing it at the same deadline.
  return Math.max(0, ZOOM_ANIMATION_MS + ZOOM_REMOVAL_GRACE_MS - (now - lastZoomAnimation))
}

export function TusMap({ center, zoom, dragging = true, scrollWheelZoom = true, children }: TusMapProps): React.ReactNode {
  const container = useRef<HTMLDivElement>(null)
  const [context, setContext] = useState<LeafletContextInterface | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const removalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRef = useRef<ScheduleMapOperation | null>(null)
  // Initial view only: afterwards the view belongs to the map (the layers move it).
  const initial = useRef({ center, zoom, dragging, scrollWheelZoom })

  const schedule = useCallback<ScheduleMapOperation>((operation) => {
    return scheduleRef.current?.(operation) ?? (() => undefined)
  }, [])

  useEffect(() => {
    const element = container.current
    if (!element) return

    // React Strict Mode runs one setup-cleanup-setup cycle. The first cleanup only schedules the
    // removal, so the second setup can cancel it and keep using the same initialized element.
    if (removalTimer.current) {
      clearTimeout(removalTimer.current)
      removalTimer.current = null
    }
    let map = mapRef.current
    if (!map) {
      map = L.map(element, { zoomControl: false, dragging: initial.current.dragging, scrollWheelZoom: initial.current.scrollWheelZoom })
      map.setView(initial.current.center, initial.current.zoom)
      mapRef.current = map
      setContext(createLeafletContext(map))
    }

    let lastZoomAnimation: number | null = null
    let moving = false
    let pending: { operation: () => void } | null = null
    const onZoomAnimation = () => {
      lastZoomAnimation = performance.now()
    }
    const onZoomEnd = () => {
      lastZoomAnimation = null
    }
    const onMoveStart = () => {
      moving = true
    }
    const onMoveEnd = () => {
      moving = false
      const next = pending
      pending = null
      next?.operation()
    }
    scheduleRef.current = (operation) => {
      const scheduled = { operation }
      if (moving) pending = scheduled
      else operation()
      return () => {
        if (pending === scheduled) pending = null
      }
    }
    map.on('zoomanim', onZoomAnimation)
    map.on('zoomend', onZoomEnd)
    map.on('movestart', onMoveStart)
    map.on('moveend', onMoveEnd)

    return () => {
      scheduleRef.current = null
      pending = null
      map.off('zoomanim', onZoomAnimation)
      map.off('zoomend', onZoomEnd)
      map.off('movestart', onMoveStart)
      map.off('moveend', onMoveEnd)
      const wait = pendingZoomMs(lastZoomAnimation, performance.now())
      // This task is deliberately deferred even with no zoom pending: Strict Mode's second setup
      // can cancel it. When a zoom is pending, the grace keeps removal after Leaflet's fallback.
      removalTimer.current = setTimeout(() => {
        if (mapRef.current !== map) return
        map.remove()
        mapRef.current = null
        removalTimer.current = null
      }, Math.ceil(wait))
    }
  }, [])

  return (
    <div ref={container} style={{ height: '100%', width: '100%' }}>
      {context ? (
        <LeafletContext value={context}>
          <MapOperationContext value={schedule}>
            <MapSizeWatcher />
            {children}
          </MapOperationContext>
        </LeafletContext>
      ) : null}
    </div>
  )
}

// View operations from mutually exclusive layers are serialized through public move events. If a
// layer changes while Leaflet is moving, only the newest still-mounted layer gets to act at the
// next moveend.
export function useMapOperation(): ScheduleMapOperation {
  const schedule = useContext(MapOperationContext)
  if (!schedule) throw new Error('useMapOperation must be used inside TusMap')
  return schedule
}

// Leaflet caches the size of its container. It is told to measure again ONLY when the container
// really changed size (rotation, the mobile address bar, the dock growing), once per frame.
function MapSizeWatcher() {
  const map = useMap()
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const container = map.getContainer()
    let width = container.clientWidth
    let height = container.clientHeight
    let frame = 0
    const observer = new ResizeObserver(() => {
      if (container.clientWidth === width && container.clientHeight === height) return
      width = container.clientWidth
      height = container.clientHeight
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    })
    observer.observe(container)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [map])
  return null
}

// Timers of a map component. Every one of them is cancelled when the component unmounts, so no
// callback of the application reaches a map that is being removed.
export function useMapTimers(): (callback: () => void, delayMs: number) => void {
  const pending = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = pending.current
    return () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])
  return useCallback((callback, delayMs) => {
    const timer = setTimeout(() => {
      pending.current.delete(timer)
      callback()
    }, delayMs)
    pending.current.add(timer)
  }, [])
}
