import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

test('PR1 accepts only internal return paths and rejects external deep links', () => {
  const result = runTypeScriptScenario(`
    const { sanitizeTusReturnTo } = (await import('./apps/web/src/lib/tus-auth-client.ts')).default
    console.log(JSON.stringify({
      internal: sanitizeTusReturnTo('/tus/pos?surface=staff'),
      external: sanitizeTusReturnTo('https://evil.example/steal'),
      protocolRelative: sanitizeTusReturnTo('//evil.example/steal'),
      fallback: sanitizeTusReturnTo(undefined),
    }))
  `)

  assert.equal(result.internal, '/tus/pos?surface=staff')
  assert.equal(result.external, '/tus')
  assert.equal(result.protocolRelative, '/tus')
  assert.equal(result.fallback, '/tus')
})

test('PR1 persists only the confirmed bearer credential in session-scoped storage', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebAuthClient } = (await import('./apps/web/src/lib/tus-auth-client.ts')).default
    const requests = []
     let stored = null
     let writeCalled = false
    const client = createTusWebAuthClient({
      transport: { request: async (input) => {
        requests.push(input)
        if (input.path === '/auth/sign-in') return { session: { id: 'session-1', accessToken: 'secret', accountId: 'actor-1', tenantId: 'tenant-1', deviceId: 'browser', scope: { tenantId: 'tenant-1', roles: ['member'], permissions: ['tus:read'] }, expiresAt: 4102444800000 } }
        return { context: { subjectId: 'actor-1', sessionId: 'session-1', tenantId: 'tenant-1', roles: ['member'], permissions: ['tus:read'], correlationId: input.correlationId } }
      } },
        storage: { read: () => stored, write: (value) => { stored = value; writeCalled = true }, clear: () => { stored = null } },
      createCorrelationId: () => 'corr-pr1',
    })
    const state = await client.signIn({ email: 'person@example.com', password: 'secret-password' })
     console.log(JSON.stringify({ state, stored, writeCalled, requests }))
  `)

  assert.equal(result.state.status, 'authenticated')
  assert.equal(result.state.session.tenantId, 'tenant-1')
  assert.equal(result.state.session.subjectId, 'actor-1')
   assert.deepEqual(JSON.parse(result.stored), { accessToken: 'secret', expiresAt: 4102444800000 })
   assert.equal(result.writeCalled, true)
  assert.deepEqual(
    result.requests.map(({ path, body }) => ({ path, body })),
    [
      { path: '/auth/sign-in', body: { email: 'person@example.com', password: 'secret-password' } },
      { path: '/auth/session', body: undefined },
    ]
  )
})

test('PR1 rejects a persisted credential when the server revokes its session', async () => {
  const result = runTypeScriptScenario(`
    const { createTusWebAuthClient } = (await import('./apps/web/src/lib/tus-auth-client.ts')).default
    let stored = JSON.stringify({ accessToken: 'revoked-secret', expiresAt: 4102444800000 })
    const client = createTusWebAuthClient({
      transport: { request: async () => { const error = new Error('unauthorized'); error.status = 401; throw error } },
      storage: { read: () => stored, write: (value) => { stored = value }, clear: () => { stored = null } },
      now: () => 1700000000000,
    })
    const state = await client.restore('/tus/operations')
    console.log(JSON.stringify({ state, stored }))
  `)

   assert.equal(result.state.status, 'expired')
  assert.equal(result.state.returnTo, '/tus/operations')
  assert.equal(result.stored, null)
})

test('PR1 never fabricates web identity from malformed or client-authored session data', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebAuthClient } = (await import('./apps/web/src/lib/tus-auth-client.ts')).default
    let stored = JSON.stringify({ accessToken: '', expiresAt: 0, tenantId: 'foreign-tenant' })
    const requests = []
    const client = createTusWebAuthClient({
      transport: { request: async (input) => { requests.push(input); return { context: { subjectId: 'server-actor', sessionId: 'server-session', tenantId: 'server-tenant', roles: [], permissions: [], correlationId: 'server-correlation' } } } },
      storage: { read: () => stored, write: (value) => { stored = value }, clear: () => { stored = null } },
    })
    const state = await client.restore()
    console.log(JSON.stringify({ state, stored, requests }))
  `)

  assert.equal(result.state.status, 'unauthenticated')
  assert.equal(result.stored, null)
  assert.deepEqual(result.requests, [])
})

