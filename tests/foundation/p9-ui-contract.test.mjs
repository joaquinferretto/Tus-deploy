import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

test('PR9 maps loading, empty, disabled, error, and authoritative data without inferring success', () => {
  const result = runTypeScriptScenario(`
    const { resolveTusUiState, commitmentPresentation, posFeedback } = (await import('./apps/web/src/lib/tus-ui-contract.ts')).default
    const commitment = { context: 'product', status: 'confirmed', version: 2 }
    console.log(JSON.stringify({
      loading: resolveTusUiState({ loading: true }),
      empty: resolveTusUiState({ loading: false, data: [] }),
      disabled: resolveTusUiState({ loading: false, disabled: true }),
      error: resolveTusUiState({ loading: false, error: new Error('network unavailable') }),
      commitment: commitmentPresentation(commitment),
      queued: posFeedback({ status: 'queued-offline', operationId: 'op-1' }),
      accepted: posFeedback({ status: 'accepted', operationId: 'op-2' }),
    }))
  `)

  assert.equal(result.loading.status, 'loading')
  assert.equal(result.empty.status, 'empty')
  assert.equal(result.disabled.status, 'disabled')
  assert.equal(result.error.status, 'error')
  assert.equal(result.commitment.context, 'product')
  assert.equal(result.commitment.status, 'confirmed')
  assert.equal(result.commitment.settlementClaim, 'not-claimed')
  assert.equal(result.queued.status, 'pending')
  assert.equal(result.accepted.status, 'accepted')
  assert.match(result.accepted.evidence, /server/i)
  assert.match(result.accepted.evidence, /not claimed/i)
})

