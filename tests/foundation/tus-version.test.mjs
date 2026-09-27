import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// GET /version: identifica el build que corre en producción (SHA compilado + hora de build + hora
// de arranque del proceso) para verificar un deploy sin adivinar por comportamiento.
const root = join(import.meta.dirname, '..', '..')

test('VERSION build: the commit comes from git or a known build variable, never anything else', async () => {
  const { resolveBuildCommit } = await import('../../scripts/build-api.mjs')
  const sha = '8c9291d6dc227290417999d16345e9cbf0133ab3'
  assert.equal(resolveBuildCommit({}, () => sha), sha)
  assert.equal(resolveBuildCommit({ TUS_BUILD_SHA: 'abcdef1' }, () => null), 'abcdef1')
  assert.equal(resolveBuildCommit({ SOURCE_COMMIT: sha }, () => null), sha)
  assert.equal(resolveBuildCommit({ TUS_BUILD_SHA: 'postgresql://secret' }, () => 'not-a-sha'), 'unknown')
  assert.equal(resolveBuildCommit({}, () => null), 'unknown')
  const script = readFileSync(join(root, 'scripts/build-api.mjs'), 'utf8')
  assert.match(script, /writeFileSync\(join\(apiRoot, 'dist', 'build-info\.json'\)/u)
})

test('VERSION runtime: reads dist/build-info.json, validates it, falls back safely and exposes only public fields', () => {
  const result = runTypeScriptScenario(`
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { leerVersionApi, createVersionRouter } = await import('./apps/api/src/presentation/routes/version.ts')
    const files = new Map([
      ['/app/dist/build-info.json', JSON.stringify({ service: 'tus-api', commit: '8c9291d6dc22', builtAt: '2026-09-27T14:15:03.854Z', secret: 'x' })],
      ['/bad/dist/build-info.json', '{not json'],
      ['/evil/dist/build-info.json', JSON.stringify({ commit: 'postgresql://user:pass@host/db' })],
    ])
    const read = (path) => files.get(path.replaceAll('\\\\', '/')) ?? null
    const ok = leerVersionApi({}, '/app', read)
    const bad = leerVersionApi({ TUS_BUILD_SHA: 'abcdef1' }, '/bad', read)
    const evil = leerVersionApi({}, '/evil', read)
    const app = express(); app.use(createVersionRouter(ok))
    const server = app.listen(0)
    try {
      const res = await fetch('http://127.0.0.1:' + server.address().port + '/version')
      console.log(JSON.stringify({ ok, bad, evil, http: [res.status, res.headers.get('cache-control'), await res.json()] }))
    } finally { server.close() }
  `)
  assert.deepEqual(Object.keys(result.ok).sort(), ['builtAt', 'commit', 'service', 'startedAt'])
  assert.equal(result.ok.commit, '8c9291d6dc22')
  assert.equal(result.ok.builtAt, '2026-09-27T14:15:03.854Z')
  assert.match(result.ok.startedAt, /^\d{4}-\d{2}-\d{2}T/u)
  assert.equal(result.bad.commit, 'abcdef1', 'invalid file falls back to the build variable')
  assert.equal(result.evil.commit, 'unknown', 'anything that is not a SHA is never exposed')
  assert.equal(result.http[0], 200)
  assert.equal(result.http[1], 'no-store')
  assert.doesNotMatch(JSON.stringify(result.http[2]), /secret|postgresql|pass/u)
  const server = readFileSync(join(root, 'apps/api/src/server.ts'), 'utf8')
  assert.match(server, /app\.use\(createVersionRouter\(\)\)/u)
})
