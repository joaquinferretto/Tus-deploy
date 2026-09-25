import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function serviceSection(content, serviceName, nextServiceName) {
  const start = content.indexOf(`name: ${serviceName}`)
  const end = nextServiceName ? content.indexOf(`name: ${nextServiceName}`, start) : content.length
  return content.slice(start, end)
}

test('deployment profiles expose explicit TUS composition flags with safe defaults', () => {
  const renderBlueprint = read('render.yaml')
  const renderTerraform = read('infra/terraform/environments/render/main.tf')
  const awsTerraform = read('infra/terraform/environments/aws/main.tf')

  for (const content of [renderBlueprint, renderTerraform, awsTerraform]) {
    for (const flag of ['api', 'web', 'workers', 'tusRoutes', 'providers', 'releaseJobs', 'fleetJobs']) {
      assert.match(content, new RegExp(flag), `${flag} must be explicit in the profile`) 
    }
  }

  for (const flag of ['TUS_ROUTES_ENABLED', 'TUS_PROVIDER_ACTIONS_ENABLED', 'TUS_RELEASE_JOBS_ENABLED', 'TUS_FLEET_JOBS_ENABLED']) {
    assert.match(renderBlueprint, new RegExp(`${flag}[\\s\\S]*value:\\s*false`))
  }

  assert.match(renderTerraform, /tusRoutes\s*=\s*false/)
  assert.match(renderTerraform, /providers\s*=\s*false/)
  assert.match(renderTerraform, /releaseJobs\s*=\s*false/)
  assert.match(renderTerraform, /fleetJobs\s*=\s*false/)
  assert.match(awsTerraform, /tusRoutes\s*=\s*false/)
  assert.match(awsTerraform, /providers\s*=\s*false/)
  assert.match(awsTerraform, /releaseJobs\s*=\s*false/)
  assert.match(awsTerraform, /fleetJobs\s*=\s*false/)
})

test('deterministic CI records test, contract, security, policy, and build checks', () => {
  const workflow = read('.github/workflows/ci.yml')

  for (const command of [
    'pnpm install --frozen-lockfile',
    'pnpm test',
    'pnpm run contracts:validate',
    'pnpm run security:scan',
    'node scripts/security/validate-policy.mjs',
    'pnpm run build',
  ]) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')))
  }

  assert.doesNotMatch(workflow, /AWS_ACCESS_KEY|MERCADOPAGO_ACCESS_TOKEN|WHATSAPP_TOKEN|\.env/)
})

