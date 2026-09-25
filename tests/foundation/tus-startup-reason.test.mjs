import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Arranque de la API: el log de fallo dice POR QUÉ (código seguro) sin filtrar URL, host,
// usuario ni mensajes. En Hostinger solo se veía "API startup failed; diagnostics redacted".
test('STARTUP reason: TLS, auth, network, Prisma and missing tables become safe codes; secrets never leak', () => {
  const result = runTypeScriptScenario(`
    const { safeStartupReason, withBoundedDatabaseStartupRetry } = await import('./apps/api/src/infrastructure/database/postgres/pool.ts')
    const { createDatabaseLifecycle } = await import('./apps/api/src/infrastructure/database/lifecycle.ts')
    const secret = 'postgresql://user:s3cr3t@db.example.com:5432/postgres'
    const tls = Object.assign(new Error('self-signed certificate in certificate chain ' + secret), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })
    const reasons = {
      tls: safeStartupReason(tls),
      auth: safeStartupReason(Object.assign(new Error(secret), { code: '28P01' })),
      dns: safeStartupReason(Object.assign(new Error(secret), { cause: { code: 'ENOTFOUND' } })),
      prisma: safeStartupReason(Object.assign(new Error(secret), { errorCode: 'P1001' })),
      tables: safeStartupReason({ missingTables: ['reembolsos_servicio', 'bad table; drop'] }),
      plain: safeStartupReason(new Error(secret)),
      weird: safeStartupReason({ code: secret }),
    }
    let retried = null
    try {
      await withBoundedDatabaseStartupRetry(async () => { throw tls }, { attemptTimeoutMs: 50, backoffMs: 1, sleep: async () => undefined })
    } catch (error) { retried = { message: error.message, reason: error.reason, json: JSON.stringify(error) } }
    const lifecycle = createDatabaseLifecycle({
      config: { databaseUrl: secret, dbAttemptTimeoutMs: 50, dbMaxAttempts: 2 },
      poolFactory: () => ({ query: async () => ({ rows: [] }), end: async () => undefined }),
      prismaConnector: async () => undefined,
      prismaDisconnector: async () => undefined,
      closePool: async () => undefined,
      sleep: async () => undefined,
    })
    let schema = null
    try { await lifecycle.connect() } catch (error) { schema = error.reason }
    console.log(JSON.stringify({ reasons, retried, schema }))
  `)
  assert.deepEqual(result.reasons, {
    tls: 'SELF_SIGNED_CERT_IN_CHAIN',
    auth: '28P01',
    dns: 'ENOTFOUND',
    prisma: 'P1001',
    tables: 'SCHEMA_INCOMPLETE:reembolsos_servicio',
    plain: 'Error',
    weird: 'UNKNOWN',
  })
  assert.doesNotMatch(result.reasons.weird, /s3cr3t|example\.com|postgresql/u)
  assert.equal(result.retried.message, 'PostgreSQL startup failed after two bounded attempts; diagnostics redacted')
  assert.equal(result.retried.reason, 'SELF_SIGNED_CERT_IN_CHAIN')
  assert.doesNotMatch(result.retried.json, /s3cr3t|example\.com/u)
  assert.match(result.schema, /^SCHEMA_INCOMPLETE:evidencias_habilitacion,decisiones_habilitacion,configuraciones_pagos_servicio,reembolsos_servicio$/u)
})
