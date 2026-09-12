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

test('P5.6 contamination validation is deterministic and clean for core surfaces', () => {
  const result = runTypeScriptScenario(`
    const { scanContamination } = (await import('./scripts/validation/contamination.ts')).default
    console.log(JSON.stringify(scanContamination(process.cwd())))
  `)

  assert.equal(result.valid, true)
  assert.equal(result.findings.length, 0)
  assert.ok(result.scannedFiles >= 5)
})

test('P5.6 contamination validation detects a fallback import and vertical vocabulary', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'p5-6-contamination-'))
  try {
    for (const directory of [
      'packages/config/src',
      'packages/contracts/src',
      'packages/contracts/traceability',
      'packages/observability/src',
    ]) {
      mkdirSync(join(temporaryRoot, directory), { recursive: true })
      writeFileSync(join(temporaryRoot, directory, 'clean.ts'), 'export const neutral = true\n')
    }
    writeFileSync(
      join(temporaryRoot, 'packages/contracts/src/base.ts'),
      'export const neutralBase = true\n'
    )
    writeFileSync(
      join(temporaryRoot, 'packages/contracts/src/index.ts'),
      "import fallback from '../fallback/marketplace/index'\nexport default fallback\n"
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
