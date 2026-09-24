import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const read = (path) => readFileSync(join(root, path), 'utf8')

test('IDENTITY-NOSIS Web client: authenticated JSON/raw calls to the TUS API only, client-side file checks', () => {
  const result = runTypeScriptScenario(`
    process.env.NEXT_PUBLIC_API_URL = 'https://api.tus.test'
    const calls = []
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers, bodyType: init.body === undefined ? null : typeof init.body === 'string' ? 'json' : 'blob', body: typeof init.body === 'string' ? JSON.parse(init.body) : null, cache: init.cache }); return new Response(JSON.stringify({ ok: true }), { status: 200 }) }
    const { clienteIdentidad, validarArchivoDni } = await import('./apps/web/src/lib/tus-identidad.ts')
    const session = { tenantId: 'prestador-1', actorId: 'user-1', correlationId: 'corr', accessToken: 'token-1' }
    await clienteIdentidad.estado(session)
    await clienteIdentidad.aceptarConsentimiento(session, 'identidad-prestador-v1')
    await clienteIdentidad.subirDocumento(session, 'front', new Blob([new Uint8Array(10)], { type: 'image/png' }))
    await clienteIdentidad.enviar(session)
    await clienteIdentidad.decidir(session, 'v/1', 'approve', 'motivo')
    await clienteIdentidad.estadoWorker(session)
    console.log(JSON.stringify({
      calls: calls.map((c) => [c.method, c.url, c.bodyType, c.body, c.headers.Authorization, c.cache]),
      checks: [validarArchivoDni({ type: 'image/svg+xml', size: 20000 }), validarArchivoDni({ type: 'image/jpeg', size: 9 * 1024 * 1024 }), validarArchivoDni({ type: 'image/jpeg', size: 100 }), validarArchivoDni({ type: 'image/webp', size: 200000 })],
    }))
  `)
  assert.deepEqual(result.calls, [
    [
      'GET',
      'https://api.tus.test/tus/v1/provider/identity-verification',
      null,
      null,
      'Bearer token-1',
      'no-store',
    ],
    [
      'POST',
      'https://api.tus.test/tus/v1/provider/identity-verification/consent',
      'json',
      { accepted: true, consentVersion: 'identidad-prestador-v1' },
      'Bearer token-1',
      'no-store',
    ],
    [
      'PUT',
      'https://api.tus.test/tus/v1/provider/identity-verification/documents/front',
      'blob',
      null,
      'Bearer token-1',
      'no-store',
    ],
    [
      'POST',
      'https://api.tus.test/tus/v1/provider/identity-verification/submit',
      'json',
      {},
      'Bearer token-1',
      'no-store',
    ],
    [
      'POST',
      'https://api.tus.test/tus/v1/admin/identity-verifications/v%2F1/decision',
      'json',
      { decision: 'approve', reason: 'motivo' },
      'Bearer token-1',
      'no-store',
    ],
    [
      'GET',
      'https://api.tus.test/tus/v1/admin/identity-worker',
      null,
      null,
      'Bearer token-1',
      'no-store',
    ],
  ])
  assert.equal(result.checks[0], 'Subí una foto JPG, PNG o WEBP.')
  assert.match(result.checks[1], /8 MB/u)
  assert.match(result.checks[2], /demasiado chica/u)
  assert.equal(result.checks[3], null)
})

test('IDENTITY-NOSIS Web surfaces: provider section, required states and consent text; admin page with worker 7/h and reasoned decisions', () => {
  const provider = read('apps/web/src/components/prestador/verificacion-identidad.tsx')
  const lib = read('apps/web/src/lib/tus-identidad.ts')
  const admin = read('apps/web/src/components/admin/verificaciones-identidad.tsx')
  const surface = read('apps/web/src/app/tus/tus-prestador.tsx')
  assert.match(provider, /Verificación de identidad\./u)
  for (const label of [
    'Pendiente',
    'En cola',
    'Verificando',
    'En revisión',
    'Verificado',
    'Rechazado',
  ])
    assert.match(lib, new RegExp(`'${label}'`, 'u'), label)
  assert.match(provider, /view\.consentText/u)
  assert.match(provider, /accept="image\/jpeg,image\/png,image\/webp"/u)
  assert.match(surface, /<VerificacionIdentidad/u)
  assert.match(admin, /Verificaciones de identidad/u)
  assert.match(admin, /\{worker\.used\} \/ \{worker\.max\} consultas/u)
  assert.match(admin, /Aprobar manualmente/u)
  assert.match(admin, /Reautenticar Nosis/u)
  assert.match(admin, /URL\.revokeObjectURL/u)
  // The browser never talks to Nosis or Groq directly.
  for (const source of [provider, lib, admin])
    assert.doesNotMatch(source, /nosis\.com|api\.groq\.com|GROQ_API_KEY/u)
})
