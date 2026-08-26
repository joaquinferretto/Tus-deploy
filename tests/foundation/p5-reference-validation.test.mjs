import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

test('P5.6 contamination validation is deterministic and clean for neutral surfaces', () => {
  const result = runTypeScriptScenario(`
    const { scanContamination } = (await import('./scripts/validation/contamination.ts')).default
    console.log(JSON.stringify(scanContamination(process.cwd())))
  `)

  assert.equal(result.valid, true)
  assert.equal(result.findings.length, 0)
  assert.ok(result.scannedFiles >= 5)
})

test('P5.6 parity validation proves API, web, mobile, and runtime evidence without live claims', () => {
  const result = runTypeScriptScenario(`
    const { runReferenceParity } = (await import('./scripts/validation/reference-parity.ts')).default
    console.log(JSON.stringify(await runReferenceParity(process.cwd())))
  `)

  assert.equal(result.valid, true)
  assert.equal(result.liveConformance, false)
  assert.equal(result.cloud.kind, 'unavailable-deferred')
  assert.equal(result.clients.api.status, 'pass')
  assert.equal(result.clients.web.status, 'pass')
  assert.equal(result.clients.mobile.status, 'pass')
  assert.ok(['pass', 'unavailable-deferred'].includes(result.runtime.status))
  assert.equal(result.security.clientPolicyBypass, false)
})

test('P5.6 parity evidence covers cross-tenant denial, failure, retry, and rollback', () => {
  const result = runTypeScriptScenario(`
    const { runReferenceParity } = (await import('./scripts/validation/reference-parity.ts')).default
    const evidence = await runReferenceParity(process.cwd())
    console.log(JSON.stringify(evidence.scenarios))
  `)

  assert.equal(result.crossTenant.status, 'pass')
  assert.equal(result.failure.status, 'pass')
  assert.equal(result.retry.status, 'pass')
  assert.equal(result.rollback.status, 'pass')
})

test('P5.6 contamination validation detects a fallback import and vertical vocabulary', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'p5-6-contamination-'))
  try {
    for (const directory of [
      'apps/reference/api/src',
      'apps/reference/web/src',
      'apps/reference/mobile/src',
      'apps/web/src/lib',
      'apps/mobile/src/application',
      'packages',
    ]) {
      mkdirSync(join(temporaryRoot, directory), { recursive: true })
      writeFileSync(join(temporaryRoot, directory, 'clean.ts'), 'export const neutral = true\n')
    }
    writeFileSync(
      join(temporaryRoot, 'apps/web/src/lib/neutral-contract-client.ts'),
      'export const neutralWeb = true\n'
    )
    writeFileSync(
      join(temporaryRoot, 'apps/mobile/src/application/neutral-contract-client.ts'),
      'export const neutralMobile = true\n'
    )
    writeFileSync(
      join(temporaryRoot, 'apps/reference/api/src/index.ts'),
      "import fallback from '../../fallback/marketplace/index'\nexport default fallback\n"
    )

    const result = runTypeScriptScenario(`
      const { scanContamination } = (await import('./scripts/validation/contamination.ts')).default
      console.log(JSON.stringify(scanContamination(${JSON.stringify(temporaryRoot)})))
    `)

    assert.equal(result.valid, false)
    assert.ok(result.findings.some((finding) => finding.rule === 'fallback-import'))
    assert.ok(result.findings.some((finding) => finding.rule === 'vertical-vocabulary'))
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
