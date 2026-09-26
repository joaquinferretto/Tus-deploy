// Only our SVG paths reach Leaflet's HTML marker. No labels or API-provided HTML
// are interpolated, so a category name can never inject markup into the map.
const paths: Record<string, string> = {
  plomeria: '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  electricidad: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  mecanica: '<path d="m5 7 2-4h10l2 4 2 3v7H3v-7l2-3Z"/><path d="M5 7h14M6 17v3m12-3v3M6 11h2m8 0h2"/>',
  pintura: '<rect x="3" y="3" width="14" height="6" rx="2"/><path d="M17 6h4v7h-9v3"/><rect x="10" y="16" width="4" height="6" rx="1"/>',
  aire: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4M17 19l-1-4 4-1M4 14l4 1-1 4M17 5l-1 4 4 1"/>',
  otros: '<path d="M14 4a6 6 0 0 0-7 7L2 16a3 3 0 0 0 4 4l5-5a6 6 0 0 0 7-7l-4 4-4-4 4-4Z"/>',
}

export function categoryMarkerSvg(categoryId: string): string {
  const path = Object.hasOwn(paths, categoryId) ? paths[categoryId] : paths['otros']
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
}
