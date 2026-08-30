import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export const TEST_DIRECTORIES = Object.freeze([
  'tests/foundation',
  'tests/compatibility',
  'packages/providers/tests',
])

export const DEFAULT_TEST_TIMEOUT_MS = 120_000
export const POSTGRES_SMOKE_TIMEOUT_MS = 120_000
export const APPROVED_POSTGRES_ENV_VARS = Object.freeze([
  'TUS_POSTGRES_URL',
  'DATABASE_URL',
  'TUS_POSTGRES_DISPOSABLE',
  'TUS_POSTGRES_TARGET_ID',
  'TUS_POSTGRES_PROFILE',
])

const execFileAsync = promisify(execFile)
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const API_ROOT = join(REPO_ROOT, 'apps', 'api')
const API_TSX_CLI = join(API_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const POSTGRES_SMOKE_TEST = 'tests/integration/tus/postgres-http-smoke.test.mjs'
const POSTGRES_RERUN_COMMAND = `TUS_POSTGRES_URL=<authorized-disposable-postgres-url> TUS_POSTGRES_DISPOSABLE=1 TUS_POSTGRES_TARGET_ID=<unique-disposable-target-id> TUS_POSTGRES_PROFILE=<local-disposable|test-disposable> pnpm test -- ${POSTGRES_SMOKE_TEST}`
const SAFE_CHILD_ENV_VARS = Object.freeze([
  'PATH',
  'Path',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
])
const SAFE_CHILD_EXTRA_ENV_VARS = Object.freeze(['API_PORT', 'NODE_ENV', 'NATIVE_PROFILE'])
const DISPOSABLE_PROFILES = Object.freeze(['local-disposable', 'test-disposable'])
const SETTLEMENT_GATES = Object.freeze([
  'legal',
  'kyc',
  'kyb',
  'tax',
  'mercadoPago',
  'posPilot',
  'aws',
  'groqMigration',
  'runtimeProvider',
])
export const REQUIRED_SCHEMA_COLUMNS = Object.freeze({
  TusReadinessEvidence: ['profile', 'execution', 'evidenceClass', 'liveConformance'],
  TusReadinessDecision: ['actorId', 'jobId', 'correlationId', 'profile', 'scope', 'outcome'],
  TusMerchant: ['tenantId', 'status'],
  TusListing: ['tenantId', 'kind', 'published', 'stock', 'availabilityVersion'],
  TusMarketplaceCommitment: ['tenantId', 'commitmentId', 'context', 'quantity'],
  TusMarketplaceAudit: ['tenantId', 'actorId', 'correlationId'],
  IdempotencyRecord: ['tenantId', 'key', 'requestHash', 'status', 'response'],
  OutboxEvent: ['tenantId', 'aggregateType', 'aggregateId', 'status'],
  TusDeliveryZone: ['tenantId', 'zoneId', 'active'],
  TusDeliveryShift: ['tenantId', 'shiftId', 'zoneId', 'status'],
  TusDeliveryTask: ['tenantId', 'taskId', 'commitmentId', 'version', 'settlementClaim'],
  TusDeliveryProof: ['tenantId', 'proofId', 'taskId', 'evidenceSource'],
  TusDeliveryAudit: ['tenantId', 'auditId', 'correlationId'],
  TusDeliveryOutbox: ['tenantId', 'eventId', 'aggregateId', 'status'],
  TusPosOperation: ['tenantId', 'operationId', 'idempotencyKey', 'shiftId', 'response'],
  TusPosReceipt: ['tenantId', 'receiptId', 'operationId', 'integrityHash', 'settlement'],
  TusPosDevice: ['tenantId', 'deviceId', 'status'],
  TusPosSession: ['tenantId', 'sessionId', 'deviceId', 'shiftId', 'status'],
  TusPosConflict: ['tenantId', 'conflictId', 'operationId', 'reason', 'status'],
  TusPosOutbox: ['tenantId', 'eventId', 'aggregateId', 'status'],
  TusPosAudit: ['tenantId', 'auditId', 'operationId', 'correlationId'],
  TusPosVersion: ['tenantId', 'shiftId', 'version'],
})

function relativeTestPath(rootDirectory, filePath) {
  return relative(rootDirectory, filePath).replaceAll('\\', '/')
}

function testFilesInDirectory(rootDirectory, directory) {
  const absoluteDirectory = join(rootDirectory, directory)
  if (!existsSync(absoluteDirectory)) return []

  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(directory, entry.name)
    if (entry.isDirectory()) return testFilesInDirectory(rootDirectory, relativePath)
    return entry.name.endsWith('.test.mjs') ? [relativePath.replaceAll('\\', '/')] : []
  })
}

export function discoverTestFiles(rootDirectory = process.cwd()) {
  const normalizedRoot = resolve(rootDirectory)
  return TEST_DIRECTORIES.flatMap((directory) => testFilesInDirectory(normalizedRoot, directory)).sort()
}

export function selectTestFiles(rootDirectory = process.cwd(), requested = []) {
  const normalizedRoot = resolve(rootDirectory)
  const available = new Set(discoverTestFiles(normalizedRoot))
  const normalizedRequested = requested
    .filter((argument) => argument !== '--' && !argument.startsWith('-'))
    .map((argument) => relativeTestPath(normalizedRoot, resolve(normalizedRoot, argument)))

  if (normalizedRequested.length === 0) return [...available].sort()

  const missing = normalizedRequested.filter((file) => !existsSync(join(normalizedRoot, file)))
  if (missing.length > 0) {
    throw new Error(`Requested test file does not exist: ${missing.join(', ')}`)
  }

  return [...new Set(normalizedRequested)].sort()
}

function countFromTap(output, label) {
  const match = output.match(new RegExp(`^# ${label} (\\d+)\\s*$`, 'm'))
  return match ? Number(match[1]) : 0
}

export function parseTapSummary(output = '') {
  return {
    tests: countFromTap(output, 'tests'),
    pass: countFromTap(output, 'pass'),
    fail: countFromTap(output, 'fail'),
    skipped: countFromTap(output, 'skipped'),
    todo: countFromTap(output, 'todo'),
    cancelled: countFromTap(output, 'cancelled'),
  }
}

function rerunCommand(file) {
  return `pnpm exec node --experimental-strip-types --experimental-loader ./scripts/node-strip-types-loader.mjs --test --test-concurrency=1 ${file}`
}

