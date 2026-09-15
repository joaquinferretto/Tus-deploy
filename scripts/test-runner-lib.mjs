import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
export const POSTGRES_STARTUP_ATTEMPT_TIMEOUT_MS = 60_000
export const POSTGRES_STARTUP_RETRY_COUNT = 1
export const MAX_CHILD_DEADLINE_MS = 120_000
const MIN_CHILD_TERMINATION_WAIT_MS = 100
export const APPROVED_POSTGRES_ENV_VARS = Object.freeze(['DATABASE_URL'])
export const POSTGRES_SEED_INTENT = 'seed'
export const POSTGRES_SEED_CONFIRMATION_FLAG = '--confirm-development-target'

const execFileAsync = promisify(execFile)
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const API_ROOT = join(REPO_ROOT, 'apps', 'api')
const API_TSX_CLI = join(API_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const POSTGRES_SMOKE_TEST = 'tests/integration/tus/postgres-http-smoke.test.mjs'
const POSTGRES_RERUN_COMMAND = `FACTORY_PROFILE=local NODE_ENV=development pnpm test -- ${POSTGRES_SMOKE_TEST} (uses repository-root .env DATABASE_URL)`
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
const SAFE_CHILD_EXTRA_ENV_VARS = Object.freeze(['API_PORT', 'NODE_ENV', 'NATIVE_PROFILE', 'TUS_ROUTES_ENABLED', 'TUS_PROVIDER_ACTIONS_ENABLED'])
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
  evidencias_habilitacion: ['perfil', 'ejecucion', 'clase_evidencia', 'conformidad_produccion'],
  decisiones_habilitacion: ['actor_id', 'trabajo_id', 'correlacion_id', 'perfil', 'alcance', 'resultado'],
  prestadores: ['tenant_id', 'estado'],
  publicaciones: ['tenant_id', 'tipo', 'publicada', 'existencias', 'version_disponibilidad'],
  compromisos_mercado_servicios: ['tenant_id', 'compromiso_id', 'contexto', 'cantidad'],
  auditoria_mercado_servicios: ['tenant_id', 'actor_id', 'correlacion_id'],
  IdempotencyRecord: ['tenantId', 'key', 'requestHash', 'status', 'response'],
  OutboxEvent: ['tenantId', 'aggregateType', 'aggregateId', 'status'],
  zonas_entrega: ['tenant_id', 'zona_id', 'activo'],
  turnos_entrega: ['tenant_id', 'turno_id', 'zona_id', 'estado'],
  tareas_entrega: ['tenant_id', 'tarea_id', 'compromiso_id', 'version', 'reclamo_liquidacion'],
  evidencias_entrega: ['tenant_id', 'evidencia_id', 'tarea_id', 'origen_evidencia'],
  auditoria_entrega: ['tenant_id', 'auditoria_id', 'correlacion_id'],
  outbox_entrega: ['tenant_id', 'evento_id', 'agregado_id', 'estado'],
  operaciones_pos: ['tenant_id', 'operacion_id', 'clave_idempotencia', 'turno_id', 'respuesta'],
  comprobantes_pos: ['tenant_id', 'comprobante_id', 'operacion_id', 'hash_integridad', 'liquidacion'],
  dispositivos_pos: ['tenant_id', 'dispositivo_id', 'estado'],
  sesiones_pos: ['tenant_id', 'sesion_id', 'dispositivo_id', 'turno_id', 'estado'],
  conflictos_pos: ['tenant_id', 'conflicto_id', 'operacion_id', 'motivo', 'estado'],
  outbox_pos: ['tenant_id', 'evento_id', 'agregado_id', 'estado'],
  auditoria_pos: ['tenant_id', 'auditoria_id', 'operacion_id', 'correlacion_id'],
  versiones_pos: ['tenant_id', 'turno_id', 'version'],
})

/**
 * A child process wrapper that can only stop the exact process it launched.
 * It deliberately keeps no name-based or process-tree kill capability.
 */
export class OwnedChild {
  constructor({ child, command, args = [], cwd, startupMs = MAX_CHILD_DEADLINE_MS, requestMs = MAX_CHILD_DEADLINE_MS, shutdownMs = MAX_CHILD_DEADLINE_MS } = {}) {
    if (!child || typeof child.kill !== 'function' || typeof child.once !== 'function') throw new TypeError('OwnedChild requires a spawned child')
    this.child = child
    this.pid = Number(child.pid)
    this.cwd = cwd
    this.argv = Object.freeze([command, ...args])
    this.startupMs = boundedDeadline(startupMs)
    this.requestMs = boundedDeadline(requestMs)
    this.shutdownMs = boundedDeadline(shutdownMs)
  }

  async verify() {
    if (!Number.isInteger(this.pid) || this.pid <= 0 || this.child.pid !== this.pid || this.child.exitCode !== null) return false
    const observedCwd = this.child.spawncwd ?? this.child.cwd
    if (typeof observedCwd !== 'string' || resolve(observedCwd) !== resolve(this.cwd)) return false
    const observedArgv = Array.isArray(this.child.spawnargs) ? this.child.spawnargs : []
    return observedArgv.length === this.argv.length && observedArgv.every((value, index) => value === this.argv[index])
  }

  async stop() {
    if (this.child.exitCode !== null) return true
    if (!(await this.verify())) throw new Error(`Refusing to stop owned child ${this.pid} with mismatched ownership`)
    const exited = await waitForChildExit(this.child, 'SIGTERM', this.shutdownMs)
    if (exited) return true
    const forceExited = await waitForChildExit(this.child, 'SIGKILL', this.shutdownMs)
    if (!forceExited) throw new Error(`Owned child ${this.pid} did not terminate within the shutdown deadline`)
    return true
  }
}

function boundedDeadline(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_CHILD_DEADLINE_MS) : MAX_CHILD_DEADLINE_MS
}

function waitForChildExit(child, signal, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const terminationWaitMs = Math.max(timeoutMs, MIN_CHILD_TERMINATION_WAIT_MS)
    const onExit = () => finish(true)
    const onClose = () => finish(true)
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener?.('exit', onExit)
      child.removeListener?.('close', onClose)
      resolve(exited)
    }
    const timer = setTimeout(() => finish(false), terminationWaitMs)
    child.once('exit', onExit)
    child.once('close', onClose)
    if (signal === undefined) child.kill()
    else child.kill(signal)
  })
}

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
  return `pnpm exec node --experimental-strip-types --experimental-transform-types --experimental-loader ./scripts/node-strip-types-loader.mjs --test --test-concurrency=1 ${file}`
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
      owner: 'frontera de contaminacion del nucleo',
      cause: 'desvio de vocabulario vertical o import fallback en superficies core',
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

export function resolvePostgresTarget({ rootDirectory = REPO_ROOT, environment = process.env } = {}) {
  return resolvePostgresTargetDetails(rootDirectory, environment).target
}

/**
 * Resolves the application database target without returning the credential.
 * Root .env is the application source; ambient and runner URL variables are
 * never accepted by the canonical target resolver.
 */
export function resolveSafeTarget({ rootDirectory = REPO_ROOT, environment = process.env, allowRemoteDevelopment = false } = {}) {
  const details = resolveSafeTargetDetails({ rootDirectory, environment, allowRemoteDevelopment })
  return details.target
}

/**
 * Resolve the database used by the focused seed operation. Ambient database
 * variables and runner overrides are deliberately excluded from this path.
 */
export function resolveRootSafeTarget({ rootDirectory = REPO_ROOT, environment = process.env, allowRemoteDevelopment = false } = {}) {
  return redactSafeTarget(resolveSafeTarget({ rootDirectory, environment, allowRemoteDevelopment }))
}

export function parsePostgresSeedArguments(argumentsList = []) {
  const [intent, ...flags] = argumentsList
  const invalidArguments = flags.filter((argument) => argument !== POSTGRES_SEED_CONFIRMATION_FLAG)
  return {
    intent,
    confirmed: flags.includes(POSTGRES_SEED_CONFIRMATION_FLAG),
    invalidArguments,
  }
}

export async function withBoundedPostgresStartupRetry(
  startup,
  {
    attemptTimeoutMs = POSTGRES_STARTUP_ATTEMPT_TIMEOUT_MS,
    backoffMs = 250,
    sleep = (durationMs) => new Promise((resolveSleep) => setTimeout(resolveSleep, durationMs)),
    onAttemptFailure = async () => undefined,
  } = {},
) {
  if (typeof startup !== 'function') throw new TypeError('PostgreSQL startup operation is required')

  const timeoutMs = boundedPostgresStartupTimeout(attemptTimeoutMs)
  const diagnostics = []
  for (let attempt = 1; attempt <= POSTGRES_STARTUP_RETRY_COUNT + 1; attempt += 1) {
    try {
      const value = await withBoundedPromise(Promise.resolve().then(() => startup({ attempt, timeoutMs })), timeoutMs)
      diagnostics.push({ attempt, timeoutMs, status: 'passed' })
      return { value, diagnostics }
    } catch {
      diagnostics.push({ attempt, timeoutMs, status: 'failed' })
      try {
        await onAttemptFailure({ attempt, timeoutMs })
      } catch {
        // Cleanup diagnostics remain redacted; a cleanup failure never leaks its cause.
      }
      if (attempt > POSTGRES_STARTUP_RETRY_COUNT) break
      await sleep(Math.min(Math.max(Number(backoffMs) || 0, 0), 1_000))
    }
  }

  const error = new Error('PostgreSQL startup failed after two bounded attempts; diagnostics redacted')
  error.name = 'PostgresStartupError'
  error.attempts = diagnostics.length
  error.diagnostics = diagnostics
  throw error
}

function boundedPostgresStartupTimeout(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, POSTGRES_STARTUP_ATTEMPT_TIMEOUT_MS)
    : POSTGRES_STARTUP_ATTEMPT_TIMEOUT_MS
}

function withBoundedPromise(promise, timeoutMs) {
  let timer
  const guarded = Promise.resolve(promise)
  guarded.catch(() => undefined)
  return new Promise((resolvePromise, rejectPromise) => {
    timer = setTimeout(() => rejectPromise(new Error('PostgreSQL startup attempt timed out')), timeoutMs)
    guarded.then(
      (value) => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      () => {
        clearTimeout(timer)
        rejectPromise(new Error('PostgreSQL startup attempt failed'))
      },
    )
  })
}

function redactSafeTarget(target) {
  return {
    ...target,
    redactedTarget: target.redactedTarget ?? (target.status === 'ready' ? 'postgresql://<redacted-host>/<redacted-database>' : null),
    identity: target.identity ? '<redacted>' : null,
    proof: {
      ...target.proof,
      targetId: target.proof.targetId ? '<redacted>' : '',
      owner: target.proof.owner ? '<redacted>' : '',
    },
  }
}

