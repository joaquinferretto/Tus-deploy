import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

test('P6.6 clean-environment bootstrap fixture is deterministic and provider-free', () => {
  const result = runTypeScriptScenario(`
    const { loadCleanEnvironmentFixture, validateCleanEnvironmentFixture } = await import('./scripts/validation/portability/index.mjs')
    const fixture = loadCleanEnvironmentFixture(process.cwd())
    console.log(JSON.stringify(validateCleanEnvironmentFixture(fixture)))
  `)

  assert.equal(result.valid, true)
  assert.equal(result.liveConformance, false)
  assert.equal(result.cloudCalls, false)
  assert.equal(result.provisioned, false)
  assert.deepEqual(result.native.commands, [
    'cd backend && pnpm run dev',
    'cd frontend && pnpm run dev',
  ])
  assert.deepEqual(result.cloudNative.profiles, ['render-native', 'aws-terraform'])
})

test('P6.6 portability validation records plan-only parity, contamination, and deferred Compose', () => {
  const result = runTypeScriptScenario(`
    const { runPortabilityValidation } = await import('./scripts/validation/portability/index.mjs')
    console.log(JSON.stringify(await runPortabilityValidation(process.cwd())))
  `)

  assert.equal(result.valid, true)
  assert.equal(result.liveConformance, false)
  assert.equal(result.bootstrap.valid, true)
  assert.equal(result.parity.status, 'pass')
  assert.equal(result.parity.unsupportedProfiles.length, 0)
  assert.equal(result.contamination.valid, true)
  assert.equal(result.compose.status, 'deferred')
  assert.equal(result.compose.liveConformance, false)
  assert.ok(result.cloud.profiles.every((profile) => profile.valid))
})

test('P6.6 fresh-checkout divergence is rejected without live access', () => {
  const result = runTypeScriptScenario(`
    const { validateCleanEnvironmentFixture, loadCleanEnvironmentFixture } = await import('./scripts/validation/portability/index.mjs')
    const fixture = structuredClone(loadCleanEnvironmentFixture(process.cwd()))
    fixture.checkout.maintainerKnowledgeRequired = true
    fixture.cloudNative.profiles = ['compose']
    console.log(JSON.stringify(validateCleanEnvironmentFixture(fixture)))
  `)

  assert.equal(result.valid, false)
  assert.equal(result.status, 'unsupported-profile')
  assert.equal(result.liveConformance, false)
  assert.ok(result.errors.some((error) => error.includes('maintainer-only knowledge')))
  assert.ok(result.errors.some((error) => error.includes('render-native or aws-terraform')))
})

test('P6.6 profile divergence returns an explicit unsupported-profile result', () => {
  const result = runTypeScriptScenario(`
    const { DELIVERY_PROFILES, evaluateProfileParity } = await import('./scripts/validation/portability/index.mjs')
    const divergent = structuredClone(DELIVERY_PROFILES)
    divergent['aws-terraform'].boundaries.queues.rollbackRef = 'duplicate-queue-source'
    console.log(JSON.stringify(evaluateProfileParity(divergent)))
  `)

  assert.equal(result.valid, false)
  assert.equal(result.status, 'unsupported-profile')
  assert.equal(result.liveConformance, false)
  assert.deepEqual(result.unsupportedProfiles, ['aws-terraform'])
  assert.ok(result.divergences.some((divergence) => divergence.profile === 'aws-terraform'))
  assert.match(result.divergences[0].reason, /rollback/i)
})

test('P6.6 portability validator does not read environment values or enable Compose fallback', () => {
  const result = runTypeScriptScenario(`
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('./scripts/validation/portability/index.mjs', 'utf8')
    console.log(JSON.stringify({
      readsEnv: /process\\.env|dotenv|readFileSync\\([^)]*\\.env/.test(source),
      composeFallback: /(?:fallbackProfile|fallbackProfileId|defaultProfile)\\s*[:=]\\s*['"]compose/i.test(source),
    }))
  `)

  assert.equal(result.readsEnv, false)
  assert.equal(result.composeFallback, false)
})
