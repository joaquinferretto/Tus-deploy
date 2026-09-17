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

test('WEB-06 uses the existing support and WhatsApp handoff routes', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const calls = []
    const context = { tenantId: 'tenant-support', actorId: 'actor-support', correlationId: 'corr-support', accessToken: 'token' }
    const client = createTusWebClient({ request: async (input) => {
      calls.push(input)
      if (input.method === 'GET') return { cases: [{ caseId: 'case-a', commitmentId: 'commitment-a', tenantId: context.tenantId, correlationId: context.correlationId, category: 'delivery', status: 'open' }] }
      if (input.path.endsWith('/evidence')) return { evidenceId: 'evidence-a', caseId: 'case/a', party: 'customer', summary: 'late', createdAt: '2026-09-17T12:00:00.000Z' }
      if (input.path.includes('support-handoff')) return { handoffId: 'handoff-a', status: 'handoff' }
      return { caseId: 'case/a', commitmentId: 'commitment-a', tenantId: context.tenantId, correlationId: context.correlationId, category: 'delivery', status: 'open' }
    } })
    const cases = await client.listSupportCases(context)
    const opened = await client.openSupportCase({ ...context, caseId: 'case/a', commitmentId: 'commitment-a', category: 'delivery' })
    const evidence = await client.submitSupportEvidence({ ...context, caseId: 'case/a', evidenceId: 'evidence-a', party: 'customer', summary: 'late' })
    const handoff = await client.whatsappSupportHandoff({ ...context, senderId: 'actor-support', reason: 'human review' })
    console.log(JSON.stringify({ calls, cases, opened, evidence, handoff }))
  `)

  assert.deepEqual(result.calls.map(({ method, path, body }) => ({ method, path, body })), [
    { method: 'GET', path: '/tus/v1/support/cases', body: undefined },
    { method: 'POST', path: '/tus/v1/support/cases', body: { caseId: 'case/a', commitmentId: 'commitment-a', category: 'delivery' } },
    { method: 'POST', path: '/tus/v1/support/cases/case%2Fa/evidence', body: { evidenceId: 'evidence-a', party: 'customer', summary: 'late' } },
    { method: 'POST', path: '/tus/v1/whatsapp/support-handoff', body: { senderId: 'actor-support', reason: 'human review' } },
  ])
  assert.equal(result.cases.cases[0].status, 'open')
  assert.equal(result.opened.caseId, 'case/a')
  assert.equal(result.evidence.caseId, 'case/a')
  assert.equal(result.handoff.status, 'handoff')
})

test('WEB-06 parses only tenant-scoped cases with known statuses', () => {
  const result = runTypeScriptScenario(`
    const { parseTusSupportCases } = await import('./apps/web/src/lib/tus-client.ts')
    console.log(JSON.stringify(parseTusSupportCases({ cases: [
      { caseId: 'case-a', commitmentId: 'commitment-a', tenantId: 'tenant-a', correlationId: 'corr-a', category: 'delivery', status: 'open' },
      { caseId: 'case-invalid', commitmentId: 'commitment-a', tenantId: 'tenant-a', correlationId: 'corr-a', category: 'delivery', status: 'pending' },
      { caseId: 'case-missing', commitmentId: 'commitment-a', category: 'delivery', status: 'open' },
    ] })))
  `)

  assert.deepEqual(result.cases.map(({ caseId, status }) => ({ caseId, status })), [{ caseId: 'case-a', status: 'open' }])
})

test('WEB-06 keeps provider delivery and unsupported timeline readback explicit', () => {
  const surface = readFileSync(join(root, 'apps/web/src/app/tus/tus-support.tsx'), 'utf8')
  const shell = readFileSync(join(root, 'apps/web/src/components/layout/tus-app-shell.tsx'), 'utf8')
  const css = readFileSync(join(root, 'apps/web/src/app/globals.css'), 'utf8')

  assert.match(surface, /tus:support:write/)
  assert.match(surface, /tus:whatsapp:write/)
  assert.match(surface, /timeline readback is not exposed/i)
  assert.match(surface, /No WhatsApp message was sent or confirmed/i)
  assert.match(shell, /href="\/tus\/soporte"/)
  assert.match(css, /\.tus-support-handoff[\s\S]*?grid-template-columns/)
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.tus-support-handoff[\s\S]*?display:\s*block/)
})