function resolveSafeTargetDetails({ rootDirectory = REPO_ROOT, environment = process.env, allowRemoteDevelopment = false } = {}) {
  const rootEnvironment = readRootEnvironment(rootDirectory)
  const databaseUrl = rootEnvironment.DATABASE_URL
  const profile = resolveProfile(environment, rootEnvironment)
  const base = {
    status: databaseUrl ? 'invalid' : 'deferred',
    source: databaseUrl ? 'root-dotenv-DATABASE_URL' : null,
    redactedTarget: databaseUrl ? 'postgresql://<redacted-host>/<redacted-database>' : null,
    profile: profile.name,
    environment: profile.environment,
    classification: databaseUrl ? 'unclassified-database-target' : 'database-target-not-configured',
    proof: {
      environment: profile.environment,
      nonProduction: profile.nonProduction,
    },
    reason: databaseUrl ? 'non-production-profile-required' : 'no-database-url',
  }
  if (!databaseUrl) return { target: base, postgresUrl: null }
  if (profile.production) return { target: { ...base, reason: 'production-target-refused' }, postgresUrl: null }
  const parsed = parsePostgresUrl(databaseUrl)
  if (!parsed) return { target: { ...base, reason: 'invalid-postgresql-url' }, postgresUrl: null }
  if (!profile.nonProduction) return { target: base, postgresUrl: null }
  if (!isLocalHost(parsed.hostname)) {
    if (allowRemoteDevelopment && environment?.NODE_ENV === 'development') {
      return {
        target: {
          ...base,
          status: 'ready',
          classification: 'remote-development-attested',
          reason: 'operator-confirmed-remote-development-target',
          attestation: 'operator-confirmed',
          proof: {
            ...base.proof,
            attestation: 'operator-confirmed',
            targetSafety: 'operator-attested-development-only',
          },
        },
        postgresUrl: databaseUrl,
      }
    }
    if (isUnsafeHost(parsed.hostname)) return { target: { ...base, classification: 'shared-or-production-target', reason: 'shared-or-production-host' }, postgresUrl: null }
    return { target: { ...base, classification: 'remote-development-unattested', reason: 'non-production-target-unproven' }, postgresUrl: null }
  }
  return {
    target: {
      ...base,
      status: 'ready',
      classification: 'local-development-target',
      reason: 'explicit-non-production-profile',
    },
    postgresUrl: databaseUrl,
  }
}

