// Plane geometry over GeoJSON Polygon rings ([lng, lat] pairs). Areas of a city are small, so
// treating lng/lat as plane coordinates is accurate enough for "is this point inside" and for a
// representative point. No external library: the existing Leaflet stack has none server-side.

export type Anillo = readonly (readonly [number, number])[]

export function coordenadasValidas(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

// Ray casting (even-odd). Points exactly on an edge count as inside.
export function puntoEnPoligono(lat: number, lng: number, anillo: Anillo): boolean {
  let dentro = false
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i]!
    const [xj, yj] = anillo[j]!
    if (enSegmento(lng, lat, xi, yi, xj, yj)) return true
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro
  }
  return dentro
}

function enSegmento(x: number, y: number, x1: number, y1: number, x2: number, y2: number): boolean {
  const cruz = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
  if (Math.abs(cruz) > 1e-12) return false
  return x >= Math.min(x1, x2) - 1e-12 && x <= Math.max(x1, x2) + 1e-12 && y >= Math.min(y1, y2) - 1e-12 && y <= Math.max(y1, y2) + 1e-12
}

export function area(anillo: Anillo): number {
  let suma = 0
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) suma += (anillo[j]![0] + anillo[i]![0]) * (anillo[j]![1] - anillo[i]![1])
  return Math.abs(suma / 2)
}

// A representative point that is ALWAYS inside the polygon (equivalent to pointOnSurface): the
// centroid when it falls inside (convex-like shapes); otherwise the middle of the widest interior
// segment of a horizontal line through the vertical middle of the polygon. Rounded to ~1 m.
export function puntoInterior(anillo: Anillo): { lat: number; lng: number } | null {
  if (anillo.length < 4) return null
  const centro = centroide(anillo)
  if (centro && puntoEnPoligono(centro.lat, centro.lng, anillo)) return redondear(centro)
  const lats = anillo.map(([, lat]) => lat)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  // Try the middle line first, then lines around it (a vertex exactly on the line is skipped).
  for (const t of [0.5, 0.45, 0.55, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const y = minLat + (maxLat - minLat) * t
    const cortes: number[] = []
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i]!
      const [xj, yj] = anillo[j]!
      if (yi > y !== yj > y) cortes.push(((xj - xi) * (y - yi)) / (yj - yi) + xi)
    }
    cortes.sort((a, b) => a - b)
    let mejor: { lng: number; ancho: number } | null = null
    for (let k = 0; k + 1 < cortes.length; k += 2) {
      const ancho = cortes[k + 1]! - cortes[k]!
      if (ancho > 0 && (!mejor || ancho > mejor.ancho)) mejor = { lng: (cortes[k]! + cortes[k + 1]!) / 2, ancho }
    }
    if (mejor && puntoEnPoligono(y, mejor.lng, anillo)) return redondear({ lat: y, lng: mejor.lng })
  }
  return null
}

function centroide(anillo: Anillo): { lat: number; lng: number } | null {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [x0, y0] = anillo[j]!
    const [x1, y1] = anillo[i]!
    const f = x0 * y1 - x1 * y0
    a += f
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  if (Math.abs(a) < 1e-18) return null
  return { lng: cx / (3 * a), lat: cy / (3 * a) }
}

const redondear = (p: { lat: number; lng: number }) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })
