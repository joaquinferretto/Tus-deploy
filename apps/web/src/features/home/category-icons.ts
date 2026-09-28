// Only our SVG paths reach Leaflet's HTML marker. No labels or API-provided HTML are interpolated:
// the admin panel picks an icon KEY for each trade and an unknown key uses the generic icon, so a
// catalog value can never inject markup into the map.
const paths: Record<string, string> = {
  plomeria: '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  electricidad: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  mecanica: '<path d="m5 7 2-4h10l2 4 2 3v7H3v-7l2-3Z"/><path d="M5 7h14M6 17v3m12-3v3M6 11h2m8 0h2"/>',
  pintura: '<rect x="3" y="3" width="14" height="6" rx="2"/><path d="M17 6h4v7h-9v3"/><rect x="10" y="16" width="4" height="6" rx="1"/>',
  aire: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4M17 19l-1-4 4-1M4 14l4 1-1 4M17 5l-1 4 4 1"/>',
  // Key: a round bow and a bit.
  cerrajeria: '<circle cx="8" cy="8" r="4"/><path d="m11 11 9 9M16 16l2-2M18.5 18.5l2-2"/>',
  // Brick wall.
  albanileria: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 15h18M9 5v5M15 10v5M9 15v4"/>',
  // Saw.
  carpinteria: '<path d="M3 17 17 3l4 4L7 21H3v-4Z"/><path d="m8 12 2 2M11 9l2 2M14 6l2 2"/>',
  // Leaf.
  jardineria: '<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19 13 11"/>',
  // Washing machine.
  electrodomesticos: '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M8 6h.01M11 6h.01"/>',
  // Spray bottle.
  limpieza: '<path d="M9 8h6l1 14H8L9 8Z"/><path d="M10 8V5h4l3-2M14 5h3"/>',
  // Box / truck.
  mudanza: '<path d="M2 7h11v10H2zM13 10h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  // Generic tool (also the fallback).
  herramienta: '<path d="M14 4a6 6 0 0 0-7 7L2 16a3 3 0 0 0 4 4l5-5a6 6 0 0 0 7-7l-4 4-4-4 4-4Z"/>',
}

paths['otros'] = paths['herramienta']!

export const ICON_KEYS = Object.keys(paths)

export function categoryMarkerSvg(iconKey: string): string {
  const path = Object.hasOwn(paths, iconKey) ? paths[iconKey] : paths['herramienta']
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
}
