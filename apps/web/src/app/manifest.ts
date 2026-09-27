import type { MetadataRoute } from 'next'
import { TUS_LOCALE } from '../lib/tus-journeys'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TUS platform',
    short_name: 'TUS',
    description: 'Argentina-first marketplace and merchant operations. Installable for quick access; online operation requires connectivity.',
    lang: TUS_LOCALE,
    dir: 'ltr',
    start_url: '/tus',
    // Todo el sitio: /mi-perfil, /mis-solicitudes y /asistente están fuera de /tus. El start_url
    // tiene que quedar dentro del scope (si no, el navegador ignora el scope).
    scope: '/',
    display: 'standalone',
    background_color: '#f4f0e7',
    theme_color: '#f4f0e7',
    icons: [
      { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