test('PR9 accepts only complete authenticated sessions and derives request authority from that session', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebSession, sessionRequestContext } = (await import('./apps/web/src/lib/tus-ui-contract.ts')).default
    const session = createTusWebSession({ accessToken: 'secret-token', tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-a' })
    let rejected = false
    try { createTusWebSession({ accessToken: '', tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-a' }) } catch { rejected = true }
    console.log(JSON.stringify({ session, request: sessionRequestContext(session), rejected }))
  `)

  assert.equal(result.session.tenantId, 'tenant-a')
  assert.equal(result.session.actorId, 'customer-a')
  assert.equal(result.request.accessToken, 'secret-token')
  assert.equal(result.request.tenantId, 'tenant-a')
  assert.equal(result.rejected, true)
})

test('PR9 web client sends authenticated tenant-safe requests and uses real marketplace routes', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const requests = []
    const client = createTusWebClient({ request: async (input) => { requests.push(input); return { items: [], commitments: [] } } })
    const context = { accessToken: 'token-a', tenantId: 'tenant-a', actorId: 'merchant-a', correlationId: 'corr-a' }
    await client.discoverMarketplace(context)
    await client.marketplaceCustomerCommitments(context)
    await client.merchantMarketplaceOperations(context)
    console.log(JSON.stringify(requests))
  `)

  assert.deepEqual(result.map(({ method, path, tenantId, accessToken }) => ({ method, path, tenantId, accessToken })), [
    { method: 'GET', path: '/tus/v1/marketplace/discovery', tenantId: 'tenant-a', accessToken: 'token-a' },
    { method: 'GET', path: '/tus/v1/marketplace/customer/commitments', tenantId: 'tenant-a', accessToken: 'token-a' },
    { method: 'GET', path: '/tus/v1/marketplace/merchant/operations', tenantId: 'tenant-a', accessToken: 'token-a' },
  ])
})

test('PR9 renders semantic state and evidence labels in the web surface harness', () => {
  const result = runTypeScriptScenario(`
    const { renderToStaticMarkup } = await import('./apps/web/node_modules/react-dom/server')
    const React = await import('./apps/web/node_modules/react')
    const { TusStateMessage } = (await import('./apps/web/src/app/tus/tus-ui.tsx')).default
    const markup = renderToStaticMarkup(React.createElement(TusStateMessage, { state: { status: 'conflict', message: 'Review required before retry.' } }))
    console.log(JSON.stringify({ markup }))
  `)

  assert.match(result.markup, /role="alert"/)
  assert.match(result.markup, /Review required before retry/)
  assert.match(result.markup, /conflict/i)
})

test('PR9 mobile feedback keeps offline and conflicts bounded until server acknowledgement', () => {
  const result = runTypeScriptScenario(`
    const { posFeedback } = (await import('./apps/mobile/src/application/tus-client.ts')).default
    console.log(JSON.stringify({
      offline: posFeedback({ status: 'queued-offline', operationId: 'offline-1' }),
      conflict: posFeedback({ status: 'conflict', operationId: 'conflict-1', reason: 'server_version_changed' }),
      accepted: posFeedback({ status: 'accepted', operationId: 'accepted-1' }),
    }))
  `)

  assert.equal(result.offline.status, 'pending')
  assert.equal(result.conflict.status, 'conflict')
  assert.equal(result.accepted.status, 'accepted')
  assert.match(result.accepted.evidence, /TUS/i)
  assert.match(result.accepted.evidence, /not claimed/i)
})

test('PR9 keeps finance, delivery, and support surfaces truthful when the report is stale', () => {
  const result = runTypeScriptScenario(`
    const { operationalSurfacePresentation } = (await import('./apps/web/src/lib/tus-ui-contract.ts')).default
    console.log(JSON.stringify(operationalSurfacePresentation({
      stale: true,
      dimensions: { payment: 3, settlementAging: 2, fulfillment: 4, disputes: 1, whatsappActions: 5 },
    })))
  `)

  assert.equal(result.finance.status, 'pending')
  assert.match(result.finance.message, /settlement/i)
  assert.match(result.finance.evidence, /not claimed/i)
  assert.equal(result.delivery.status, 'pending')
  assert.match(result.delivery.message, /delivery/i)
  assert.equal(result.support.status, 'pending')
  assert.match(result.support.message, /support/i)
})

test('PR9 preserves service commitment context and reports explicit payment errors', () => {
  const result = runTypeScriptScenario(`
    const { commitmentPresentation, posFeedback } = (await import('./apps/web/src/lib/tus-ui-contract.ts')).default
    console.log(JSON.stringify({
      service: commitmentPresentation({ context: 'service', status: 'pending' }),
      error: posFeedback({ status: 'error', operationId: 'op-error', reason: 'server_unavailable' }),
    }))
  `)

  assert.equal(result.service.label, 'Service promise')
  assert.equal(result.service.settlementClaim, 'not-claimed')
  assert.equal(result.error.status, 'error')
  assert.match(result.error.message, /acknowledge|success/i)
})

test('PR2 exposes stable state semantics, skip navigation, and inline error associations', () => {
  const result = runTypeScriptScenario(`
    const { renderToStaticMarkup } = await import('./apps/web/node_modules/react-dom/server')
    const React = await import('./apps/web/node_modules/react')
    const { TusFieldError, TusSkipLink, TusStateMessage } = (await import('./apps/web/src/app/tus/tus-ui.tsx')).default
    const markup = renderToStaticMarkup(React.createElement('div', null,
      React.createElement(TusSkipLink, { targetId: 'workspace-content' }),
      React.createElement(TusStateMessage, { state: { status: 'pending', message: 'Waiting for server acknowledgement…' } }),
      React.createElement(TusFieldError, { id: 'amount-error', message: 'Enter an amount greater than zero.' }),
    ))
    console.log(JSON.stringify({ markup }))
  `)

  assert.match(result.markup, /href="#workspace-content"/)
  assert.match(result.markup, /Skip to main content/)
  assert.match(result.markup, /role="status"/)
  assert.match(result.markup, /aria-live="polite"/)
  assert.match(result.markup, /aria-atomic="true"/)
  assert.match(result.markup, /data-status="pending"/)
  assert.match(result.markup, /id="amount-error"[^>]*role="alert"/)
  assert.match(result.markup, /Enter an amount greater than zero/)
})

test('PR2 keeps state copy actionable without inferring success from transport outcomes', () => {
  const result = runTypeScriptScenario(`
    const { resolveTusUiState, statePresentation } = (await import('./apps/web/src/lib/tus-ui-contract.ts')).default
    console.log(JSON.stringify({
      loading: resolveTusUiState({ loading: true }),
      error: resolveTusUiState({ loading: false, error: new Error('timeout') }),
      loadingPresentation: statePresentation('loading'),
      conflictPresentation: statePresentation('conflict'),
    }))
  `)

  assert.equal(result.loading.status, 'loading')
  assert.match(result.loading.message, /…$/)
  assert.equal(result.error.status, 'error')
  assert.match(result.error.message, /timeout/)
  assert.deepEqual(result.loadingPresentation, { label: 'Loading', role: 'status', live: 'polite', busy: true })
  assert.deepEqual(result.conflictPresentation, { label: 'Review required', role: 'alert', live: 'assertive', busy: false })
})

test('PR2 CSS foundation keeps focus, motion, touch, and long-content behavior explicit', () => {
  const css = readFileSync(join(root, 'apps/web/src/app/globals.css'), 'utf8')

  assert.match(css, /\.tus-skip-link:focus-visible/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /touch-action: manipulation/)
  assert.match(css, /overflow-wrap: anywhere/)
  assert.doesNotMatch(css, /transition:\s*all/)
})
