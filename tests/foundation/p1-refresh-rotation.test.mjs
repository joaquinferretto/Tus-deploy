import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

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

function baseScenarioImports() {
  return `
    const { RefreshRotationService } = (await import('./apps/api/src/auth-security/application/refresh/refresh-service.ts')).default
    const { InMemoryRefreshRotationStore } = (await import('./apps/api/src/auth-security/adapters/in-memory-refresh-rotation-store.ts')).default
    const { InMemoryOutbox } = (await import('./apps/api/src/auth-security/adapters/in-memory-outbox.ts')).default
    const { InMemorySessionRevocation } = (await import('./apps/api/src/auth-security/adapters/in-memory-session-revocation.ts')).default
    const now = { value: 1700000000000 }
    const ids = { next: (() => { let value = 0; return () => 'id-' + (++value) })() }
    const tokens = { issue: (() => { let value = 0; return () => 'token-' + (++value) })(), digest: (value) => 'digest:' + value }
    const outbox = new InMemoryOutbox()
    const sessions = new InMemorySessionRevocation()
    const store = new InMemoryRefreshRotationStore({ outbox, sessions })
    const service = new RefreshRotationService({ store, clock: { now: () => now.value }, ids, tokens, refreshTtlMs: 3600000 })
  `
}

test('refresh rotation atomically replaces the token and emits a redacted outbox event', () => {
  const result = runTypeScriptScenario(`
    ${baseScenarioImports()}
    const issued = await service.createFamily({ accountId: 'account-a', tenantId: 'tenant-a', deviceId: 'device-a', sessionId: 'session-a' })
    const rotated = await service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'request-a' })
    console.log(JSON.stringify({
      ok: rotated.ok,
      accessChanged: rotated.ok && rotated.accessToken !== issued.accessToken,
      refreshChanged: rotated.ok && rotated.refreshToken !== issued.refreshToken,
      familyGeneration: store.families.get(issued.familyId)?.generation,
      event: outbox.events[0],
    }))
  `)

  assert.equal(result.ok, true)
  assert.equal(result.accessChanged, true)
  assert.equal(result.refreshChanged, true)
  assert.equal(result.familyGeneration, 1)
  assert.deepEqual(result.event, {
    contractVersion: '1.0.0',
    type: 'auth.refresh_rotated',
    aggregateType: 'refresh_token_family',
    aggregateId: 'id-1',
    occurredAt: '2023-11-14T22:13:20.000Z',
    payload: {
      accountId: 'account-a',
      tenantId: 'tenant-a',
      deviceId: 'device-a',
      sessionId: 'session-a',
      generation: 1,
    },
  })
  assert.equal(JSON.stringify(result.event).includes('token-'), false)
  assert.equal(JSON.stringify(result.event).includes('digest:'), false)
})

test('concurrent reuse allows one winner, compromises the family, and revokes the device session', () => {
  const result = runTypeScriptScenario(`
    ${baseScenarioImports()}
    const issued = await service.createFamily({ accountId: 'account-a', tenantId: 'tenant-a', deviceId: 'device-a', sessionId: 'session-a' })
    const results = await Promise.all([
      service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'request-a' }),
      service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'request-b' }),
    ])
    console.log(JSON.stringify({
      winners: results.filter((item) => item.ok).length,
      replayCodes: results.filter((item) => !item.ok).map((item) => item.code),
      family: store.families.get(issued.familyId),
      revokedSessions: sessions.revoked,
      eventTypes: outbox.events.map((event) => event.type),
    }))
  `)

  assert.equal(result.winners, 1)
  assert.deepEqual(result.replayCodes, ['REFRESH_TOKEN_REPLAY'])
  assert.equal(result.family.compromisedAt, 1700000000000)
  assert.equal(result.family.revokedAt, 1700000000000)
  assert.deepEqual(result.revokedSessions, [
    { accountId: 'account-a', deviceId: 'device-a', revokedAt: 1700000000000 },
  ])
  assert.deepEqual(result.eventTypes.sort(), [
    'auth.refresh_family_compromised',
    'auth.refresh_rotated',
  ])
})

test('expiry and explicit family revocation deny without publishing a rotation event', () => {
  const result = runTypeScriptScenario(`
    ${baseScenarioImports()}
    const issued = await service.createFamily({ accountId: 'account-a', tenantId: 'tenant-a', deviceId: 'device-a', sessionId: 'session-a' })
    now.value += 3600001
    const expired = await service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'expired' })
    await store.revokeFamily(issued.familyId, now.value)
    const revoked = await service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'revoked' })
    console.log(JSON.stringify({ expired, revoked, eventCount: outbox.events.length, revokedAt: store.families.get(issued.familyId)?.revokedAt }))
  `)

  assert.deepEqual(result.expired, {
    ok: false,
    code: 'REFRESH_TOKEN_EXPIRED',
    familyCompromised: false,
  })
  assert.deepEqual(result.revoked, {
    ok: false,
    code: 'REFRESH_FAMILY_REVOKED',
    familyCompromised: false,
  })
  assert.equal(result.eventCount, 0)
  assert.equal(result.revokedAt, 1700003600001)
})

