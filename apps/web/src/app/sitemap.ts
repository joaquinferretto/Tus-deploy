import type { MetadataRoute } from 'next'
import { resolveTusPublicOrigin } from '../lib/tus-journeys'

const PUBLIC_ROUTES = ['/'] as const

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((path) => ({
    url: new URL(path, resolveTusPublicOrigin()).toString(),
  }))
}