test('PR1 distinguishes missing credentials from unavailable storage without leaking failures', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebAuthClient } = (await import('./apps/web/src/lib/tus-auth-client.ts')).default
    const missing = createTusWebAuthClient({ storage: { read: () => null, write: () => undefined, clear: () => undefined }, transport: { request: async () => ({}) } })
    const unavailable = createTusWebAuthClient({ storage: { read: () => { throw new Error('storage secret') }, write: () => undefined, clear: () => undefined }, transport: { request: async () => ({}) } })
    console.log(JSON.stringify({ missing: await missing.restore(), unavailable: await unavailable.restore() }))
  `)

  assert.equal(result.missing.status, 'unauthenticated')
   assert.equal(result.unavailable.status, 'unavailable')
  assert.doesNotMatch(JSON.stringify(result.unavailable), /storage secret/)
})

test('PR3 gives public and recovery pages semantic landmarks and descriptive headings', () => {
  const page = readFileSync(join(root, 'apps/web/src/app/page.tsx'), 'utf8')
  const recovery = readFileSync(join(root, 'apps/web/src/app/(auth)/recovery/page.tsx'), 'utf8')

  for (const source of [page, recovery]) {
    assert.match(source, /<TusSkipLink\s*\/?\s*>/)
    assert.match(source, /id="tus-main-content"/)
    assert.match(source, /<nav[^>]+aria-label=/)
    assert.match(source, /<h1[\s>]/)
  }
  assert.match(page, /<h3>/)
  assert.doesNotMatch(page, /<h2>/)
  assert.match(page, /<Link[^>]+href="\/sign-in"/)
  assert.match(recovery, /href=\{`\/sign-in\?returnTo=/)
})

test('PR3 keeps web actions keyboard-safe, stateful, and honestly recoverable', () => {
  const ui = readFileSync(join(root, 'apps/web/src/app/tus/tus-ui.tsx'), 'utf8')
  const dashboard = readFileSync(join(root, 'apps/web/src/app/tus/tus-dashboard.tsx'), 'utf8')
  const operations = readFileSync(join(root, 'apps/web/src/app/tus/tus-operations.tsx'), 'utf8')
  const pos = readFileSync(join(root, 'apps/web/src/app/tus/tus-pos.tsx'), 'utf8')

  assert.match(ui, /aria-live/)
  assert.match(ui, /aria-busy/)
  assert.match(ui, /disabled: disabled \|\| loading/)
  assert.match(ui, /Retry \$\{state\.resource \?\? 'request'\}/)
  assert.match(dashboard, /onClick=\{\(\) => setRefreshKey[\s\S]*?type="button"/)
  assert.match(dashboard, /signingOut/)
  assert.match(dashboard, /disabled=\{signingOut\}/)
  assert.match(dashboard, /window\.confirm\(/)
  assert.match(operations, /<TusActionButton[\s\S]*?onClick=\{data\.report\.retry\}[\s\S]*?disabled=\{reportLoading\}[\s\S]*?type="button"/)
  assert.match(operations, /aria-label="Refresh server report"/)
  assert.match(pos, /aria-invalid=\{amountError !== null\}/)
  assert.match(pos, /aria-live=\{[\s\S]*feedback\.status === 'conflict'/)
  assert.match(pos, /loadingLabel="Waiting for TUS…"/)
})

test('PR3 gives the unresolved /tus session state its skip target and sole main landmark', () => {
  const dashboard = readFileSync(join(root, 'apps/web/src/app/tus/tus-dashboard.tsx'), 'utf8')
  const layout = readFileSync(join(root, 'apps/web/src/app/tus/layout.tsx'), 'utf8')
  const shell = readFileSync(join(root, 'apps/web/src/components/layout/tus-app-shell.tsx'), 'utf8')
  const loadingBranch = dashboard.slice(
    dashboard.indexOf('if (session === undefined)'),
    dashboard.indexOf('if (session === null)')
  )

  assert.match(layout, /<TusAppShell>\{children\}<\/TusAppShell>/)
  assert.match(shell, /<a className="tus-skip-link" href="#tus-main-content">/)
  assert.match(shell, /<main[^>]+id="tus-main-content"/)
  assert.equal((shell.match(/id="tus-main-content"/g) ?? []).length, 1)
  assert.match(loadingBranch, /status: 'loading'/)
  assert.match(loadingBranch, /Restoring your secure session/)
  assert.doesNotMatch(loadingBranch, /Tenant scope:|Operational truth|tenant-owned/i)
})

test('PR3 exposes focused, pressed, reduced-motion, and long-content-safe CSS contracts', () => {
  const css = readFileSync(join(root, 'apps/web/src/app/globals.css'), 'utf8')

  assert.match(css, /:where\(a, button, input, select\):focus-visible/)
  assert.match(css, /\.tus-action-button:hover/)
  assert.match(css, /\.tus-action-button:active/)
  assert.match(css, /\.tus-card-footer:hover/)
  assert.match(css, /\.tus-surface-tabs a:hover/)
  assert.match(css, /\.tus-card\s*\{[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(css, /touch-action:\s*manipulation/)
  assert.match(css, /min-height:\s*44px/)
  assert.match(css, /overflow-wrap:\s*anywhere/)
  assert.match(css, /min-width:\s*0/)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(css, /scroll-behavior:\s*auto\s*!important/)
  assert.doesNotMatch(css, /transition:\s*all/)
})
