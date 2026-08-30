import type { MetadataRoute } from 'next'
import { resolveTusPublicOrigin } from '../lib/tus-journeys'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/tus', '/auth', '/sign-in'],
    },
    sitemap: `${resolveTusPublicOrigin()}/sitemap.xml`,
  }
}
