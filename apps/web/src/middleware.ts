import { NextResponse, type NextRequest } from 'next/server'
import { buildContentSecurityPolicy, createNonce } from '@/lib/security-headers'

// Per-request nonce CSP (see lib/security-headers.ts). The request header lets Next.js stamp the
// nonce on its scripts; the response header enforces it in the browser.
export function middleware(request: NextRequest): NextResponse {
  const nonce = createNonce()
  const policy = buildContentSecurityPolicy({
    nonce,
    apiUrl: process.env['NEXT_PUBLIC_API_URL'] || process.env['API_BASE_URL'],
    tileUrl: process.env['NEXT_PUBLIC_MAP_TILE_URL'],
    development: process.env.NODE_ENV === 'development',
  })
  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', policy)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  // Documents only: static chunks, optimized images and icons carry no executable HTML.
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon-|brand/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
