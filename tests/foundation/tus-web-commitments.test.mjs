import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  return JSON.parse(execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  }).trim())
}

test('WEB-03 encuentra compromisos por commitmentId y conserva la colección vacía', () => {
  const result = runTypeScriptScenario(`
    const { encontrarCompromiso } = (await import('./apps/web/src/lib/tus-commitments.ts')).default
    const compromisos = [
      { commitmentId: 'commitment-1' },
      { commitmentId: 'commitment-2' },
    ]
    console.log(JSON.stringify({
      found: encontrarCompromiso(compromisos, ' commitment-2 ').commitmentId,
      missing: encontrarCompromiso(compromisos, 'missing'),
      empty: encontrarCompromiso([], 'missing'),
    }))
  `)
  assert.equal(result.found, 'commitment-2')
  assert.equal(result.missing, undefined)
  assert.equal(result.empty, undefined)
})

test('WEB-03 traduce estados solo para la presentación y genera URLs dedicadas', () => {
  const result = runTypeScriptScenario(`
    const { crearEnlaceCompromiso, presentarEstadoCompromiso } = (await import('./apps/web/src/lib/tus-commitments.ts')).default
    console.log(JSON.stringify({
      pending: presentarEstadoCompromiso('pending'),
      accepted: presentarEstadoCompromiso('confirmed'),
      url: crearEnlaceCompromiso('commitment/a'),
    }))
  `)
  assert.deepEqual(result.pending, { label: 'Pendiente', tone: 'warning' })
  assert.deepEqual(result.accepted, { label: 'Confirmado', tone: 'success' })
  assert.equal(result.url, '/tus/compromisos/commitment%2Fa')
})
