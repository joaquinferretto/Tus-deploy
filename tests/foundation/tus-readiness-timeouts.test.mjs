import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

const requireApiDependency = createRequire(join(import.meta.dirname, '..', '..', 'apps/api/package.json'))
const express = requireApiDependency('express')

const { createHealthRouter, READY_POSTGRES_TIMEOUT_MS, READY_OPTIONAL_TIMEOUT_MS, READY_TOTAL_TIMEOUT_MS } = await import('../../apps/api/src/presentation/routes/health.ts')
const { createDatabaseLifecycle } = await import('../../apps/api/src/infrastructure/database/lifecycle.ts')

const SECRET_URL = 'postgresql://tus_user:super-secret-pass@db.example.internal:5432/tus'
const okSchema = { compatible: true, activation: 'active', missing: [], migration: 'forward-only' }
const never = () => new Promise(() => {})
// Fast timeouts so a hanging probe is detected in milliseconds, never waited for.
const fast = { postgresMs: 150, optionalMs: 100, totalMs: 400 }

function withEnv(values, fn) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })
}

// Every request is bounded by the client too: a regression can only fail, never hang the suite.
function request(router, path = '/ready') {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(router)
    const server = createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const started = performance.now()
      fetch(`http://127.0.0.1:${server.address().port}${path}`, { signal: AbortSignal.timeout(5000) })
        .then(async (response) => resolve({ status: response.status, body: await response.json(), ms: performance.now() - started }))
        .catch(reject)
        .finally(() => server.close())
    })
    server.on('error', reject)
  })
}

const nativeEnv = { NATIVE_PROFILE: '1', NATIVE_MONGODB_MODE: undefined, NATIVE_REDIS_MODE: undefined }

test('readiness defaults stay below the reverse proxy timeout', () => {
  assert.equal(READY_POSTGRES_TIMEOUT_MS, 2500)
  assert.equal(READY_OPTIONAL_TIMEOUT_MS, 1500)
  assert.ok(READY_TOTAL_TIMEOUT_MS < 3000)
  assert.ok(READY_POSTGRES_TIMEOUT_MS < READY_TOTAL_TIMEOUT_MS)
})

test('PostgreSQL OK: 200, Mongo and Redis reported disabled and never loaded or contacted', () =>
  withEnv(nativeEnv, async () => {
    const touched = []
    const result = await request(createHealthRouter({
      timeouts: fast,
      probes: {
        postgresConnection: async () => true,
        postgresSchema: async () => okSchema,
        mongodb: async () => { touched.push('mongodb'); return false },
        redis: async () => { touched.push('redis'); return false },
      },
    }))
    assert.equal(result.status, 200)
    assert.equal(result.body.ready, true)
    assert.equal(result.body.status, 'ready')
    assert.equal(result.body.summary.postgres, 'ok')
    assert.equal(result.body.summary.mongodb, 'disabled')
    assert.equal(result.body.summary.redis, 'disabled')
    assert.equal(result.body.dependencies.postgres.check, 'ok')
    assert.equal(typeof result.body.dependencies.postgres.latencyMs, 'number')
    assert.deepEqual(touched, [], 'disabled dependencies are not probed')
  }))

test('PostgreSQL unavailable: 503 not-ready without driver details', () =>
  withEnv(nativeEnv, async () => {
    const result = await request(createHealthRouter({
      timeouts: fast,
      probes: {
        postgresConnection: async () => { throw Object.assign(new Error(`connect ECONNREFUSED ${SECRET_URL}`), { code: 'ECONNREFUSED', stack: 'at pg/lib/client.js' }) },
        postgresSchema: async () => okSchema,
      },
    }))
    assert.equal(result.status, 503)
    assert.equal(result.body.ready, false)
    assert.equal(result.body.status, 'not-ready')
    assert.equal(result.body.summary.postgres, 'unavailable')
    assert.equal(result.body.dependencies.postgres.blocksApiReadiness, true)
    const text = JSON.stringify(result.body)
    for (const leak of ['super-secret-pass', 'postgresql://', 'ECONNREFUSED', 'db.example.internal', 'pg/lib', 'DATABASE_URL', 'DIRECT_URL']) assert.equal(text.includes(leak), false, `leaked ${leak}`)
  }))