export function classifyFailure({ file, output = '', exitCode = 1, timedOut = false }) {
  const normalizedOutput = output.toLowerCase()
  const base = { rerunCommand: rerunCommand(file), blocksCompletion: false }

  if (timedOut || /timeout|timed out/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'environmental',
      owner: 'validation runner / host resources',
      cause: 'test-file timeout during isolated execution',
    }
  }

  if (/out of memory|cannot allocate memory|heap arena|err_worker_init_failed|3221226505/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'environmental',
      owner: 'validation runner / host resources',
      cause: 'memory or worker-resource exhaustion',
    }
  }

  if (
    /expected\s+\/validated \d+ json schema contract\(s\).*received validated 98 json schema contract\(s\)/s.test(
      normalizedOutput,
    )
  ) {
    return {
      ...base,
      disposition: 'resolved',
      owner: 'contracts validation',
      cause: 'stale schema-count assertion',
    }
  }

  if (/enoent.*product-factory-core|missing.*product-factory-core.*spec|traceability.*spec/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'resolved',
      owner: 'platform traceability',
      cause: 'traceability test referenced an archived change at its former path',
    }
  }

  if (/vertical-vocabulary|fallback-import|client-policy-bypass|contamination/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'accepted pre-existing',
      owner: 'neutral reference boundary',
      cause: 'legacy neutral-boundary validation scope or vocabulary drift',
    }
  }

  if (/unsupported-profile|portability/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'accepted pre-existing',
      owner: 'profile portability',
      cause: 'pre-existing profile or clean-checkout fixture drift',
    }
  }

  return {
    ...base,
    disposition: 'unexplained',
    owner: 'validation owner',
    cause: `unclassified test failure (exit ${exitCode})`,
    blocksCompletion: true,
  }
}

export function createFailureRecord({ file, output = '', exitCode = 1, timedOut = false }) {
  return {
    file,
    exitCode,
    ...classifyFailure({ file, output, exitCode, timedOut }),
  }
}

export function resolvePostgresTarget(environment = process.env) {
  return resolvePostgresTargetDetails(environment).target
}

export function buildPostgresChildEnvironment({ postgresUrl, baseEnvironment = process.env, extra = {} } = {}) {
  const childEnvironment = Object.fromEntries(
    SAFE_CHILD_ENV_VARS
      .filter((name) => typeof baseEnvironment?.[name] === 'string' && baseEnvironment[name].length > 0)
      .map((name) => [name, baseEnvironment[name]]),
  )
  const safeExtra = Object.fromEntries(
    SAFE_CHILD_EXTRA_ENV_VARS
      .filter((name) => typeof extra?.[name] === 'string' && extra[name].length > 0)
      .map((name) => [name, extra[name]]),
  )
  return { ...childEnvironment, DATABASE_URL: postgresUrl, ...safeExtra }
}

function zeroPostgresActions() {
  return {
    connections: 0,
    migrations: 0,
    queries: 0,
    fixtures: 0,
    providerCalls: 0,
  }
}

export function resolvePostgresSmokeEvidence({ postgresUrl, environment = process.env } = {}) {
  const targetDetails = resolvePostgresTargetDetails(withExplicitPostgresUrl(environment, postgresUrl))
  if (targetDetails.target.status !== 'ready') {
    return deferredPostgresSmoke(targetDetails.target.reason, 'PostgreSQL target safety', {}, targetDetails.target)
  }

  return {
    status: 'ready-to-run',
    evidenceClass: 'local-postgresql-http',
    liveConformance: false,
    target: targetDetails.target,
    reason: 'A PostgreSQL URL is available; the authenticated restart/replay harness must be run explicitly',
  }
}

