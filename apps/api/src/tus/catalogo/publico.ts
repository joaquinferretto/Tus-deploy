import { catalogoVigente, barriosVigentes, zonasVigentes } from './vigente.ts'

// Public (active) catalog for the Web and the mobile app: categories and the location tree
// locality -> zones -> neighbourhoods (only those with a map point).
export function categoriasPublicas() {
  return catalogoVigente()
    .categorias.filter((categoria) => categoria.activo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
    .map((categoria) => ({ id: categoria.id, name: categoria.nombre }))
}

export function catalogoUbicacionesPublico() {
  const catalogo = catalogoVigente()
  const zonas = zonasVigentes()
  const barrios = barriosVigentes()
  return {
    localities: catalogo.localidades
      .filter((localidad) => localidad.activo)
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
      .map((localidad) => ({
        id: localidad.id,
        name: localidad.nombre,
        province: localidad.provincia,
        zones: zonas.filter((zona) => zona.localidadId === localidad.id).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)).map((zona) => ({ id: zona.id, name: zona.nombre, lat: zona.lat, lng: zona.lng, polygon: zona.poligono })),
        neighbourhoods: barrios.filter((barrio) => barrio.localidadId === localidad.id).map((barrio) => ({ id: barrio.id, name: barrio.nombre, zoneId: barrio.zonaId, lat: barrio.lat, lng: barrio.lng, polygon: barrio.poligono })),
      })),
  }
}