test('PostgreSQL connection probe returning false is unavailable', () =>
  withEnv(nativeEnv, async () => {
    const result = await request(createHealthRouter({ timeouts: fast, probes: { postgresConnection: async () => false, postgresSchema: async () => okSchema } }))
    assert.equal(result.status, 503)
    assert.equal(result.body.summary.postgres, 'unavailable')
  }))

test('PostgreSQL timeout: 503 within the PostgreSQL budget, not after the pool timeout', () =>
  withEnv(nativeEnv, async () => {
    const result = await request(createHealthRouter({ timeouts: fast, probes: { postgresConnection: never, postgresSchema: never } }))
    assert.equal(result.status, 503)
    assert.equal(result.body.summary.postgres, 'timeout')
    assert.equal(result.body.dependencies.postgres.check, 'timeout')
    assert.deepEqual(result.body.schema.missing, ['database-timeout'])
    assert.ok(result.ms < fast.totalMs + 300, `answered in ${Math.round(result.ms)} ms`)
  }))

test('schema query that hangs after a good connection is also a timeout', () =>
  withEnv(nativeEnv, async () => {
    const result = await request(createHealthRouter({ timeouts: fast, probes: { postgresConnection: async () => true, postgresSchema: never } }))
    assert.equal(result.status, 503)
    assert.equal(result.body.summary.postgres, 'timeout')
  }))

test('incomplete schema: 503 incomplete-schema, PostgreSQL itself reachable', () =>
  withEnv(nativeEnv, async () => {
    const result = await request(createHealthRouter({
      timeouts: fast,
      probes: { postgresConnection: async () => true, postgresSchema: async () => ({ compatible: false, activation: 'incomplete-schema', missing: ['barrios'], migration: 'unverified' }) },
    }))
    assert.equal(result.status, 503)
    assert.equal(result.body.status, 'incomplete-schema')
    assert.equal(result.body.summary.postgres, 'schema_incomplete')
    assert.equal(result.body.dependencies.postgres.status, 'ready')
    assert.deepEqual(result.body.schema.missing, ['barrios'])
  }))

test('optional dependency that fails or hangs is degraded and does not block readiness', () =>
  withEnv({ NATIVE_PROFILE: '1', NATIVE_MONGODB_MODE: 'optional', NATIVE_REDIS_MODE: 'optional' }, async () => {
    const result = await request(createHealthRouter({
      timeouts: fast,
      probes: { postgresConnection: async () => true, postgresSchema: async () => okSchema, mongodb: never, redis: async () => { throw new Error('redis://secret@host') } },
    }))
    assert.equal(result.status, 200)
    assert.equal(result.body.ready, true)
    assert.equal(result.body.summary.mongodb, 'degraded')
    assert.equal(result.body.summary.redis, 'degraded')
    assert.equal(JSON.stringify(result.body).includes('redis://'), false)
    assert.ok(result.ms < fast.totalMs + 300)
  }))

test('a required dependency that times out blocks readiness (existing profile semantics kept)', () =>
  withEnv({ NATIVE_PROFILE: '1', NATIVE_MONGODB_MODE: 'disabled', NATIVE_REDIS_MODE: 'required' }, async () => {
    const result = await request(createHealthRouter({
      timeouts: fast,
      probes: { postgresConnection: async () => true, postgresSchema: async () => okSchema, redis: never },
    }))
    assert.equal(result.status, 503)
    assert.equal(result.body.summary.redis, 'unavailable')
    assert.equal(result.body.summary.mongodb, 'disabled')
  }))