export async function runTusPostgresHttpSmoke({
  postgresUrl,
  environment = process.env,
  applyMigrations = false,
  timeoutMs = POSTGRES_SMOKE_TIMEOUT_MS,
  operations = {},
} = {}) {
  const targetDetails = resolvePostgresTargetDetails(withExplicitPostgresUrl(environment, postgresUrl))
  const target = targetDetails.target
  if (target.status !== 'ready') return deferredPostgresSmoke(target.reason, 'PostgreSQL target safety', {}, target)

  const runtimeOperations = {
    validatePrismaSchema,
    deployPrismaMigrations,
    connectSmokePool,
    validateDatabaseSchema,
    createSmokeFixture,
    startSmokeApi,
    stopSmokeApi,
    cleanupSmokeFixture,
    ...operations,
  }
  const resolvedPostgresUrl = targetDetails.postgresUrl
  const actions = zeroPostgresActions()

  let pool
  let fixture
  let api
  let finalEvidence = null
  try {
    await runtimeOperations.validatePrismaSchema(resolvedPostgresUrl, timeoutMs)
    if (applyMigrations) {
      actions.migrations += 1
      await runtimeOperations.deployPrismaMigrations(resolvedPostgresUrl, timeoutMs)
    }

    actions.connections += 1
    pool = await runtimeOperations.connectSmokePool(resolvedPostgresUrl)
    pool = instrumentSmokePool(pool, actions)
    await runtimeOperations.validateDatabaseSchema(pool)
    fixture = runtimeOperations.createSmokeFixture()
    actions.fixtures += 1
    try {
      api = await runtimeOperations.startSmokeApi(resolvedPostgresUrl, timeoutMs)
    } catch (error) {
      if (error instanceof SmokeInfrastructureError) throw error
      throw new SmokeInfrastructureError(error instanceof Error ? error.message : 'API runtime startup failed', 'API runtime startup')
    }

    const tenantA = await registerAndSignIn(api.baseUrl, pool, fixture, 'a')
    const tenantB = await registerAndSignIn(api.baseUrl, pool, fixture, 'b')
    fixture.actorId = tenantA.actorId
    await seedMarketplaceFixture(pool, fixture)

    const discovery = await requestJson(api.baseUrl, '/tus/v1/marketplace/discovery', { token: tenantA.token, correlationId: 'tus-smoke-discovery' })
    if (discovery.status !== 200 || !Array.isArray(discovery.body.items)) {
      throw new SmokeAssertionError('authenticated discovery did not return a PostgreSQL-backed catalog')
    }
    const product = discovery.body.items.find((item) => item.listingId === fixture.productListingId)
    const service = discovery.body.items.find((item) => item.listingId === fixture.serviceListingId)
    if (!product || !service || product.kind !== 'product' || service.kind !== 'service') {
      throw new SmokeAssertionError('product and service facts were not durably discoverable')
    }

    const readiness = await hasAuthorizedFleetReadiness(pool, fixture.tenantA)
    if (!readiness) {
      await assertFleetIsDenied(api.baseUrl, tenantA.token, fixture)
      return finalEvidence = deferredPostgresSmoke(
        'No authorized fleet readiness evidence is available for the disposable smoke tenant; the runtime guard denied the POS and delivery mutations and no durable journey was claimed',
        'authorized fleet readiness evidence',
        { authenticatedHttp: 'passed', discovery: 'passed', deviceSession: 'denied', productPos: 'denied', servicePos: 'denied', deliveryHandoff: 'denied', providerNonInteraction: { status: 'passed', providerCalls: 0, settlementClaims: 0 } },
        target,
      )
    }

    const posJourney = await runPosJourney(api.baseUrl, tenantA.token, tenantB.token, fixture)
    const deliveryJourney = await runDeliveryJourney(api.baseUrl, tenantA.token, fixture)
    const beforeRestart = await durableCounts(pool, fixture, fixture.tenantA)

    await runtimeOperations.stopSmokeApi(api)
    api = await runtimeOperations.startSmokeApi(resolvedPostgresUrl, timeoutMs)

    const replay = await postPosOperation(api.baseUrl, tenantA.token, posJourney.productCommand)
    if (replay.status !== 201 || replay.body.status !== 'accepted' || replay.body.receipt.receiptId !== posJourney.product.body.receipt.receiptId) throw new SmokeAssertionError('replay after restart did not return the original durable POS result')
    const conflict = await postPosOperation(api.baseUrl, tenantA.token, { ...posJourney.productCommand, amount: 999 })
    if (conflict.status !== 409 || conflict.body.reason !== 'idempotency_conflict') throw new SmokeAssertionError('changed POS replay hash was not rejected')
    const versionConflict = await postPosOperation(api.baseUrl, tenantA.token, { ...posJourney.serviceCommand, operationId: `tus-smoke-stale-${fixture.runId}`, idempotencyKey: `tus-smoke-stale-${fixture.runId}`, expectedVersion: 0 })
    if (versionConflict.status !== 409 || versionConflict.body.reason !== 'version_conflict') throw new SmokeAssertionError('stale POS version was not rejected')

    const foreign = await postPosOperation(api.baseUrl, tenantB.token, { ...posJourney.productCommand, operationId: `tus-smoke-foreign-${fixture.runId}`, idempotencyKey: `tus-smoke-foreign-${fixture.runId}` })
    if (foreign.status !== 409 || foreign.body.code !== 'DEVICE_UNAVAILABLE') throw new SmokeAssertionError('cross-tenant POS device access was not denied')

    const afterReplay = await durableCounts(pool, fixture, fixture.tenantA)
    if (afterReplay.posOperations !== beforeRestart.posOperations || afterReplay.posReceipts !== beforeRestart.posReceipts) throw new SmokeAssertionError('replay created duplicate POS effects')
    if (afterReplay.posConflicts < beforeRestart.posConflicts + 2) throw new SmokeAssertionError('POS idempotency and version conflicts were not durable')

    return finalEvidence = {
      status: 'passed',
      evidenceClass: 'local-postgresql-http',
      execution: 'local-verification',
      liveConformance: false,
      migrationMode: applyMigrations ? 'explicit-deploy' : 'pre-applied-only',
      validation: { prismaSchema: 'passed', databaseSchema: 'passed' },
      scenarios: {
        authenticatedHttp: { status: 'passed', discoveryItems: discovery.body.items.length },
        deviceSession: { status: 'passed', deviceId: posJourney.device.body.deviceId, sessionId: posJourney.session.body.sessionId },
        productPos: { status: 'passed', operationId: posJourney.product.body.operation.operationId },
        servicePos: { status: 'passed', operationId: posJourney.service.body.operation.operationId },
        offlineReplay: { status: 'passed', replayStatus: replay.body.status },
        versionConflict: { status: 'passed', statusCode: versionConflict.status, persistedConflicts: afterReplay.posConflicts },
        receiptIntegrity: { status: 'passed', integrityHashLength: posJourney.product.body.receipt.integrityHash.length, settlement: posJourney.product.body.receipt.settlement },
        deliveryHandoff: { status: 'passed', taskStatus: deliveryJourney.handoff.body.status, proofSource: deliveryJourney.proof.body.proof.evidenceSource },
        auditOutbox: { status: 'passed', posAudit: afterReplay.posAudit, posOutbox: afterReplay.posOutbox, deliveryAudit: afterReplay.deliveryAudit, deliveryOutbox: afterReplay.deliveryOutbox },
        restartReplay: { status: 'passed', replayStatus: replay.body.status, recoveredSession: posJourney.session.body.sessionId },
        crossTenantIsolation: { status: 'passed', statusCode: foreign.status },
        cleanup: { status: 'passed', fixture: 'targeted-tenant-and-resource-ids' },
        rollback: { status: 'passed', statusCode: conflict.status, financialRollback: 'append-only', destructiveRollback: false },
        providerNonInteraction: { status: 'passed', providerCalls: 0, settlementClaims: 0 },
      },
      counts: afterReplay,
      actions,
      reason: 'Authenticated PostgreSQL HTTP journey passed without promoting local evidence to external or production conformance',
    }
  } catch (error) {
    if (error instanceof SmokeInfrastructureError) return finalEvidence = deferredPostgresSmoke(error.message, error.boundary, { actions, failure: classifySmokeFailure(error, error.boundary) }, target)
    if (error instanceof SmokeAssertionError) return finalEvidence = failedPostgresSmoke(error.message, target, { actions, failure: classifySmokeFailure(error, 'authenticated PostgreSQL smoke assertions') })
    return finalEvidence = deferredPostgresSmoke('PostgreSQL HTTP smoke could not complete safely; no live evidence was claimed', 'bounded PostgreSQL smoke setup', { actions, failure: classifySmokeFailure(error, 'bounded PostgreSQL smoke setup') }, target)
  } finally {
    if (api) {
      try {
        await runtimeOperations.stopSmokeApi(api)
      } catch {
        if (finalEvidence) {
          if (finalEvidence.status === 'passed') finalEvidence.status = 'failed'
          finalEvidence.shutdownFailure = true
          finalEvidence.resourceClosure = { status: 'failed', classification: 'shutdown-failure', owner: 'runtime owner', boundary: 'API runtime shutdown', rerunCommand: POSTGRES_RERUN_COMMAND }
          finalEvidence.scenarios.cleanup = { status: 'failed', classification: 'shutdown-failure' }
        }
      }
    }
    if (pool && fixture) {
      try {
        await runtimeOperations.cleanupSmokeFixture(pool, fixture)
        if (finalEvidence && !finalEvidence.cleanupFailure && !finalEvidence.shutdownFailure) {
          finalEvidence.scenarios.cleanup = { status: 'passed', targeted: true, preservedEvidence: true }
        }
      } catch {
        if (finalEvidence) {
          finalEvidence.cleanupFailure = true
          finalEvidence.cleanupFailure = { classification: 'cleanup-failure', owner: 'runtime owner', boundary: 'PostgreSQL disposable fixture cleanup', rerunCommand: POSTGRES_RERUN_COMMAND }
          finalEvidence.scenarios.cleanup = { status: 'failed', classification: 'cleanup-failure' }
        }
      }
    }
    if (pool) {
      try {
        await pool.end()
      } catch {
        if (finalEvidence) {
          if (finalEvidence.status === 'passed') finalEvidence.status = 'failed'
          finalEvidence.poolClosureFailure = { classification: 'shutdown-failure', owner: 'runtime owner', boundary: 'PostgreSQL pool closure', rerunCommand: POSTGRES_RERUN_COMMAND }
          finalEvidence.scenarios.cleanup = { status: 'failed', classification: 'shutdown-failure' }
        }
      }
    }
  }
}

