import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { IDENTITY_SETUP } from './fixtures/identidad.mjs'
import { MI_NOSIS_MOCK_SETUP } from './fixtures/mi-nosis-mock.mjs'

// Real headless Chromium (playwright-core) against a local Mi Nosis mock. No real person and
// no real Nosis endpoint is ever contacted.

test('IDENTITY-NOSIS browser: login with the native checkbox, encrypted session reuse, DNI-only search, only DNI/name/CUIL read', () => {
  const result = runTypeScriptScenario(`${MI_NOSIS_MOCK_SETUP}
    try {
      let slots = 0
      const slot = async () => { slots += 1; return true }
      const first = newBrowserProvider()
      await first.prepararSesion()
      const single = await first.consultar({ documentNumber: '30111222' }, slot)
      const none = await first.consultar({ documentNumber: '30111223' }, slot)
      const many = await first.consultar({ documentNumber: '30111224' }, slot)
      await first.cerrar()
      const stored = sessionBackend.rows.get('nosis-browser')
      const token = [...mock.sessions][0]
      // A new process reuses the encrypted session: no new login.
      const second = newBrowserProvider({ autoLogin: false })
      await second.prepararSesion()
      const again = await second.consultar({ documentNumber: '30111222' }, slot)
      console.log(JSON.stringify({ logins: mock.logins, checkbox: mock.checkboxSeen, single, none: none.results, many: many.results.length, again: again.results.length, slots, searches: mock.searches, storedPlain: stored.ciphertext.includes(token) || stored.ciphertext.includes('mn_session'), keyVersion: stored.keyVersion }))
    } finally { await shutdown() }
  `)
  assert.equal(result.logins, 1)
  assert.deepEqual(result.checkbox, [true])
  assert.deepEqual(result.single.results, [
    { documentNumber: '30111222', fullName: 'PRUEBA DEMO, JUAN', cuil: '20301112220' },
  ])
  assert.deepEqual(Object.keys(result.single.results[0]).sort(), [
    'cuil',
    'documentNumber',
    'fullName',
  ])
  assert.deepEqual(result.none, [])
  assert.equal(result.many, 2)
  assert.equal(result.again, 1)
  assert.equal(result.slots, 4)
  assert.ok(
    result.searches.every((search) => search.tipo === 'doc'),
    'only document searches'
  )
  assert.equal(result.storedPlain, false)
  assert.equal(result.keyVersion, 'v1')
})

test('IDENTITY-NOSIS browser: external challenge is never clicked, expired session and layout change are detected, no slot without submit', () => {
  const result = runTypeScriptScenario(`${MI_NOSIS_MOCK_SETUP}
    try {
      let slots = 0
      const slot = async () => { slots += 1; return true }
      mock.mode.loginChallenge = true
      const challenged = await errorOf(() => newBrowserProvider().prepararSesion())
      const loginsAfterChallenge = mock.logins
      mock.mode.loginChallenge = false
      const noAutoLogin = await errorOf(() => newBrowserProvider({ autoLogin: false }).prepararSesion())
      const provider = newBrowserProvider()
      await provider.prepararSesion()
      mock.sessions.clear()
      const expired = await errorOf(() => provider.consultar({ documentNumber: '30111222' }, slot))
      const slotsAfterExpired = slots
      await provider.prepararSesion()
      const denied = await errorOf(() => provider.consultar({ documentNumber: '30111222' }, async () => false))
      const searchesAfterDenied = mock.searches.length
      mock.mode.layoutChanged = true
      const layout = await errorOf(() => provider.consultar({ documentNumber: '30111222' }, slot))
      console.log(JSON.stringify({ challenged, loginsAfterChallenge, noAutoLogin, expired, slotsAfterExpired, denied, searchesAfterDenied, layout, slots, searches: mock.searches.length }))
    } finally { await shutdown() }
  `)
  assert.deepEqual(result.challenged, ['NOSIS_CHALLENGE_REQUIRED', false])
  assert.equal(
    result.loginsAfterChallenge,
    0,
    'the login form is never submitted when a challenge is present'
  )
  assert.deepEqual(result.noAutoLogin, ['NOSIS_SESSION_REQUIRED', false])
  assert.deepEqual(result.expired, ['NOSIS_SESSION_REQUIRED', false])
  assert.equal(result.slotsAfterExpired, 0)
  assert.deepEqual(result.denied, ['NOSIS_RATE_LIMITED', false])
  assert.equal(result.searchesAfterDenied, 0)
  assert.deepEqual(result.layout, ['NOSIS_LAYOUT_CHANGED', true])
  assert.equal(result.slots, 1)
  assert.equal(result.searches, 1)
})

test('IDENTITY-NOSIS browser: full pipeline through the worker with the Chromium provider', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}${MI_NOSIS_MOCK_SETUP}
    try {
      const browserProvider = newBrowserProvider()
      const browserWorker = makeWorker('browser-worker', browserProvider)
      await submitIdentity(1, '30111222|PRUEBA DEMO|JUAN')
      const outcomes = []
      for (let i = 0; i < 4; i += 1) { const r = await browserWorker.procesarSiguiente(); outcomes.push(r.outcome); if (r.outcome === 'idle') break }
      const v = await latest(1)
      console.log(JSON.stringify({ outcomes, status: v.status, method: v.verificationMethod, cuil: v.verifiedCuil, slots: identityStore.state.consultas.length }))
    } finally { await shutdown() }
  `)
  assert.deepEqual(result.outcomes, ['read', 'checked', 'idle'])
  assert.equal(result.status, 'verified')
  assert.equal(result.method, 'nosis_browser')
  assert.equal(result.cuil, '20301112220')
  assert.equal(result.slots, 1)
})