test('probes run in parallel: PostgreSQL and optional checks share the time budget', () =>
  withEnv({ NATIVE_PROFILE: '1', NATIVE_MONGODB_MODE: 'optional', NATIVE_REDIS_MODE: 'optional' }, async () => {
    const wait = (ms, value) => () => new Promise((resolve) => setTimeout(() => resolve(value), ms))
    const result = await request(createHealthRouter({
      timeouts: { postgresMs: 300, optionalMs: 300, totalMs: 500 },
      probes: { postgresConnection: wait(120, true), postgresSchema: async () => okSchema, mongodb: wait(120, true), redis: wait(120, true) },
    }))
    assert.equal(result.status, 200)
    assert.equal(result.body.summary.mongodb, 'ok')
    assert.ok(result.ms < 330, `parallel checks answered in ${Math.round(result.ms)} ms`)
  }))

test('the whole endpoint is capped even if a custom readiness source hangs', async () => {
  const result = await request(createHealthRouter({ timeouts: { totalMs: 150 }, getReadiness: never }))
  assert.equal(result.status, 503)
  assert.equal(result.body.ready, false)
  assert.equal(result.body.error, 'Readiness timed out')
  assert.ok(result.ms < 1000)
})

test('/health answers 200 while PostgreSQL hangs (liveness never touches the database)', async () => {
  const touched = []
  const router = createHealthRouter({ timeouts: fast, probes: { postgresConnection: () => { touched.push('pg'); return never() }, postgresSchema: never } })
  const result = await request(router, '/health')
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'ok')
  assert.deepEqual(touched, [])
})

test('database lifecycle probe runs SELECT 1 with a client-side query timeout on the active pool', async () => {
  const queries = []
  const pool = {
    query: async (input) => {
      queries.push(input)
      if (typeof input === 'object' && input.text === 'SELECT 1 AS ok') return { rowCount: 1, rows: [{ ok: 1 }] }
      return { rowCount: 4, rows: [{ table_name: 'evidencias_habilitacion' }, { table_name: 'decisiones_habilitacion' }, { table_name: 'configuraciones_pagos_servicio' }, { table_name: 'reembolsos_servicio' }] }
    },
    end: async () => {},
  }
  const lifecycle = createDatabaseLifecycle({
    config: { databaseUrl: 'postgresql://test@127.0.0.1:5432/test', dbAttemptTimeoutMs: 1000, dbMaxAttempts: 1 },
    poolFactory: () => pool,
    prismaConnector: async () => {},
    prismaDisconnector: async () => {},
    closePool: async () => {},
  })
  assert.equal(await lifecycle.checkConnection(2500), false, 'no pool before connect')
  await lifecycle.connect()
  assert.equal(await lifecycle.checkConnection(2500), true)
  const probe = queries.find((item) => typeof item === 'object' && item.text === 'SELECT 1 AS ok')
  assert.equal(probe.query_timeout, 2500)
  await withEnv(nativeEnv, async () => {
    const result = await request(createHealthRouter({ databaseLifecycle: lifecycle, timeouts: fast }))
    assert.equal(result.status, 200)
    assert.equal(result.body.summary.postgres, 'ok')
    assert.equal(result.body.schema.compatible, true)
  })
  await lifecycle.close()
})