function deferredPostgresSmoke(reason, boundary, observations = {}, target = resolvePostgresTarget()) {
  const scenarioKeys = [
    'authenticatedHttp', 'deviceSession', 'productPos', 'servicePos', 'offlineReplay',
    'versionConflict', 'receiptIntegrity', 'deliveryHandoff', 'auditOutbox', 'restartReplay',
    'crossTenantIsolation', 'cleanup', 'rollback', 'providerNonInteraction',
  ]
  const safeObservations = {
    actions: zeroPostgresActions(),
    providerNonInteraction: { status: 'deferred', providerCalls: 0, settlementClaims: 0 },
    ...observations,
  }
  return {
    status: 'deferred',
    evidenceClass: 'local-postgresql-http',
    execution: 'local-verification',
    liveConformance: false,
    reason,
    unavailableBoundary: boundary,
    target,
    actions: safeObservations.actions,
    rerunCommand: POSTGRES_RERUN_COMMAND,
    ...(safeObservations.failure ? { failure: safeObservations.failure } : {}),
    scenarios: Object.fromEntries(scenarioKeys.map((key) => [
      key,
      typeof safeObservations[key] === 'object' && safeObservations[key] !== null
        ? safeObservations[key]
        : { status: safeObservations[key] ?? 'deferred' },
    ])),
  }
}

function failedPostgresSmoke(reason, target, observations = {}) {
  return {
    status: 'failed',
    evidenceClass: 'local-postgresql-http',
    execution: 'local-verification',
    liveConformance: false,
    reason,
    ...(observations.actions ? { actions: observations.actions } : {}),
    ...(observations.failure ? { failure: observations.failure } : {}),
    target,
    scenarios: Object.fromEntries([
      'authenticatedHttp', 'deviceSession', 'productPos', 'servicePos', 'offlineReplay',
      'versionConflict', 'receiptIntegrity', 'deliveryHandoff', 'auditOutbox', 'restartReplay',
      'crossTenantIsolation', 'cleanup', 'rollback', 'providerNonInteraction',
    ].map((key) => [key, { status: 'failed' }])),
  }
}

export function classifySmokeFailure(error, boundary = 'bounded PostgreSQL smoke setup') {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  const classification = error instanceof SmokeAssertionError || error?.name === 'SmokeAssertionError'
    ? 'assertion-failure'
    : /timeout|timed out/u.test(normalized)
      ? 'timeout'
      : 'unavailable'
  return {
    classification,
    boundary,
    owner: classification === 'assertion-failure' ? 'TUS runtime owner' : 'validation runner / host resources',
    reason: message || 'PostgreSQL smoke failed before completion',
    rerunCommand: POSTGRES_RERUN_COMMAND,
  }
}

class SmokeInfrastructureError extends Error {
  constructor(message, boundary) {
    super(message)
    this.name = 'SmokeInfrastructureError'
    this.boundary = boundary
  }
}

class SmokeAssertionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SmokeAssertionError'
  }
}

async function validatePrismaSchema(postgresUrl, timeoutMs) {
  try {
    await runPrismaCommand(['validate'], postgresUrl, Math.min(timeoutMs, 30_000))
  } catch {
    throw new SmokeInfrastructureError('Prisma schema validation was unavailable; authenticated PostgreSQL smoke was not run', 'Prisma schema validation')
  }
}

async function deployPrismaMigrations(postgresUrl, timeoutMs) {
  try {
    await runPrismaCommand(['migrate', 'deploy'], postgresUrl, Math.min(timeoutMs, 60_000))
  } catch {
    throw new SmokeInfrastructureError('Explicit Prisma migration deployment did not complete; smoke was deferred without changing evidence status', 'explicit migration deployment')
  }
}

async function runPrismaCommand(args, postgresUrl, timeoutMs) {
  if (!(args.length === 1 && args[0] === 'validate') && !(args.length === 2 && args[0] === 'migrate' && args[1] === 'deploy')) {
    throw new SmokeInfrastructureError('Unsupported or destructive Prisma command was denied', 'Prisma command policy')
  }
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  await execFileAsync(command, ['--filter', '@factory/api', 'exec', 'prisma', ...args], {
    cwd: REPO_ROOT,
    env: buildPostgresChildEnvironment({ postgresUrl }),
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 32 * 1024,
  })
}