test('same idempotency key returns the original result without a second rotation or event', () => {
  const result = runTypeScriptScenario(`
    ${baseScenarioImports()}
    const issued = await service.createFamily({ accountId: 'account-a', tenantId: 'tenant-a', deviceId: 'device-a', sessionId: 'session-a' })
    const first = await service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'same-request' })
    const second = await service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'same-request' })
    console.log(JSON.stringify({ first, second, generation: store.families.get(issued.familyId)?.generation, eventCount: outbox.events.length }))
  `)

  assert.deepEqual(result.second, result.first)
  assert.equal(result.generation, 1)
  assert.equal(result.eventCount, 1)
})

test('concurrent retries with the same idempotency key share one issued token pair', () => {
  const result = runTypeScriptScenario(`
    ${baseScenarioImports()}
    const issued = await service.createFamily({ accountId: 'account-a', tenantId: 'tenant-a', deviceId: 'device-a', sessionId: 'session-a' })
    const results = await Promise.all([
      service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'same-concurrent-request' }),
      service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'same-concurrent-request' }),
    ])
    console.log(JSON.stringify({
      sameAccessToken: results[0].ok && results[0].accessToken === results[1].accessToken,
      sameRefreshToken: results[0].ok && results[0].refreshToken === results[1].refreshToken,
      generations: results.map((item) => item.ok ? item.generation : null),
      eventCount: outbox.events.length,
    }))
  `)

  assert.equal(result.sameAccessToken, true)
  assert.equal(result.sameRefreshToken, true)
  assert.deepEqual(result.generations, [1, 1])
  assert.equal(result.eventCount, 1)
})

test('outbox failure rolls back the family, replacement token, and session side effects', () => {
  const result = runTypeScriptScenario(`
    ${baseScenarioImports()}
    outbox.fail = true
    const issued = await service.createFamily({ accountId: 'account-a', tenantId: 'tenant-a', deviceId: 'device-a', sessionId: 'session-a' })
    let errorCode = null
    try { await service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'outbox-failure' }) } catch (error) { errorCode = error.code }
    const family = store.families.get(issued.familyId)
    console.log(JSON.stringify({ errorCode, generation: family?.generation, currentTokenDigest: family?.currentTokenDigest, revokedSessions: sessions.revoked, eventCount: outbox.events.length }))
  `)

  assert.equal(result.errorCode, 'OUTBOX_APPEND_FAILED')
  assert.equal(result.generation, 0)
  assert.equal(result.currentTokenDigest, 'digest:token-1')
  assert.deepEqual(result.revokedSessions, [])
  assert.equal(result.eventCount, 0)
})

test('restart recovery preserves a rotated family and the atomic SQL adapter requires a lock and parameters', () => {
  const result = runTypeScriptScenario(`
    ${baseScenarioImports()}
    const issued = await service.createFamily({ accountId: 'account-a', tenantId: 'tenant-a', deviceId: 'device-a', sessionId: 'session-a' })
    await service.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'restart' })
    const snapshot = store.exportState()
    const restarted = new InMemoryRefreshRotationStore({ outbox: new InMemoryOutbox(), sessions: new InMemorySessionRevocation(), state: snapshot })
    const restartedService = new RefreshRotationService({ store: restarted, clock: { now: () => now.value }, ids, tokens, refreshTtlMs: 3600000 })
    const replay = await restartedService.rotate({ refreshToken: issued.refreshToken, idempotencyKey: 'after-restart' })
    console.log(JSON.stringify({ replay, generation: restarted.families.get(issued.familyId)?.generation }))
  `)
  const sql = readFileSync(
    join(root, 'apps/api/src/auth-security/adapters/postgres/sql/refresh-rotation.sql.ts'),
    'utf8'
  )

  assert.deepEqual(result.replay, {
    ok: false,
    code: 'REFRESH_TOKEN_REPLAY',
    familyCompromised: true,
  })
  assert.equal(result.generation, 1)
  assert.match(sql, /FOR UPDATE/)
  assert.match(sql, /\$1|\$2|\$3/)
  assert.equal(sql.includes('${'), false)
})