// Optional capabilities (WhatsApp, Groq, speech to text, receipt OCR, pdftotext) are REPORTED by
// /ready; they never decide it.
test('optional capabilities: reported under `capabilities`, never blocking; a failing or hanging reporter says "unknown" and /ready keeps its own answer', () =>
  withEnv(nativeEnv, async () => {
    const probes = { postgresConnection: async () => true, postgresSchema: async () => okSchema }
    const todas = {
      whatsapp: { status: 'disabled', reason: 'not_enabled' },
      groq: { status: 'disabled', reason: 'not_configured' },
      audioTranscription: { status: 'unavailable', reason: 'groq_not_configured' },
      receiptImages: { status: 'unavailable', reason: 'ocr:language_data_missing' },
      receiptPdf: { status: 'unavailable', reason: 'ocr:missing' },
    }
    const sin = await request(createHealthRouter({ timeouts: fast, probes }))
    assert.equal(sin.status, 200)
    assert.equal('capabilities' in sin.body, false)

    const apagadas = await request(createHealthRouter({ timeouts: fast, probes, getCapabilities: async () => todas }))
    assert.equal(apagadas.status, 200, 'no optional integration takes the API down')
    assert.equal(apagadas.body.ready, true)
    assert.deepEqual(apagadas.body.capabilities, todas)

    const rota = await request(createHealthRouter({ timeouts: fast, probes, getCapabilities: async () => { throw new Error(SECRET_URL) } }))
    assert.deepEqual([rota.status, rota.body.ready, rota.body.capabilities], [200, true, 'unknown'])
    assert.doesNotMatch(JSON.stringify(rota.body), /super-secret-pass/u)

    const colgada = await request(createHealthRouter({ timeouts: fast, probes, getCapabilities: never }))
    assert.deepEqual([colgada.status, colgada.body.ready, colgada.body.capabilities], [200, true, 'unknown'])
    assert.ok(colgada.ms < 1500, `a hanging reporter is not waited for: ${colgada.ms} ms`)

    // The database still decides: capabilities that are all ready do not make an unready API ready.
    const sinBase = await request(createHealthRouter({ timeouts: fast, probes: { postgresConnection: async () => false, postgresSchema: async () => okSchema }, getCapabilities: async () => ({ groq: { status: 'ready', reason: 'configured' } }) }))
    assert.deepEqual([sinBase.status, sinBase.body.ready], [503, false])
  }))

test('assistant capabilities: with nothing configured every optional capability is off or unavailable with a fixed reason, and no configuration value is reported', async () => {
  const { crearModuloWhatsapp } = await import('../../apps/api/src/tus/asistente/composicion.ts')
  const transaction = { ejecutar: async () => { throw new Error('not used') } }
  const accounts = { contexto: async () => null }
  const modulo = (env) => crearModuloWhatsapp({ env, transaction, accounts, knowledgeIndex: null, domain: {} })
  assert.deepEqual(await modulo({}).capacidades(), {
    whatsapp: { status: 'disabled', reason: 'not_enabled' },
    groq: { status: 'disabled', reason: 'not_configured' },
    audioTranscription: { status: 'disabled', reason: 'not_enabled' },
    receiptImages: { status: 'disabled', reason: 'not_enabled' },
    receiptPdf: { status: 'disabled', reason: 'not_enabled' },
  })
  // Enabled features whose dependency is missing are "unavailable", each with its cause.
  const sinDependencias = await modulo({
    WHATSAPP_AUDIO_TRANSCRIPTION: 'true',
    WHATSAPP_RECEIPT_ANALYSIS: 'true',
    WHATSAPP_RECEIPT_ANALYZER: 'ocr',
    WHATSAPP_RECEIPT_PDFTOTEXT: 'tus-binary-that-does-not-exist',
  }).capacidades()
  assert.deepEqual(sinDependencias.audioTranscription, { status: 'unavailable', reason: 'groq_not_configured' })
  assert.deepEqual(sinDependencias.receiptImages, { status: 'unavailable', reason: 'ocr:lang_path_not_set' })
  assert.deepEqual(sinDependencias.receiptPdf, { status: 'unavailable', reason: 'ocr:missing' })
  const vision = await modulo({ WHATSAPP_RECEIPT_ANALYSIS: 'true', WHATSAPP_RECEIPT_ANALYZER: 'vision' }).capacidades()
  assert.deepEqual(vision.receiptImages, { status: 'unavailable', reason: 'groq_not_configured' })
  // With a key, the report says "configured" and never the key.
  const KEY = 'gsk_fictitious_key_for_tests_only'
  const conGroq = await modulo({ GROQ_API_KEY: KEY, GROQ_API_KEY_1: KEY, WHATSAPP_AUDIO_TRANSCRIPTION: 'true' }).capacidades()
  assert.deepEqual([conGroq.groq, conGroq.audioTranscription], [{ status: 'ready', reason: 'configured' }, { status: 'ready', reason: 'configured' }])
  assert.equal(JSON.stringify(conGroq).includes(KEY), false)
})