test('Render web deployment starts the generated standalone server on the platform port', () => {
  const nextConfig = read('apps/web/next.config.js')
  const webPackage = JSON.parse(read('apps/web/package.json'))
  const renderBlueprint = read('render.yaml')
  const deploymentRunbook = read('docs/runbooks/tus-deployment.md')
  const renderDocs = read('docs/deployment/render.md')

  assert.equal(webPackage.scripts.start, 'node .next/standalone/server.js')
  assert.match(renderBlueprint, /name: factory-web[\s\S]*?startCommand: PORT=\$PORT pnpm --filter @factory\/web start/u)
  // Standalone by default on Linux/Render; Windows local builds and NEXT_DISABLE_STANDALONE opt out.
  assert.match(nextConfig, /process\.env\.NEXT_DISABLE_STANDALONE === ['"]true['"]/u)
  assert.match(nextConfig, /output:\s*isWindows\s*\?\s*undefined\s*:\s*['"]standalone['"]/u)
  assert.match(nextConfig, /typedRoutes:\s*true/u)
  assert.match(deploymentRunbook, /apps\/web\/\.next\/standalone\/server\.js/u)
  assert.match(deploymentRunbook, /PORT=\$PORT pnpm --filter @factory\/web start/u)
  assert.match(renderDocs, /apps\/web\/\.next\/standalone\/server\.js/u)
  assert.match(renderDocs, /PORT=\$PORT pnpm --filter @factory\/web start/u)
})

test('standalone correction does not activate the external-blocked worker', () => {
  const webPackage = JSON.parse(read('apps/web/package.json'))
  const renderBlueprint = read('render.yaml')
  const webService = serviceSection(renderBlueprint, 'factory-web', 'factory-workflow-worker')
  const workerService = serviceSection(renderBlueprint, 'factory-workflow-worker')

  assert.doesNotMatch(webPackage.scripts.start, /next start/u)
  assert.doesNotMatch(webService, /next start/u)
  assert.match(workerService, /WORKER_DEPLOYMENT_STATUS[\s\S]*external-blocked-placeholder/u)
  assert.match(workerService, /startCommand: python -m worker\.main/u)
})

test('missing TUS evidence disables gated composition and preserves deterministic reporting', async () => {
  const { evaluateTusDeploymentReadiness } = await import('../../scripts/activation/tus-readiness.mjs')
  const result = evaluateTusDeploymentReadiness({
    profile: 'render-native',
    requested: { tusRoutes: true, providers: true, releaseJobs: true, fleetJobs: true },
    evidence: {},
  })

  assert.equal(result.status, 'not-production-ready')
  assert.equal(result.disposition, 'unavailable-deferred')
  assert.equal(result.liveConformance, false)
  assert.deepEqual(result.enabled, {
    api: true,
    web: true,
    workers: true,
    tusRoutes: false,
    providers: false,
    releaseJobs: false,
    fleetJobs: false,
  })
  assert.ok(result.blockers.includes('tusRoutes:legal'))
  assert.ok(result.blockers.includes('providers:mercadoPago'))
  assert.ok(result.blockers.includes('releaseJobs:posPilot'))
  assert.ok(result.blockers.includes('fleetJobs:posPilot'))
  assert.equal(result.deterministicVerificationMayContinue, true)
})

test('deterministic evidence cannot become an authorized live deployment claim', async () => {
  const { evaluateTusDeploymentReadiness } = await import('../../scripts/activation/tus-readiness.mjs')
  const evidence = Object.fromEntries(
    ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'posPilot', 'aws', 'groqMigration', 'runtimeProvider'].map((gate) => [
      gate,
      { approved: true, source: 'deterministic-test-only', profile: 'aws-terraform', scope: 'tus-stage-1', expiresAt: null },
    ])
  )
  const result = evaluateTusDeploymentReadiness({
    profile: 'aws-terraform',
    requested: { providers: true },
    evidence,
  })

  assert.equal(result.status, 'not-production-ready')
  assert.equal(result.enabled.providers, false)
  assert.equal(result.liveConformance, false)
  assert.ok(result.blockers.includes('providers:deterministic-test-only'))
})

test('authorized readiness is scoped to the selected profile and requested capability', async () => {
  const { evaluateTusDeploymentReadiness } = await import('../../scripts/activation/tus-readiness.mjs')
  const evidence = Object.fromEntries(
    ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'posPilot', 'aws', 'groqMigration', 'runtimeProvider'].map((gate) => [
      gate,
      { approved: true, source: 'authorized-cloud-smoke', profile: 'render-native', scope: 'tus-stage-1', expiresAt: '2026-08-26T00:00:00.000Z' },
    ])
  )
  const result = evaluateTusDeploymentReadiness({
    profile: 'render-native',
    requested: { providers: true },
    evidence,
    now: '2026-08-25T00:00:00.000Z',
  })

  assert.equal(result.status, 'production-ready')
  assert.equal(result.enabled.providers, true)
  assert.equal(result.liveConformance, true)
  assert.deepEqual(result.deferredCapabilities, ['tusRoutes', 'releaseJobs', 'fleetJobs'])
  assert.equal(result.profile, 'render-native')
})

test('provider-free profile validation is separate from live readiness', () => {
  const output = read('scripts/validation/cloud-native/fixtures/render-native.json')
  const fixture = JSON.parse(output)

  assert.equal(fixture.provisioned, false)
  assert.equal(fixture.cloudCalls, false)
  assert.equal(fixture.liveConformance, false)
  assert.equal(fixture.validation, 'plan-only')
})
