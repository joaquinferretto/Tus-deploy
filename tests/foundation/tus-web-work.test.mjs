import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const output = execFileSync(
    process.execPath,
    [tsxCli, '--eval', `(async () => {\n${source}\n})()`],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )
  return JSON.parse(output.trim())
}

test('WEB-08C uses the canonical work API without putting authority fields in mutation bodies', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const { createWorkIntent } = await import('./apps/web/src/lib/tus-work-intent.ts')
    const calls = []
    const context = { tenantId: 'provider-tenant', actorId: 'provider-user', correlationId: 'corr-provider', accessToken: 'token' }
    const client = createTusWebClient({ request: async (input) => {
      calls.push(input)
      if (input.path === '/tus/v1/work') return { works: [] }
      if (input.method === 'GET') return { work: { trabajoId: 'work/1' }, diagnoses: [], budgets: [], evidence: [], transitions: [] }
      if (input.path.includes('/diagnosis/')) return { status: 'executed', diagnosis: { diagnosticoId: 'diagnosis-1' } }
      if (input.path.endsWith('/diagnosis')) return { status: 'executed', diagnosis: { diagnosticoId: 'diagnosis-1' }, work: { trabajoId: 'work/1' } }
      if (input.path.endsWith('/budgets')) return { status: 'executed', budget: { presupuestoId: 'budget-1' }, work: { trabajoId: 'work/1' } }
      if (input.path.endsWith('/evidence')) return { status: 'executed', evidence: { evidenceId: 'evidence-1' } }
      return { status: 'executed', work: { trabajoId: 'work/1' } }
    } })
    const intent = { idempotencyKey: 'tus:work:intent-1', requestHash: 'hash-1' }
    await client.listWork(context)
    await client.workDetail(context, 'work/1')
    await client.acceptWorkCommitment({ ...context, commitmentId: 'commitment/1', ...intent })
    await client.createWorkDiagnosis({ ...context, workId: 'work/1', description: 'Inspect motor', ...intent })
    await client.confirmWorkDiagnosis({ ...context, workId: 'work/1', diagnosisId: 'diagnosis/1', expectedVersion: 2, ...intent })
    await client.createWorkBudget({ ...context, workId: 'work/1', currency: 'ARS', scope: 'Replace starter', totalMinor: '500000', lines: [{ lineId: 'line-1', description: 'Starter', quantity: 1, unitAmountMinor: '500000', totalAmountMinor: '500000' }], ...intent })
    await client.acceptWorkBudget({ ...context, workId: 'work/1', budgetId: 'budget-1', budgetVersion: 1, ...intent })
    await client.rejectWorkBudget({ ...context, workId: 'work/1', budgetId: 'budget-1', budgetVersion: 1, reason: 'Scope changed', ...intent })
    await client.recordWorkEvidence({ ...context, workId: 'work/1', evidenceId: 'evidence-1', phase: 'execution', reference: 'record-1', metadata: { note: 'checked' }, occurredAt: '2026-09-17T10:00:00.000Z', ...intent })
    await client.startWork({ ...context, workId: 'work/1', expectedVersion: 3, ...intent })
    await client.completeWork({ ...context, workId: 'work/1', expectedVersion: 4, ...intent })
    const opaqueIntent = await createWorkIntent('diagnosis', { workId: 'work/1', description: 'private diagnosis' })
    console.log(JSON.stringify({ calls, opaqueIntent }))
  `)

  assert.deepEqual(
    result.calls.map(({ method, path }) => ({ method, path })),
    [
      { method: 'GET', path: '/tus/v1/work' },
      { method: 'GET', path: '/tus/v1/work/work%2F1' },
      { method: 'POST', path: '/tus/v1/work/commitments/commitment%2F1/accept' },
      { method: 'POST', path: '/tus/v1/work/work%2F1/diagnosis' },
      { method: 'POST', path: '/tus/v1/work/work%2F1/diagnosis/diagnosis%2F1/confirm' },
      { method: 'POST', path: '/tus/v1/work/work%2F1/budgets' },
      { method: 'POST', path: '/tus/v1/work/work%2F1/budgets/1/accept' },
      { method: 'POST', path: '/tus/v1/work/work%2F1/budgets/1/reject' },
      { method: 'POST', path: '/tus/v1/work/work%2F1/evidence' },
      { method: 'POST', path: '/tus/v1/work/work%2F1/start' },
      { method: 'POST', path: '/tus/v1/work/work%2F1/complete' },
    ]
  )
  for (const call of result.calls.filter((call) => call.method === 'POST')) {
    assert.equal(call.idempotencyKey, 'tus:work:intent-1')
    assert.equal('tenantId' in call.body, false)
    assert.equal('actorId' in call.body, false)
    assert.equal('correlationId' in call.body, false)
  }
  assert.equal(result.calls[5].body.lines[0].totalAmountMinor, '500000')
  assert.equal(result.calls[7].body.reason, 'Scope changed')
  assert.doesNotMatch(result.opaqueIntent.requestHash, /work\/1|private diagnosis/)
})

test('WEB-08C renders server-owned work states, history, conflicts, and supported evidence without an invented provider inbox', () => {
  const source = readFileSync(
    join(root, 'apps/web/src/components/prestador/trabajo-prestador.tsx'),
    'utf8'
  )
  const provider = readFileSync(join(root, 'apps/web/src/app/tus/tus-prestador.tsx'), 'utf8')

  assert.match(source, /listWork/)
  assert.match(source, /workDetail/)
  assert.match(source, /provider-scoped inbox of pending commitments/)
  assert.match(source, /Accept referenced commitment/)
  assert.match(source, /Record diagnosis/)
  assert.match(source, /Issue new budget version/)
  assert.match(source, /Version \{budget\.version\}/)
  assert.match(source, /Record evidence metadata/)
  assert.match(source, /Complete work/)
  assert.match(source, /VERSION_CONFLICT/)
  assert.match(source, /IN_PROGRESS/)
  assert.match(source, /SUPERSEDED_BUDGET/)
  assert.match(source, /EXPIRED/)
  assert.match(source, /detailRequestRef/)
  assert.match(source, /selectedWorkRef/)
  assert.match(source, /workRequestRef/)
  assert.match(source, /mutationInFlightRef/)
  assert.match(source, /requestId !== detailRequestRef\.current/)
  assert.match(source, /requestId !== workRequestRef\.current/)
  assert.match(source, /selectedWorkRef\.current === workId/)
  assert.match(source, /Retry same intent/)
  assert.match(source, /showValidationError/)
  assert.match(source, /mutationInFlight/)
  assert.match(source, /const canStart/)
  assert.match(source, /\['requested', 'in_diagnosis', 'accepted'\]/)
  assert.match(source, /TUS confirmed the work mutation/)
  assert.doesNotMatch(source, /acceptWorkBudget|rejectWorkBudget/)
  assert.doesNotMatch(source, /JSON\.stringify\(payload\)/)
  assert.doesNotMatch(source, /JSON\.stringify\(detail/)
  assert.match(provider, /TrabajoPrestador/)
})

test('WEB-08D lets the customer decide only the current issued budget and reads the related commitment schedule', () => {
  const source = readFileSync(
    join(root, 'apps/web/src/components/compromisos/trabajo-cliente.tsx'),
    'utf8'
  )
  const commitments = readFileSync(
    join(root, 'apps/web/src/components/compromisos/compromisos-cliente.tsx'),
    'utf8'
  )

  assert.match(source, /listWork/)
  assert.match(source, /workDetail/)
  assert.match(source, /acceptWorkBudget/)
  assert.match(source, /rejectWorkBudget/)
  assert.match(source, /isLatestIssuedBudget/)
  assert.match(source, /budget\.status === 'issued'/)
  assert.match(source, /detail\.work\.status === 'budget_pending'/)
  assert.match(source, /View related commitment/)
  assert.match(source, /formatEvidenceMetadata/)
  assert.match(source, /rejectionReason/)
  assert.match(source, /Retry same intent/)
  assert.doesNotMatch(source, /recordWorkEvidence|completeWork|startWork/)
  assert.match(commitments, /TrabajoCliente/)
})
