import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Security headers of the Web (Vercel). The CSP is per request with a nonce (middleware); the rest
// are static headers in next.config.js.
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

test('WEB CSP: production policy is nonce-based, no unsafe-eval, no inline scripts, no framing', () => {
  const result = runTypeScriptScenario(`
    const { buildContentSecurityPolicy, createNonce, originOf } = await import('./apps/web/src/lib/security-headers.ts')
    const nonce = createNonce()
    console.log(JSON.stringify({
      nonce,
      other: createNonce(),
      prod: buildContentSecurityPolicy({ nonce, apiUrl: 'https://api.tusservicios.shop', tileUrl: undefined }),
      dev: buildContentSecurityPolicy({ nonce, apiUrl: 'http://127.0.0.1:4000', development: true }),
      subdomains: originOf('https://{s}.tile.example.org/{z}/{x}/{y}{r}.png'),
      invalid: [originOf('javascript:alert(1)'), originOf('no es url'), originOf(undefined)],
    }))
  `)
  const directives = Object.fromEntries(result.prod.split('; ').map((part) => { const [name, ...values] = part.split(' '); return [name, values] }))
  assert.match(result.nonce, /^[A-Za-z0-9+/]{22}==$/u, '128-bit nonce')
  assert.notEqual(result.nonce, result.other, 'fresh nonce per call')
  assert.deepEqual(directives['script-src'], ["'self'", `'nonce-${result.nonce}'`, "'strict-dynamic'"])
  assert.doesNotMatch(result.prod, /unsafe-eval/u)
  assert.ok(!directives['script-src'].includes("'unsafe-inline'"))
  assert.deepEqual(directives['frame-ancestors'], ["'none'"])
  assert.deepEqual(directives['object-src'], ["'none'"])
  assert.deepEqual(directives['base-uri'], ["'self'"])
  assert.deepEqual(directives['form-action'], ["'self'"])
  assert.deepEqual(directives['connect-src'], ["'self'", 'https://api.tusservicios.shop'])
  assert.deepEqual(directives['img-src'], ["'self'", 'data:', 'blob:', 'https://api.tusservicios.shop', 'https://tile.openstreetmap.org'])
  assert.ok('upgrade-insecure-requests' in directives)
  // Development only: eval for React refresh and websockets for HMR.
  assert.match(result.dev, /script-src [^;]*'unsafe-eval'/u)
  assert.match(result.dev, /connect-src 'self' http:\/\/127\.0\.0\.1:4000 ws: wss:/u)
  assert.equal(result.subdomains, 'https://*.tile.example.org')
  assert.deepEqual(result.invalid, [null, null, null])
})

test('WEB headers: middleware enforces the CSP on documents and next.config sets the static headers', () => {
  const middleware = read('apps/web/src/middleware.ts')
  assert.match(middleware, /createNonce\(\)/u)
  assert.match(middleware, /headers\.set\('Content-Security-Policy', policy\)/u, 'request header: Next stamps the nonce')
  assert.match(middleware, /response\.headers\.set\('Content-Security-Policy', policy\)/u, 'response header: browser enforces it')
  assert.match(middleware, /development: process\.env\.NODE_ENV === 'development'/u)
  // Pages must render per request, otherwise a prerendered page would carry a stale/no nonce.
  assert.match(read('apps/web/src/app/layout.tsx'), /await headers\(\)/u)
  const config = read('apps/web/next.config.js')
  for (const [name, value] of [
    ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains'],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
  ]) assert.ok(config.includes(`{ key: '${name}', value: '${value}' }`), name)
  assert.match(config, /key: 'Permissions-Policy'[\s\S]*camera=\(\), microphone=\(\), geolocation=\(self\)/u)
  assert.match(config, /poweredByHeader: false/u)
  assert.match(config, /source: '\/:path\*', headers: securityHeaders/u)
})
