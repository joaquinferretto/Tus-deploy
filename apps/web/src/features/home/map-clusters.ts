// Marker clustering for the provider map, without extra dependencies. Pure and deterministic
// (same input, same groups), so it is tested without a browser.
//
// 1. Providers on the SAME point (same coordinates rounded to 1e-6, e.g. several providers with
//    only a zone) always form one group: at any zoom they could never be told apart.
// 2. Below MAX_CLUSTER_ZOOM, points closer than `radiusPx` on screen (Web Mercator pixels at the
//    current zoom) are merged into a cluster whose position is the mean of its points.
// 3. From MAX_CLUSTER_ZOOM on, only rule 1 applies: every distinct point gets its own marker.

export const MAX_CLUSTER_ZOOM = 17
export const CLUSTER_RADIUS_PX = 48

export interface MapEntry<T> {
  item: T
  lat: number
  lng: number
}

export interface MapGroup<T> {
  key: string
  lat: number
  lng: number
  items: T[]
  // Every item shares one exact point: zooming in will never separate them (show a list).
  samePoint: boolean
  bounds: { south: number; west: number; north: number; east: number }
}

const pointKey = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`

export function projectToPixels(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  }
}

export function clusterMarkers<T>(entries: readonly MapEntry<T>[], zoom: number, radiusPx = CLUSTER_RADIUS_PX): MapGroup<T>[] {
  const valid = entries.filter((entry) => Number.isFinite(entry.lat) && Number.isFinite(entry.lng))
  // Rule 1: same exact point.
  const byPoint = new Map<string, MapEntry<T>[]>()
  for (const entry of valid) {
    const key = pointKey(entry.lat, entry.lng)
    byPoint.set(key, [...(byPoint.get(key) ?? []), entry])
  }
  const points = [...byPoint.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, members]) => ({ key, lat: members[0]!.lat, lng: members[0]!.lng, members, pixel: projectToPixels(members[0]!.lat, members[0]!.lng, zoom) }))

  const groups: MapGroup<T>[] = []
  const used = new Set<string>()
  for (const seed of points) {
    if (used.has(seed.key)) continue
    used.add(seed.key)
    const merged = [seed]
    if (zoom < MAX_CLUSTER_ZOOM) {
      // Rule 2: absorb the other points within the radius of the seed.
      for (const other of points) {
        if (used.has(other.key)) continue
        if (Math.hypot(other.pixel.x - seed.pixel.x, other.pixel.y - seed.pixel.y) <= radiusPx) {
          used.add(other.key)
          merged.push(other)
        }
      }
    }
    const members = merged.flatMap((point) => point.members)
    const lats = merged.map((point) => point.lat)
    const lngs = merged.map((point) => point.lng)
    groups.push({
      key: merged.map((point) => point.key).join('|'),
      lat: merged.length === 1 ? seed.lat : members.reduce((sum, entry) => sum + entry.lat, 0) / members.length,
      lng: merged.length === 1 ? seed.lng : members.reduce((sum, entry) => sum + entry.lng, 0) / members.length,
      items: members.map((entry) => entry.item),
      samePoint: merged.length === 1,
      bounds: { south: Math.min(...lats), west: Math.min(...lngs), north: Math.max(...lats), east: Math.max(...lngs) },
    })
  }
  return groups
}