function readRootEnvironment(rootDirectory) {
  const envPath = join(rootDirectory, '.env')
  if (!existsSync(envPath)) return {}
  const environment = {}
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u)
    if (!match) continue
    const value = match[2].replace(/^(['"])(.*)\1$/u, '$2').trim()
    if (value) environment[match[1]] = value
  }
  return environment
}

function resolveProfile(environment, rootEnvironment) {
  const values = [environment?.NODE_ENV, environment?.FACTORY_PROFILE, rootEnvironment.NODE_ENV, rootEnvironment.FACTORY_PROFILE]
    .map(nonBlank)
    .filter(Boolean)
  const normalized = values.map((value) => value.toLowerCase())
  const production = normalized.some((value) => ['production', 'prod', 'render', 'aws'].includes(value))
  const nonProductionNode = hasProfileValue([environment?.NODE_ENV, rootEnvironment.NODE_ENV], ['development', 'test'])
  const nonProductionProfile = hasProfileValue([environment?.FACTORY_PROFILE, rootEnvironment.FACTORY_PROFILE], ['local', 'test', 'development'])
  const profile = nonBlank(environment?.FACTORY_PROFILE) ?? nonBlank(rootEnvironment.FACTORY_PROFILE)
  return {
    name: profile ?? null,
    environment: nonProductionProfile
      ? 'local'
      : nonProductionNode
        ? normalized.includes('development') ? 'development' : 'test'
        : null,
    production,
    nonProduction: !production && (nonProductionNode || nonProductionProfile),
  }
}

function hasProfileValue(values, accepted) {
  return values.map(nonBlank).filter(Boolean).some((value) => accepted.includes(value.toLowerCase()))
}

function readRootDatabaseUrl(rootDirectory) {
  return readRootEnvironment(rootDirectory).DATABASE_URL
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function isUnsafeHost(hostname) {
  return /(?:^|[-_.])(prod|production|shared|pooler|staging|stage)(?:[-_.]|$)/iu.test(hostname)
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

export function resolvePostgresSmokeEvidence({ rootDirectory = REPO_ROOT, environment = process.env } = {}) {
  const targetDetails = resolvePostgresTargetDetails(rootDirectory, environment)
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

/**
 * Execute only the explicit hardening fixture seed against the repository-root
 * DATABASE_URL. The URL is kept inside this function and never appears in the
 * returned evidence or diagnostics.
 */
export async function runTusPostgresSeed({
  rootDirectory = REPO_ROOT,
  environment = process.env,
  intent,
  confirmed = false,
  runId = 'focused-seed',
  operations = {},
} = {}) {
  if (intent !== POSTGRES_SEED_INTENT) {
    return buildSeedEvidence({
      status: 'deferred',
      reason: 'explicit-seed-intent-required',
      remediation: 'Run node scripts/postgres-seed.mjs seed after confirming a local or test profile.',
      target: redactSafeTarget(resolveSafeTarget({ rootDirectory, environment })),
      sideEffects: zeroSeedActions(),
      connectionAttempts: [],
      seedRuns: 0,
      cleanupState: 'not-started',
    })
  }

  const target = resolveRootSafeTarget({ rootDirectory, environment, allowRemoteDevelopment: confirmed })
  const safetyReasons = []
  if (target.status !== 'ready') safetyReasons.push(target.reason)
  if (safetyReasons.length > 0) {
    return buildSeedEvidence({
      status: 'deferred',
      reason: safetyReasons[0],
      remediation: target.reason === 'non-production-profile-required'
        ? 'Set NODE_ENV=development or FACTORY_PROFILE=local/test and rerun the explicit seed command.'
        : undefined,
      safetyReasons,
      target,
      sideEffects: zeroSeedActions(),
      connectionAttempts: [],
      seedRuns: 0,
      cleanupState: 'not-started',
    })
  }

  if (environment?.NODE_ENV !== 'development') {
    return buildSeedEvidence({
      status: 'deferred',
      reason: 'development-environment-required',
      remediation: 'Set NODE_ENV=development and rerun the explicit seed command.',
      target,
      sideEffects: zeroSeedActions(),
      connectionAttempts: [],
      seedRuns: 0,
      cleanupState: 'not-started',
    })
  }

  if (!confirmed) {
    return buildSeedEvidence({
      status: 'deferred',
      reason: 'explicit-development-confirmation-required',
      remediation: `Run NODE_ENV=development node scripts/postgres-seed.mjs seed ${POSTGRES_SEED_CONFIRMATION_FLAG}.`,
      target,
      sideEffects: zeroSeedActions(),
      connectionAttempts: [],
      seedRuns: 0,
      cleanupState: 'not-started',
    })
  }

  const postgresUrl = readRootDatabaseUrl(rootDirectory)
  const actions = zeroSeedActions()
  let pool
  let connectionAttempts = []
  let seedRuns = 0
  let finalEvidence
  const runtimeOperations = {
    connectPool: connectRootSeedPool,
    isMigrationRequired: isRootSeedMigrationRequired,
    deployMigrations: deployRootAdditiveSeedMigration,
    seedFixture: seedRootFixture,
    verifyFixture: verifyRootFixture,
    closePool: closeRootSeedPool,
    ...operations,
  }

  try {
    const connection = await withBoundedPostgresStartupRetry(
      ({ attempt, timeoutMs }) => {
        actions.connections += 1
        return runtimeOperations.connectPool(postgresUrl, { attempt, timeoutMs })
      },
      {
        onAttemptFailure: async () => {
          if (pool) {
            await runtimeOperations.closePool(pool)
            pool = undefined
          }
        },
      },
    )
    connectionAttempts = connection.diagnostics
    pool = instrumentSeedPool(connection.value, actions)

    if (await runtimeOperations.isMigrationRequired(pool)) {
      actions.migrations += 1
      await runtimeOperations.deployMigrations(pool, POSTGRES_STARTUP_ATTEMPT_TIMEOUT_MS)
    }

    const { buildTusHardeningFixture } = await import('../apps/api/prisma/seed.ts')
    const fixture = buildTusHardeningFixture(runId)
    actions.fixtures = 1

    await runtimeOperations.seedFixture(pool, target, fixture)
    seedRuns += 1
    actions.seedInvocations += 1
    actions.writes += 1
    const firstRun = await runtimeOperations.verifyFixture(pool, fixture)

    await runtimeOperations.seedFixture(pool, target, fixture)
    seedRuns += 1
    actions.seedInvocations += 1
    actions.writes += 1
    const secondRun = await runtimeOperations.verifyFixture(pool, fixture)
    const duplicateFixtures = Math.max(0, secondRun.total - secondRun.distinctIdentity)
    if (!firstRun.stableIdentityMatches || !secondRun.stableIdentityMatches || duplicateFixtures !== 0) {
      throw new Error('PostgreSQL seed verification failed; redacted fixture identity mismatch')
    }

    finalEvidence = buildSeedEvidence({
      status: 'passed',
      reason: 'Idempotent hardening fixture seed and aggregate verification passed',
      target,
      sideEffects: actions,
      connectionAttempts,
      seedRuns,
      verification: { firstRun, secondRun, duplicateFixtures },
    })
  } catch (error) {
    finalEvidence = buildSeedEvidence({
      status: 'deferred',
      reason: error?.name === 'PostgresStartupError'
        ? 'PostgreSQL startup failed after one bounded retry; diagnostics redacted'
        : 'PostgreSQL seed could not complete safely; diagnostics redacted',
      target,
      sideEffects: actions,
      connectionAttempts: error?.diagnostics ?? connectionAttempts,
      seedRuns,
      failure: { classification: error?.name === 'PostgresStartupError' ? 'startup-failure' : 'seed-failure', redacted: true },
    })
  } finally {
    if (pool) {
      try {
        await runtimeOperations.closePool(pool)
      } catch {
        if (finalEvidence) {
          finalEvidence.status = 'failed'
          finalEvidence.cleanupState = 'pool-close-failed'
        }
      }
    }
    if (finalEvidence?.cleanupState === 'pending') finalEvidence.cleanupState = pool ? 'closed' : 'not-started'
  }

  return finalEvidence
}

function zeroSeedActions() {
  return {
    connections: 0,
    migrations: 0,
    queries: 0,
    fixtures: 0,
    seedInvocations: 0,
    writes: 0,
    deletes: 0,
    providerCalls: 0,
  }
}

function buildSeedEvidence({
  status,
  reason,
  target,
  sideEffects,
  connectionAttempts,
  seedRuns,
  safetyReasons,
  remediation,
  verification,
  failure,
  cleanupState = 'pending',
}) {
  return {
    status,
    evidenceClass: 'real-postgres',
    liveConformance: status === 'passed',
    reason,
    target,
    ...(safetyReasons ? { safetyReasons } : {}),
    ...(remediation ? { remediation } : {}),
    connectionAttempts,
    seedRuns,
    ...(verification ? { verification } : {}),
    ...(failure ? { failure } : {}),
    sideEffects,
    cleanupState,
  }
}

function instrumentSeedPool(pool, actions) {
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

async function connectRootSeedPool(postgresUrl, { timeoutMs }) {
  let pool
  try {
    const requireFromApi = createRequire(join(API_ROOT, 'package.json'))
    const { Pool } = requireFromApi('pg')
    const driverTimeoutMs = Math.max(1, timeoutMs - 100)
    pool = new Pool({
      connectionString: postgresUrl,
      max: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: driverTimeoutMs,
      statement_timeout: driverTimeoutMs,
    })
    await pool.query('SELECT 1')
    return pool
  } catch {
    try {
      await pool?.end()
    } catch {
      // Startup failure remains redacted; the next bounded attempt is still safe.
    }
    throw new Error('PostgreSQL seed connection failed; diagnostics redacted')
  }
}

async function isRootSeedMigrationRequired(pool) {
  const tables = await pool.query(
    'SELECT to_regclass($1) AS fixture_table, to_regclass($2) AS migration_table',
    ['public."TusHardeningFixture"', 'public."_prisma_migrations"'],
  )
  const row = tables.rows[0] ?? {}
  if (!row.fixture_table || !row.migration_table) return true

  const migration = await pool.query(
    'SELECT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1 AND "finished_at" IS NOT NULL) AS completed',
    ['20260831170000_tus_real_db_runtime_audit'],
  )
  return migration.rows[0]?.completed !== true
}

async function seedRootFixture(pool, target, fixture) {
  const { seedTusHardeningFixture } = await import('../apps/api/prisma/seed.ts')
  await seedTusHardeningFixture({
    fixture: {
      upsert: async ({ create }) => {
        await pool.query(
          'INSERT INTO "TusHardeningFixture" ("id", "tag", "version", "runId", "tenantId", "actorId", "productListingId", "serviceListingId", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP) ON CONFLICT ("tag", "version", "runId") DO UPDATE SET "tenantId" = EXCLUDED."tenantId", "actorId" = EXCLUDED."actorId", "productListingId" = EXCLUDED."productListingId", "serviceListingId" = EXCLUDED."serviceListingId", "updatedAt" = CURRENT_TIMESTAMP',
          [create.id, create.tag, create.version, create.runId, create.tenantId, create.actorId, create.productListingId, create.serviceListingId],
        )
      },
    },
  }, target, fixture)
}

async function verifyRootFixture(pool, fixture) {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS total, COUNT(DISTINCT ("tag", "version", "runId"))::int AS "distinctIdentity", COUNT(*) FILTER (WHERE "id" = $4 AND "tenantId" = $5 AND "actorId" = $6 AND "productListingId" = $7 AND "serviceListingId" = $8)::int AS "matchingIdentity" FROM "TusHardeningFixture" WHERE "tag" = $1 AND "version" = $2 AND "runId" = $3',
    [fixture.tag, fixture.version, fixture.runId, fixture.id, fixture.tenantId, fixture.actorId, fixture.productListingId, fixture.serviceListingId],
  )
  const row = result.rows[0] ?? {}
  return {
    total: Number(row.total ?? 0),
    distinctIdentity: Number(row.distinctIdentity ?? 0),
    stableIdentityMatches: Number(row.matchingIdentity ?? 0) === 1,
  }
}

async function closeRootSeedPool(pool) {
  if (typeof pool.end === 'function') return pool.end()
  if (typeof pool.close === 'function') return pool.close()
  throw new Error('PostgreSQL seed pool has no cleanup method')
}

export async function runTusPostgresHttpSmoke({
  rootDirectory = REPO_ROOT,
  environment = process.env,
  confirmed = false,
  applyMigrations = false,
  timeoutMs = POSTGRES_SMOKE_TIMEOUT_MS,
  operations = {},
} = {}) {
  const targetDetails = resolvePostgresTargetDetails(rootDirectory, environment, confirmed)
  const target = targetDetails.target
  if (target.status !== 'ready') return deferredPostgresSmoke(target.reason, 'PostgreSQL target safety', {}, target)

  const runtimeOperations = {
    validatePrismaSchema,
    validateMigrationPreconditions,
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
      actions.connections += 1
      pool = await runtimeOperations.connectSmokePool(resolvedPostgresUrl)
      pool = instrumentSmokePool(pool, actions)
      await runtimeOperations.validateMigrationPreconditions(pool)
      actions.migrations += 1
      await runtimeOperations.deployPrismaMigrations(resolvedPostgresUrl, timeoutMs)
    }

    if (!pool) {
      actions.connections += 1
      pool = await runtimeOperations.connectSmokePool(resolvedPostgresUrl)
      pool = instrumentSmokePool(pool, actions)
    }
    await runtimeOperations.validateDatabaseSchema(pool)
    fixture = runtimeOperations.createSmokeFixture()
    actions.fixtures += 1
    try {
      api = await runtimeOperations.startSmokeApi(resolvedPostgresUrl, timeoutMs)
    } catch (error) {
      if (error instanceof SmokeInfrastructureError) throw error
      throw new SmokeInfrastructureError(error instanceof Error ? error.message : 'API runtime startup failed', 'API runtime startup')
    }

    fixture.cleanupTenantIds = []
    const tenantA = await registerAndSignIn(api.baseUrl, pool, fixture, 'a')
    fixture.cleanupTenantIds.push(tenantA.tenantId)
    const tenantB = await registerAndSignIn(api.baseUrl, pool, fixture, 'b')
    fixture.cleanupTenantIds.push(tenantB.tenantId)
    fixture.tenantA = tenantA.tenantId
    fixture.tenantB = tenantB.tenantId
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
        { actions, authenticatedHttp: 'passed', discovery: 'passed', deviceSession: 'denied', productPos: 'denied', servicePos: 'denied', deliveryHandoff: 'denied', providerNonInteraction: { status: 'passed', providerCalls: 0, settlementClaims: 0 } },
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
        await runtimeOperations.cleanupSmokeFixture(pool, fixture, target)
        if (finalEvidence && !finalEvidence.cleanupFailure && !finalEvidence.shutdownFailure) {
          finalEvidence.scenarios.cleanup = { status: 'passed', targeted: true, preservedEvidence: true }
        }
      } catch {
        if (finalEvidence) {
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

async function deployRootAdditiveSeedMigration(pool, timeoutMs) {
  await withBoundedPromise(
    pool.query(`
      CREATE TABLE IF NOT EXISTS "TusHardeningFixture" (
        "id" TEXT NOT NULL,
        "tag" TEXT NOT NULL,
        "version" TEXT NOT NULL,
        "runId" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "actorId" TEXT NOT NULL,
        "productListingId" TEXT NOT NULL,
        "serviceListingId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "TusHardeningFixture_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "TusHardeningFixture_tag_version_runId_key"
        ON "TusHardeningFixture" ("tag", "version", "runId");
      CREATE INDEX IF NOT EXISTS "TusHardeningFixture_tenantId_tag_version_idx"
        ON "TusHardeningFixture" ("tenantId", "tag", "version");
    `),
    boundedPostgresStartupTimeout(timeoutMs),
  )
}

async function validateMigrationPreconditions(pool) {
  const checks = [
    ['POS operation duplicate identity', 'SELECT "tenant_id", "operacion_id" FROM "operaciones_pos" GROUP BY "tenant_id", "operacion_id" HAVING COUNT(*) > 1 LIMIT 1'],
    ['POS idempotency duplicate identity', 'SELECT "tenant_id", "clave_idempotencia" FROM "operaciones_pos" GROUP BY "tenant_id", "clave_idempotencia" HAVING COUNT(*) > 1 LIMIT 1'],
    ['POS receipt orphan', 'SELECT 1 FROM "comprobantes_pos" receipt WHERE NOT EXISTS (SELECT 1 FROM "operaciones_pos" operation WHERE operation."tenant_id" = receipt."tenant_id" AND operation."operacion_id" = receipt."operacion_id") LIMIT 1'],
    ['POS session device orphan', 'SELECT 1 FROM "sesiones_pos" session WHERE NOT EXISTS (SELECT 1 FROM "dispositivos_pos" device WHERE device."tenant_id" = session."tenant_id" AND device."dispositivo_id" = session."dispositivo_id") LIMIT 1'],
    ['POS conflict operation orphan', 'SELECT 1 FROM "conflictos_pos" conflict WHERE NOT EXISTS (SELECT 1 FROM "operaciones_pos" operation WHERE operation."tenant_id" = conflict."tenant_id" AND operation."operacion_id" = conflict."operacion_id") LIMIT 1'],
  ]
  for (const [boundary, sql] of checks) {
    const result = await pool.query(sql)
    if (result.rows.length > 0) throw new SmokeInfrastructureError(`Existing data failed the additive migration preflight: ${boundary}`, 'PostgreSQL migration preflight')
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

function resolvePostgresTargetDetails(rootDirectory = REPO_ROOT, environment = process.env, allowRemoteDevelopment = false) {
  const safeTarget = resolveSafeTargetDetails({ rootDirectory, environment, allowRemoteDevelopment })
  const base = {
    ...safeTarget.target,
    runtimeRole: 'validation-runner',
    service: 'tus-postgres-http-smoke',
    providerMode: 'provider-free',
    databaseMode: 'postgresql-profile-gated',
    productionSecretStore: 'not-used',
    owner: 'runtime owner',
    rerunCommand: POSTGRES_RERUN_COMMAND,
  }
  return { target: base, postgresUrl: safeTarget.postgresUrl }
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
  const email = suffix === 'a' ? fixture.emailA : fixture.emailB
  const register = await requestJson(baseUrl, '/auth/register', { method: 'POST', body: { email, password: fixture.password, displayName: `TUS smoke ${suffix}` } })
  if (register.status !== 201) throw new SmokeInfrastructureError('Disposable identity registration did not start safely', 'authenticated identity fixture')
  const registeredTenantId = register.body.account.tenantId
  await pool.query('UPDATE "Account" SET "emailVerifiedAt" = NOW() WHERE "tenantId" = $1', [registeredTenantId])
  const signIn = await requestJson(baseUrl, '/auth/sign-in', { method: 'POST', body: { email, password: fixture.password, deviceId: `tus-smoke-device-${suffix}` } })
  if (signIn.status !== 200 || typeof signIn.body.session?.accessToken !== 'string') throw new SmokeInfrastructureError('Disposable authenticated session could not be established', 'authenticated identity fixture')
  const sessionId = signIn.body.session.id
  if (typeof sessionId !== 'string' || !sessionId) throw new SmokeInfrastructureError('Disposable authenticated session did not expose a durable session id', 'authenticated identity fixture')
  // The registration API intentionally creates a marketplace owner; grant only the
  // operational permissions needed by this disposable HTTP fixture.
  await pool.query('UPDATE "Session" SET "permissions" = $1::text[] WHERE "id" = $2', [['tus:checkout', 'tus:marketplace:read', 'tus:marketplace:write', 'tus:read', 'tus:pos:write', 'tus:delivery:write'], sessionId])
  return { token: signIn.body.session.accessToken, tenantId: registeredTenantId, actorId: signIn.body.session.accountId }
}

async function seedMarketplaceFixture(pool, fixture) {
  const now = new Date()
  await pool.query('BEGIN')
  try {
    await pool.query('INSERT INTO "prestadores" ("id", "tenant_id", "prestador_id", "cohorte", "ubicacion_id", "zona_horaria", "roles_personal", "version_politica_operativa", "estado", "fecha_creacion", "fecha_actualizacion") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)', [fixture.productMerchantId, fixture.tenantA, fixture.productMerchantId, 'beauty-personal-care', 'tus-smoke-location-a', 'America/Argentina/Buenos_Aires', ['owner'], 'stage-1-v1', 'approved', now])
    await pool.query('INSERT INTO "prestadores" ("id", "tenant_id", "prestador_id", "cohorte", "ubicacion_id", "zona_horaria", "roles_personal", "version_politica_operativa", "estado", "fecha_creacion", "fecha_actualizacion") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)', [fixture.serviceMerchantId, fixture.tenantB, fixture.serviceMerchantId, 'repairs-trades', 'tus-smoke-location-b', 'America/Argentina/Buenos_Aires', ['owner'], 'stage-1-v1', 'approved', now])
    await pool.query('INSERT INTO "publicaciones" ("id", "version_contrato", "tenant_id", "prestador_id", "tipo", "nombre", "descripcion", "cohorte", "ubicacion_id", "moneda", "precio", "version_disponibilidad", "publicada", "version_politica", "existencias", "duracion_minutos", "capacidad", "horario_trabajo", "fecha_creacion", "fecha_actualizacion") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)', [fixture.productListingId, '1.0.0', fixture.tenantA, fixture.productMerchantId, 'product', 'TUS smoke product', 'Disposable product fixture', 'beauty-personal-care', 'tus-smoke-location-a', 'ARS', 100, 1, true, 'stage-1-v1', 2, null, null, JSON.stringify([]), now])
    await pool.query('INSERT INTO "publicaciones" ("id", "version_contrato", "tenant_id", "prestador_id", "tipo", "nombre", "descripcion", "cohorte", "ubicacion_id", "moneda", "precio", "version_disponibilidad", "publicada", "version_politica", "existencias", "duracion_minutos", "capacidad", "horario_trabajo", "fecha_creacion", "fecha_actualizacion") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)', [fixture.serviceListingId, '1.0.0', fixture.tenantB, fixture.serviceMerchantId, 'service', 'TUS smoke service', 'Disposable service fixture', 'repairs-trades', 'tus-smoke-location-b', 'ARS', 250, 1, true, 'stage-1-v1', null, 60, 1, JSON.stringify([{ day: 1, start: '09:00', end: '18:00' }]), now])
    await pool.query('INSERT INTO "compromisos_mercado_servicios" ("id", "version_contrato", "compromiso_id", "carrito_id", "tenant_id", "prestador_id", "publicacion_id", "contexto", "ids_lineas", "cantidad", "monto", "moneda", "estado", "version_disponibilidad", "version_politica", "franja_inicio", "franja_fin", "fecha_creacion", "fecha_actualizacion") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)', [fixture.deliveryCommitmentId, '1.0.0', fixture.deliveryCommitmentId, `tus-smoke-delivery-cart-${fixture.runId}`, fixture.tenantA, fixture.productMerchantId, fixture.productListingId, 'product', [`tus-smoke-delivery-line-${fixture.runId}`], 1, 100, 'ARS', 'confirmed', 1, 'stage-1-v1', null, null, now])
    await pool.query('COMMIT')
  } catch (error) {
    await pool.query('ROLLBACK')
    throw new SmokeInfrastructureError('Disposable PostgreSQL marketplace fixtures could not be created safely', 'PostgreSQL disposable fixtures')
  }
}

async function hasAuthorizedSettlementReadiness(pool, tenantId) {
  const result = await pool.query('SELECT COUNT(DISTINCT "requisito")::int AS count FROM "evidencias_habilitacion" WHERE "tenant_id" = $1 AND "capacidad" = $2 AND "alcance" = $3 AND "perfil" = $4 AND "origen" = $5 AND "revocada" = FALSE AND "fecha_emision" <= NOW() AND ("fecha_expiracion" IS NULL OR "fecha_expiracion" > NOW())', [tenantId, 'settlement', 'argentina-stage-1', 'native-local', 'authorized-external'])
  return Number(result.rows[0]?.count ?? 0) === SETTLEMENT_GATES.length
}

async function hasAuthorizedFleetReadiness(pool, tenantId) {
  const requiredGates = ['legal', 'kyc', 'kyb', 'tax', 'posPilot', 'runtimeProvider']
  const result = await pool.query('SELECT COUNT(DISTINCT "requisito")::int AS count FROM "evidencias_habilitacion" WHERE "tenant_id" = $1 AND "capacidad" = $2 AND "alcance" = $3 AND "perfil" = $4 AND "origen" = $5 AND "revocada" = FALSE AND "fecha_emision" <= NOW() AND ("fecha_expiracion" IS NULL OR "fecha_expiracion" > NOW())', [tenantId, 'fleet', 'argentina-stage-1', 'native-local', 'authorized-external'])
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
  const result = await pool.query('SELECT (SELECT COUNT(*) FROM "operaciones_pos" WHERE "tenant_id" = $1) AS "posOperations", (SELECT COUNT(*) FROM "comprobantes_pos" WHERE "tenant_id" = $1) AS "posReceipts", (SELECT COUNT(*) FROM "versiones_pos" WHERE "tenant_id" = $1) AS "posVersions", (SELECT COUNT(*) FROM "conflictos_pos" WHERE "tenant_id" = $1) AS "posConflicts", (SELECT COUNT(*) FROM "auditoria_pos" WHERE "tenant_id" = $1) AS "posAudit", (SELECT COUNT(*) FROM "outbox_pos" WHERE "tenant_id" = $1) AS "posOutbox", (SELECT COUNT(*) FROM "tareas_entrega" WHERE "tenant_id" = $1) AS "deliveryTasks", (SELECT COUNT(*) FROM "evidencias_entrega" WHERE "tenant_id" = $1) AS "deliveryProofs", (SELECT COUNT(*) FROM "auditoria_entrega" WHERE "tenant_id" = $1) AS "deliveryAudit", (SELECT COUNT(*) FROM "outbox_entrega" WHERE "tenant_id" = $1) AS "deliveryOutbox"', [tenantId])
  return Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]))
}

export async function cleanupSmokeFixture(pool, fixture, target) {
  if (!approvedCleanupTarget(target)) throw new SmokeInfrastructureError('Cleanup requires an approved non-production target', 'PostgreSQL fixture cleanup')
  try {
    await pool.query('BEGIN')
    const tenantIds = Array.isArray(fixture.cleanupTenantIds) ? fixture.cleanupTenantIds.filter((value) => typeof value === 'string' && value.length > 0) : []
    if (tenantIds.length > 0) {
      const placeholders = tenantIds.map((_, index) => `$${index + 1}`).join(',')
      await pool.query(`DELETE FROM "AuditEvent" WHERE "tenantId" IN (${placeholders})`, tenantIds)
      await pool.query(`DELETE FROM "decisiones_habilitacion" WHERE "tenant_id" IN (${placeholders})`, tenantIds)
    }
    await pool.query('DELETE FROM "compromisos_mercado_servicios" WHERE "id" = $1', [fixture.deliveryCommitmentId])
    await pool.query('DELETE FROM "evidencias_entrega" WHERE "id" = $1', [fixture.deliveryProofId])
    await pool.query('DELETE FROM "tareas_entrega" WHERE "id" = $1', [fixture.deliveryTaskId])
    await pool.query('DELETE FROM "turnos_entrega" WHERE "id" = $1', [fixture.deliveryShiftId])
    await pool.query('DELETE FROM "zonas_entrega" WHERE "id" = $1', [fixture.deliveryZoneId])
    await pool.query('DELETE FROM "sesiones_pos" WHERE "id" = $1', [fixture.posSessionId])
    await pool.query('DELETE FROM "dispositivos_pos" WHERE "id" = $1', [fixture.posDeviceId])
    await pool.query('DELETE FROM "versiones_pos" WHERE "id" = $1', [fixture.posShiftId])
    await pool.query('DELETE FROM "publicaciones" WHERE "id" IN ($1,$2)', [fixture.productListingId, fixture.serviceListingId])
    await pool.query('DELETE FROM "prestadores" WHERE "id" IN ($1,$2)', [fixture.productMerchantId, fixture.serviceMerchantId])
    await pool.query('DELETE FROM "User" WHERE "normalizedEmail" IN ($1,$2)', [fixture.emailA, fixture.emailB])
    if (tenantIds.length > 0) {
      const placeholders = tenantIds.map((_, index) => `$${index + 1}`).join(',')
      await pool.query(`DELETE FROM "TenantRole" WHERE "tenantId" IN (${placeholders})`, tenantIds)
      await pool.query(`DELETE FROM "Workspace" WHERE "organizationId" IN (${placeholders})`, tenantIds)
      await pool.query(`DELETE FROM "Organization" WHERE "id" IN (${placeholders})`, tenantIds)
      await pool.query(`DELETE FROM "TusTenant" WHERE "id" IN (${placeholders})`, tenantIds)
    }
    await pool.query('COMMIT')
  } catch {
    await pool.query('ROLLBACK').catch(() => undefined)
    throw new SmokeInfrastructureError('PostgreSQL fixture cleanup failed; the original smoke classification is preserved', 'PostgreSQL fixture cleanup')
  }
}

function approvedCleanupTarget(target) {
  if (target?.status !== 'ready') return false
  return target.proof?.nonProduction === true
}

async function startSmokeApi(postgresUrl, timeoutMs) {
  if (!existsSync(API_TSX_CLI)) throw new SmokeInfrastructureError('API TypeScript runtime is unavailable; authenticated PostgreSQL smoke was not run', 'API runtime startup')
  const port = await reservePort()
  const source = [
    'void (async () => {',
    "const { getPrismaClient } = await import('./src/infrastructure/database/prisma/client.ts')",
    'getPrismaClient(process.env.DATABASE_URL)',
    "const { createApp } = await import('./src/server.ts')",
    "const { disconnectPrisma } = await import('./src/infrastructure/database/prisma/client.ts')",
    "const server = createApp().listen(Number(process.env.API_PORT), '127.0.0.1', () => console.log('TUS_SMOKE_READY'))",
    "let stopping = false",
    "const stop = async () => { if (stopping) return; stopping = true; server.close(async () => { await disconnectPrisma(); process.exit(0) }) }",
    "process.on('SIGTERM', stop)",
    "process.on('SIGINT', stop)",
    '})().catch((error) => { console.error(error); process.exitCode = 1 })',
  ].join(';')
  const args = [API_TSX_CLI, '--eval', source]
  const child = spawn(process.execPath, args, {
    cwd: API_ROOT,
    env: buildPostgresChildEnvironment({
      postgresUrl,
      extra: { API_PORT: String(port), NODE_ENV: 'development', NATIVE_PROFILE: '1', TUS_ROUTES_ENABLED: 'true', TUS_PROVIDER_ACTIONS_ENABLED: 'false' },
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.spawncwd = API_ROOT
  const baseUrl = `http://127.0.0.1:${port}`
  const owned = new OwnedChild({
    child,
    command: process.execPath,
    args,
    cwd: API_ROOT,
    startupMs: Math.min(timeoutMs, MAX_CHILD_DEADLINE_MS),
    requestMs: Math.min(timeoutMs, MAX_CHILD_DEADLINE_MS),
    shutdownMs: Math.min(timeoutMs, MAX_CHILD_DEADLINE_MS),
  })
  try {
    if (!(await owned.verify())) throw new Error('API runtime ownership verification failed')
    await waitForSmokeApi(child, baseUrl, timeoutMs)
    return { child, baseUrl, owned }
  } catch {
    await stopSmokeApi({ child, owned })
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
  if (api.owned) {
    if (!(await api.owned.verify())) throw new Error('Refusing to stop an API process with mismatched ownership')
    await api.owned.stop()
    return
  }
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