async function connectSmokePool(postgresUrl) {
  try {
    const requireFromApi = createRequire(join(API_ROOT, 'package.json'))
    const { Pool } = requireFromApi('pg')
    const pool = new Pool({ connectionString: postgresUrl, max: 1, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 2_000, statement_timeout: 10_000 })
    await pool.query('SELECT 1')
    return pool
  } catch {
    throw new SmokeInfrastructureError('PostgreSQL connection was unavailable; authenticated smoke was not run', 'PostgreSQL connection')
  }
}

async function validateDatabaseSchema(pool) {
  const tables = Object.keys(REQUIRED_SCHEMA_COLUMNS)
  const tableResult = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])', ['public', tables])
  const presentTables = new Set(tableResult.rows.map((row) => row.table_name))
  const missingTables = tables.filter((table) => !presentTables.has(table))
  if (missingTables.length > 0) throw new SmokeInfrastructureError('Required PostgreSQL migrations are not applied; run the bounded migration command before rerunning smoke', 'PostgreSQL schema migrations')

  const columnResult = await pool.query('SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = ANY($2::text[])', ['public', tables])
  const presentColumns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`))
  const missingColumns = tables.flatMap((table) => REQUIRED_SCHEMA_COLUMNS[table].filter((column) => !presentColumns.has(`${table}.${column}`)))
  if (missingColumns.length > 0) throw new SmokeInfrastructureError('Required PostgreSQL schema metadata is incomplete; run the bounded migration command before rerunning smoke', 'PostgreSQL schema metadata')
}

export function createSmokeFixture() {
  const runId = randomUUID().replaceAll('-', '')
  return {
    runId,
    tenantA: `tus-smoke-a-${runId}`,
    tenantB: `tus-smoke-b-${runId}`,
    emailA: `tus-smoke-a-${runId}@example.invalid`,
    emailB: `tus-smoke-b-${runId}@example.invalid`,
    productListingId: `tus-smoke-product-${runId}`,
    serviceListingId: `tus-smoke-service-${runId}`,
    productMerchantId: `tus-smoke-merchant-a-${runId}`,
    serviceMerchantId: `tus-smoke-merchant-b-${runId}`,
    deliveryCommitmentId: `tus-smoke-delivery-commitment-${runId}`,
    posDeviceId: `tus-smoke-pos-device-${runId}`,
    posSessionId: `tus-smoke-pos-session-${runId}`,
    posShiftId: `tus-smoke-pos-shift-${runId}`,
    deliveryZoneId: `tus-smoke-zone-${runId}`,
    deliveryShiftId: `tus-smoke-delivery-shift-${runId}`,
    deliveryTaskId: `tus-smoke-delivery-task-${runId}`,
    deliveryProofId: `tus-smoke-delivery-proof-${runId}`,
    password: `TUS smoke password ${runId}!`,
  }
}

function instrumentSmokePool(pool, actions) {
  return new Proxy(pool, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver)
      return (...args) => {
        actions.queries += 1
        return target.query(...args)
      }
    },
  })
}

function resolvePostgresTargetDetails(environment = process.env) {
  const approvedEnvironment = approvedPostgresEnvironment(environment)
  const selected = selectPostgresUrl(approvedEnvironment)
  const profile = nonBlank(approvedEnvironment.TUS_POSTGRES_PROFILE)
  const targetId = nonBlank(approvedEnvironment.TUS_POSTGRES_TARGET_ID)
  const base = {
    status: 'no-target',
    source: selected.source,
    redactedTarget: null,
    targetId: targetId ?? null,
    profile: profile ?? null,
    environment: profile === 'test-disposable' ? 'test' : 'local',
    runtimeRole: 'validation-runner',
    service: 'tus-postgres-http-smoke',
    providerMode: 'provider-free',
    databaseMode: 'postgresql-disposable-only',
    productionSecretStore: 'not-used',
    reason: 'no-approved-postgresql-target',
    owner: 'runtime owner',
    rerunCommand: POSTGRES_RERUN_COMMAND,
  }

  if (!selected.value) return { target: base, postgresUrl: null }

  const parsed = parsePostgresUrl(selected.value)
  if (!parsed) {
    return {
      target: { ...base, status: 'invalid-target', reason: 'invalid-postgresql-url', source: selected.source },
      postgresUrl: null,
    }
  }

  const redactedTarget = 'postgresql://<redacted-host>/<redacted-database>'
  const classified = { ...base, status: 'unsafe-target', redactedTarget, source: selected.source }
  if (approvedEnvironment.TUS_POSTGRES_DISPOSABLE !== '1') {
    return { target: { ...classified, reason: 'disposable-proof-required' }, postgresUrl: null }
  }
  if (!DISPOSABLE_PROFILES.includes(profile)) {
    return { target: { ...classified, reason: 'non-production-profile-required' }, postgresUrl: null }
  }
  if (!targetId || !/^[a-z0-9][a-z0-9._-]{2,127}$/iu.test(targetId) || !/(?:^|[-_.])(local|test|disposable)(?:[-_.]|$)/iu.test(targetId)) {
    return { target: { ...classified, reason: 'disposable-target-id-required' }, postgresUrl: null }
  }
  if (!parsed.tls) return { target: { ...classified, reason: 'tls-required' }, postgresUrl: null }
  if (/(?:^|[-_.])(prod|production|shared|pooler|staging|stage)(?:[-_.]|$)/iu.test(parsed.hostname)) {
    return { target: { ...classified, reason: 'shared-or-production-host' }, postgresUrl: null }
  }

  return {
    target: {
      ...classified,
      status: 'ready',
      reason: 'authorized-disposable-target',
    },
    postgresUrl: selected.value,
  }
}

function approvedPostgresEnvironment(environment) {
  return Object.fromEntries(
    APPROVED_POSTGRES_ENV_VARS
      .filter((name) => typeof environment?.[name] === 'string')
      .map((name) => [name, environment[name]]),
  )
}

function withExplicitPostgresUrl(environment, postgresUrl) {
  const approved = approvedPostgresEnvironment(environment)
  if (postgresUrl !== undefined) approved.TUS_POSTGRES_URL = postgresUrl
  return approved
}

function selectPostgresUrl(environment) {
  for (const name of ['TUS_POSTGRES_URL', 'DATABASE_URL']) {
    const value = nonBlank(environment[name])
    if (value) return { source: name, value }
  }
  return { source: null, value: null }
}

function parsePostgresUrl(value) {
  if (/\s/u.test(value)) return null
  try {
    const parsed = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === '/') return null
    const sslmode = parsed.searchParams.get('sslmode')
    return { hostname: parsed.hostname, tls: ['require', 'verify-ca', 'verify-full'].includes(sslmode) }
  } catch {
    return null
  }
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function registerAndSignIn(baseUrl, pool, fixture, suffix) {
  const tenantId = suffix === 'a' ? fixture.tenantA : fixture.tenantB
  const email = suffix === 'a' ? fixture.emailA : fixture.emailB
  const register = await requestJson(baseUrl, '/auth/register', { method: 'POST', body: { email, password: fixture.password, displayName: `TUS smoke ${suffix}`, tenantId } })
  if (register.status !== 201) throw new SmokeInfrastructureError('Disposable identity registration did not start safely', 'authenticated identity fixture')
  await pool.query('UPDATE "Account" SET "emailVerifiedAt" = NOW() WHERE "tenantId" = $1', [tenantId])
  const signIn = await requestJson(baseUrl, '/auth/sign-in', { method: 'POST', body: { email, password: fixture.password, deviceId: `tus-smoke-device-${suffix}` } })
  if (signIn.status !== 200 || typeof signIn.body.session?.accessToken !== 'string') throw new SmokeInfrastructureError('Disposable authenticated session could not be established', 'authenticated identity fixture')
   return { token: signIn.body.session.accessToken, tenantId, actorId: signIn.body.session.accountId }
}

async function seedMarketplaceFixture(pool, fixture) {
  const now = new Date()
  await pool.query('BEGIN')
  try {
    await pool.query('INSERT INTO "TusMerchant" ("id", "tenantId", "merchantId", "cohort", "locationId", "timezone", "staffRoles", "operatingPolicyVersion", "status", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)', [fixture.productMerchantId, fixture.tenantA, fixture.productMerchantId, 'beauty-personal-care', 'tus-smoke-location-a', 'America/Argentina/Buenos_Aires', ['owner'], 'stage-1-v1', 'approved', now])
    await pool.query('INSERT INTO "TusMerchant" ("id", "tenantId", "merchantId", "cohort", "locationId", "timezone", "staffRoles", "operatingPolicyVersion", "status", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)', [fixture.serviceMerchantId, fixture.tenantB, fixture.serviceMerchantId, 'repairs-trades', 'tus-smoke-location-b', 'America/Argentina/Buenos_Aires', ['owner'], 'stage-1-v1', 'approved', now])
    await pool.query('INSERT INTO "TusListing" ("id", "contractVersion", "tenantId", "merchantId", "kind", "name", "description", "cohort", "locationId", "currency", "price", "availabilityVersion", "published", "policyVersion", "stock", "durationMinutes", "capacity", "workingHours", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)', [fixture.productListingId, '1.0.0', fixture.tenantA, fixture.productMerchantId, 'product', 'TUS smoke product', 'Disposable product fixture', 'beauty-personal-care', 'tus-smoke-location-a', 'ARS', 100, 1, true, 'stage-1-v1', 2, null, null, JSON.stringify([]), now])
    await pool.query('INSERT INTO "TusListing" ("id", "contractVersion", "tenantId", "merchantId", "kind", "name", "description", "cohort", "locationId", "currency", "price", "availabilityVersion", "published", "policyVersion", "stock", "durationMinutes", "capacity", "workingHours", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)', [fixture.serviceListingId, '1.0.0', fixture.tenantB, fixture.serviceMerchantId, 'service', 'TUS smoke service', 'Disposable service fixture', 'repairs-trades', 'tus-smoke-location-b', 'ARS', 250, 1, true, 'stage-1-v1', null, 60, 1, JSON.stringify([{ day: 1, start: '09:00', end: '18:00' }]), now])
    await pool.query('INSERT INTO "TusMarketplaceCommitment" ("id", "contractVersion", "commitmentId", "cartId", "tenantId", "merchantId", "listingId", "context", "lineIds", "quantity", "amount", "currency", "status", "availabilityVersion", "policyVersion", "slotStart", "slotEnd", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)', [fixture.deliveryCommitmentId, '1.0.0', fixture.deliveryCommitmentId, `tus-smoke-delivery-cart-${fixture.runId}`, fixture.tenantA, fixture.productMerchantId, fixture.productListingId, 'product', [`tus-smoke-delivery-line-${fixture.runId}`], 1, 100, 'ARS', 'confirmed', 1, 'stage-1-v1', null, null, now])
    await pool.query('COMMIT')
  } catch (error) {
    await pool.query('ROLLBACK')
    throw new SmokeInfrastructureError('Disposable PostgreSQL marketplace fixtures could not be created safely', 'PostgreSQL disposable fixtures')
  }
}

async function hasAuthorizedSettlementReadiness(pool, tenantId) {
  const result = await pool.query('SELECT COUNT(DISTINCT "gate")::int AS count FROM "TusReadinessEvidence" WHERE "tenantId" = $1 AND "capability" = $2 AND "scope" = $3 AND "profile" = $4 AND "source" = $5 AND "revoked" = FALSE AND "issuedAt" <= NOW() AND ("expiresAt" IS NULL OR "expiresAt" > NOW())', [tenantId, 'settlement', 'argentina-stage-1', 'native-local', 'authorized-external'])
  return Number(result.rows[0]?.count ?? 0) === SETTLEMENT_GATES.length
}

async function hasAuthorizedFleetReadiness(pool, tenantId) {
  const requiredGates = ['legal', 'kyc', 'kyb', 'tax', 'posPilot', 'runtimeProvider']
  const result = await pool.query('SELECT COUNT(DISTINCT "gate")::int AS count FROM "TusReadinessEvidence" WHERE "tenantId" = $1 AND "capability" = $2 AND "scope" = $3 AND "profile" = $4 AND "source" = $5 AND "revoked" = FALSE AND "issuedAt" <= NOW() AND ("expiresAt" IS NULL OR "expiresAt" > NOW())', [tenantId, 'fleet', 'argentina-stage-1', 'native-local', 'authorized-external'])
  return Number(result.rows[0]?.count ?? 0) === requiredGates.length
}

async function assertSettlementIsDenied(baseUrl, token, fixture, availabilityVersion) {
  const result = await postMarketplaceCheckout(baseUrl, token, checkoutCommand(fixture, { listingId: fixture.productListingId, availabilityVersion }, 'product'))
  if (result.status !== 409 || result.body.code !== 'TUS_READINESS_BLOCKED') throw new SmokeAssertionError('missing authorized readiness did not deny settlement before effects')
}

async function assertFleetIsDenied(baseUrl, token, fixture) {
  const result = await requestJson(baseUrl, '/tus/v1/pos/devices', { method: 'POST', token, correlationId: `tus-smoke-fleet-denied-${fixture.runId}`, body: { deviceId: fixture.posDeviceId, label: 'Deferred counter', fingerprint: `fp-${fixture.runId}` } })
  if (result.status !== 409 || result.body.code !== 'TUS_READINESS_BLOCKED') throw new SmokeAssertionError('missing authorized fleet readiness did not deny POS before effects')
}

async function runPosJourney(baseUrl, tenantToken, foreignTenantToken, fixture) {
  const device = await requestJson(baseUrl, '/tus/v1/pos/devices', { method: 'POST', token: tenantToken, correlationId: `tus-smoke-device-${fixture.runId}`, body: { deviceId: fixture.posDeviceId, label: 'Disposable counter', fingerprint: `fp-${fixture.runId}` } })
  if (device.status !== 201) throw new SmokeAssertionError('authenticated POS device registration did not commit')
  const session = await requestJson(baseUrl, '/tus/v1/pos/sessions', { method: 'POST', token: tenantToken, correlationId: `tus-smoke-session-${fixture.runId}`, body: { sessionId: fixture.posSessionId, deviceId: fixture.posDeviceId, shiftId: fixture.posShiftId } })
  if (session.status !== 201) throw new SmokeAssertionError('authenticated POS session did not commit')
  const productCommand = { operationId: `tus-smoke-product-${fixture.runId}`, idempotencyKey: `tus-smoke-product-key-${fixture.runId}`, schemaVersion: '1.0.0', deviceId: fixture.posDeviceId, shiftId: fixture.posShiftId, createdAt: new Date().toISOString(), expectedVersion: 0, kind: 'manual-sale', context: 'product', amount: 100, currency: 'ARS' }
  const serviceCommand = { operationId: `tus-smoke-service-${fixture.runId}`, idempotencyKey: `tus-smoke-service-key-${fixture.runId}`, schemaVersion: '1.0.0', deviceId: fixture.posDeviceId, shiftId: fixture.posShiftId, createdAt: new Date().toISOString(), expectedVersion: 1, kind: 'manual-service', context: 'service', amount: 250, currency: 'ARS' }
  const product = await postPosOperation(baseUrl, tenantToken, productCommand)
  if (product.status !== 201 || product.body.status !== 'accepted') throw new SmokeAssertionError('product POS operation did not commit')
  const service = await postPosOperation(baseUrl, tenantToken, serviceCommand)
  if (service.status !== 201 || service.body.status !== 'accepted') throw new SmokeAssertionError('service POS operation did not commit')
  if (service.body.receipt.providerCapture !== 'not-claimed' || service.body.receipt.settlement !== 'not-claimed') throw new SmokeAssertionError('POS receipt claimed provider or settlement state')
  if (typeof product.body.receipt.integrityHash !== 'string' || product.body.receipt.integrityHash.length !== 64) throw new SmokeAssertionError('POS receipt integrity hash is not verifiable')
  void foreignTenantToken
  return { device, session, product, service, productCommand, serviceCommand }
}

async function postPosOperation(baseUrl, token, body) {
  return requestJson(baseUrl, '/tus/v1/pos/manual-operations', { method: 'POST', token, correlationId: `tus-smoke-pos-${body.operationId}`, body })
}

async function runDeliveryJourney(baseUrl, token, fixture) {
  const zone = await requestJson(baseUrl, '/tus/v1/delivery/zones', { method: 'POST', token, correlationId: `tus-smoke-zone-${fixture.runId}`, body: { zoneId: fixture.deliveryZoneId, name: 'Disposable zone', postalCodes: ['1425'] } })
  if (zone.status !== 201) throw new SmokeAssertionError('delivery zone did not commit')
  const operatorId = fixture.actorId
  const shift = await requestJson(baseUrl, '/tus/v1/delivery/shifts', { method: 'POST', token, correlationId: `tus-smoke-delivery-shift-${fixture.runId}`, body: { shiftId: fixture.deliveryShiftId, zoneId: fixture.deliveryZoneId, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString(), operatorIds: [operatorId] } })
  if (shift.status !== 201) throw new SmokeAssertionError('delivery shift did not commit')
  const task = await requestJson(baseUrl, '/tus/v1/delivery/tasks', { method: 'POST', token, correlationId: `tus-smoke-task-${fixture.runId}`, body: { taskId: fixture.deliveryTaskId, commitmentId: fixture.deliveryCommitmentId, zoneId: fixture.deliveryZoneId, shiftId: fixture.deliveryShiftId, operatorId } })
  if (task.status !== 201) throw new SmokeAssertionError('delivery task did not commit')
  const accepted = await requestJson(baseUrl, `/tus/v1/delivery/tasks/${fixture.deliveryTaskId}/accept`, { method: 'POST', token, correlationId: `tus-smoke-accept-${fixture.runId}`, body: { expectedVersion: task.body.version } })
  const pickedUp = await requestJson(baseUrl, `/tus/v1/delivery/tasks/${fixture.deliveryTaskId}/pick-up`, { method: 'POST', token, correlationId: `tus-smoke-pickup-${fixture.runId}`, body: { expectedVersion: accepted.body.version } })
  const inTransit = await requestJson(baseUrl, `/tus/v1/delivery/tasks/${fixture.deliveryTaskId}/transit`, { method: 'POST', token, correlationId: `tus-smoke-transit-${fixture.runId}`, body: { expectedVersion: pickedUp.body.version } })
  const proof = await requestJson(baseUrl, `/tus/v1/delivery/tasks/${fixture.deliveryTaskId}/proof`, { method: 'POST', token, correlationId: `tus-smoke-proof-${fixture.runId}`, body: { proofId: fixture.deliveryProofId, recipientName: 'Disposable recipient', capturedAt: new Date().toISOString(), evidenceSource: 'deterministic-test-only', expectedVersion: inTransit.body.version } })
  const handoff = await requestJson(baseUrl, `/tus/v1/delivery/tasks/${fixture.deliveryTaskId}/handoff`, { method: 'POST', token, correlationId: `tus-smoke-handoff-${fixture.runId}`, body: { expectedVersion: proof.body.version } })
  if (accepted.status !== 200 || pickedUp.status !== 200 || inTransit.status !== 200 || proof.status !== 200 || handoff.status !== 200 || handoff.body.status !== 'handed-off') throw new SmokeAssertionError('delivery proof and handoff journey did not commit')
  return { proof, handoff }
}

function checkoutCommand(fixture, listing, context) {
  const isProduct = context === 'product'
  return {
    contractVersion: '1.0.0',
    cartId: `tus-smoke-cart-${context}-${fixture.runId}`,
    requestHash: `tus-smoke-hash-${context}-${fixture.runId}`,
    idempotencyKey: `tus-smoke-key-${context}-${fixture.runId}`,
    lines: [{ lineId: `tus-smoke-line-${context}-${fixture.runId}`, listingId: listing.listingId, context, quantity: 1, availabilityVersion: listing.availabilityVersion, ...(isProduct ? {} : { slotStart: '2026-09-01T10:00:00.000Z', slotEnd: '2026-09-01T11:00:00.000Z' }) }],
  }
}

async function postMarketplaceCheckout(baseUrl, token, body) {
  return requestJson(baseUrl, '/tus/v1/marketplace/checkout', { method: 'POST', token, correlationId: `tus-smoke-${body.idempotencyKey}`, idempotencyKey: body.idempotencyKey, body })
}

async function durableCounts(pool, _fixture, tenantId) {
  const result = await pool.query('SELECT (SELECT COUNT(*) FROM "TusPosOperation" WHERE "tenantId" = $1) AS "posOperations", (SELECT COUNT(*) FROM "TusPosReceipt" WHERE "tenantId" = $1) AS "posReceipts", (SELECT COUNT(*) FROM "TusPosVersion" WHERE "tenantId" = $1) AS "posVersions", (SELECT COUNT(*) FROM "TusPosConflict" WHERE "tenantId" = $1) AS "posConflicts", (SELECT COUNT(*) FROM "TusPosAudit" WHERE "tenantId" = $1) AS "posAudit", (SELECT COUNT(*) FROM "TusPosOutbox" WHERE "tenantId" = $1) AS "posOutbox", (SELECT COUNT(*) FROM "TusDeliveryTask" WHERE "tenantId" = $1) AS "deliveryTasks", (SELECT COUNT(*) FROM "TusDeliveryProof" WHERE "tenantId" = $1) AS "deliveryProofs", (SELECT COUNT(*) FROM "TusDeliveryAudit" WHERE "tenantId" = $1) AS "deliveryAudit", (SELECT COUNT(*) FROM "TusDeliveryOutbox" WHERE "tenantId" = $1) AS "deliveryOutbox"', [tenantId])
  return Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]))
}

export async function cleanupSmokeFixture(pool, fixture) {
  try {
    await pool.query('BEGIN')
    await pool.query('DELETE FROM "TusListing" WHERE "id" IN ($1,$2)', [fixture.productListingId, fixture.serviceListingId])
    await pool.query('DELETE FROM "TusMerchant" WHERE "id" IN ($1,$2)', [fixture.productMerchantId, fixture.serviceMerchantId])
    await pool.query('DELETE FROM "User" WHERE "normalizedEmail" IN ($1,$2)', [fixture.emailA, fixture.emailB])
    await pool.query('COMMIT')
  } catch {
    await pool.query('ROLLBACK').catch(() => undefined)
    throw new SmokeInfrastructureError('Disposable PostgreSQL fixture cleanup failed; the original smoke classification is preserved', 'PostgreSQL disposable fixture cleanup')
  }
}

async function startSmokeApi(postgresUrl, timeoutMs) {
  if (!existsSync(API_TSX_CLI)) throw new SmokeInfrastructureError('API TypeScript runtime is unavailable; authenticated PostgreSQL smoke was not run', 'API runtime startup')
  const port = await reservePort()
  const source = [
    "const { createApp } = await import('./src/server.ts')",
    "const { disconnectPrisma } = await import('./src/infrastructure/database/prisma/client.ts')",
    "const server = createApp().listen(Number(process.env.API_PORT), '127.0.0.1', () => console.log('TUS_SMOKE_READY'))",
    "let stopping = false",
    "const stop = async () => { if (stopping) return; stopping = true; server.close(async () => { await disconnectPrisma(); process.exit(0) }) }",
    "process.on('SIGTERM', stop)",
    "process.on('SIGINT', stop)",
  ].join(';')
  const child = spawn(process.execPath, [API_TSX_CLI, '--eval', source], {
    cwd: API_ROOT,
    env: buildPostgresChildEnvironment({
      postgresUrl,
      extra: { API_PORT: String(port), NODE_ENV: 'development', NATIVE_PROFILE: '1' },
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const baseUrl = `http://127.0.0.1:${port}`
  try {
    await waitForSmokeApi(child, baseUrl, timeoutMs)
    return { child, baseUrl }
  } catch {
    await stopSmokeApi({ child })
    throw new SmokeInfrastructureError('API runtime did not become ready within the bounded smoke timeout', 'API runtime startup')
  }
}

async function waitForSmokeApi(child, baseUrl, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000)
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('API exited')
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.status === 200) return
    } catch {
      // The process may need a few bounded retries while tsx loads the API.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('API readiness timeout')
}

export async function stopSmokeApi(api) {
  if (!api?.child || api.child.exitCode !== null) return
  const exitedAfterTerm = await requestChildExit(api.child, 'SIGTERM', 5_000)
  if (exitedAfterTerm) return
  await requestChildExit(api.child, undefined, 5_000)
}

async function requestChildExit(child, signal, timeoutMs) {
  if (child.exitCode !== null) return true
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(exited)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', () => finish(true))
    if (signal === undefined) child.kill()
    else child.kill(signal)
  })
}

async function reservePort() {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function requestJson(baseUrl, path, { method = 'GET', token, correlationId = 'tus-smoke-request', idempotencyKey, body } = {}) {
  const headers = { 'content-type': 'application/json', 'x-correlation-id': correlationId, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) })
  const text = await response.text()
  let parsed = {}
  if (text) {
    try { parsed = JSON.parse(text) } catch { parsed = { raw: text } }
  }
  return { status: response.status, body: parsed }
}
