// Content Security Policy of the Web. Built per request by src/middleware.ts with a fresh nonce:
// Next.js reads the nonce from the request CSP header and stamps it on its own <script> tags, so
// script-src needs neither 'unsafe-inline' nor 'unsafe-eval' in production ('strict-dynamic' lets
// the nonced bundles load their chunks).
//
// style-src keeps 'unsafe-inline' on purpose: React server-renders `style={...}` props as style
// attributes (request photos, profile form, maps) and Leaflet ships inline positioning; style
// attributes cannot carry a nonce and a nonce in style-src would make browsers ignore
// 'unsafe-inline'. Inline styles cannot execute code, the risk accepted is CSS-only.
//
// Authorized external resources:
// - the TUS API (NEXT_PUBLIC_API_URL): fetch + private images served as blobs;
// - the map tile server (NEXT_PUBLIC_MAP_TILE_URL, OpenStreetMap by default): images only.
// Google OAuth and Mercado Pago are full-page navigations started by the API, CSP does not apply.

export interface CspInput {
  nonce: string
  apiUrl?: string | undefined
  tileUrl?: string | undefined
  development?: boolean
}

export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

// Origin of a configured URL, or null when it is missing/invalid (the policy then stays 'self').
export function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value.replaceAll('{s}', 'a').replace(/\{[a-z]+\}/giu, '0'))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    // Leaflet `{s}` subdomains (a/b/c.tile...) are covered with a single-level wildcard.
    return value.includes('{s}.') ? `${url.protocol}//*.${url.host.split('.').slice(1).join('.')}` : url.origin
  } catch {
    return null
  }
}

export function buildContentSecurityPolicy(input: CspInput): string {
  const api = originOf(input.apiUrl)
  const tiles = originOf(input.tileUrl || DEFAULT_TILE_URL)
  const extra = (...values: (string | null)[]) => values.filter((value): value is string => Boolean(value))
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${input.nonce}'`, "'strict-dynamic'", ...(input.development ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...extra(api, tiles)]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...extra(api), ...(input.development ? ['ws:', 'wss:'] : [])]],
    ['media-src', ["'self'", 'blob:']],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ]
  const policy = directives.map(([name, values]) => `${name} ${[...new Set(values)].join(' ')}`)
  if (!input.development) policy.push('upgrade-insecure-requests')
  return policy.join('; ')
}

export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
