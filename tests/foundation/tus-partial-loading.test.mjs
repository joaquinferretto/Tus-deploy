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

const session = {
  accessToken: 'server-token',
  tenantId: 'tenant-authorized',
  actorId: 'actor-authorized',
  correlationId: 'corr-partial-loading',
  sessionId: 'session-partial-loading',
  subjectId: 'actor-authorized',
  permissions: ['tus:marketplace:read'],
}

test('PR1 loads authorized customer and merchant resources without requesting denied reporting data', () => {
  const result = runTypeScriptScenario(`
    const { createTusResourceLoader } = (await import('./apps/web/src/lib/tus-resource-loader.ts')).default
    const calls = []
    const client = {
      discoverMarketplace: async () => { calls.push('discovery'); return { items: [{ listingId: 'listing-1' }] } },
      marketplaceCustomerCommitments: async () => { calls.push('commitments'); return { commitments: [{ commitmentId: 'commitment-1' }] } },
      merchantMarketplaceOperations: async () => { calls.push('merchant'); return { listings: [{ listingId: 'listing-1' }] } },
      operationsReport: async () => { calls.push('report'); return { tenantId: 'tenant-authorized' } },
    }
    const loader = createTusResourceLoader({ client, session: ${JSON.stringify(session)} })
    const states = await loader.load()
    console.log(JSON.stringify({ calls, states: Object.fromEntries(Object.entries(states).map(([key, state]) => [key, { status: state.status, hasData: state.data !== undefined, message: state.message }])) }))
  `)

  assert.deepEqual(result.calls.sort(), ['commitments', 'discovery', 'merchant'])
  assert.equal(result.states.discovery.status, 'ready')
  assert.equal(result.states.commitments.status, 'ready')
  assert.equal(result.states.merchant.status, 'ready')
  assert.equal(result.states.report.status, 'disabled')
  assert.equal(result.states.report.hasData, false)
  assert.match(result.states.report.message, /authorized scope/i)
})

test('PR1 keeps settled siblings visible when one authorized resource times out', () => {
  const result = runTypeScriptScenario(`
    const { createTusResourceLoader } = (await import('./apps/web/src/lib/tus-resource-loader.ts')).default
    const timeout = Object.assign(new Error('private timeout detail'), { status: 504, code: 'REPORT_TIMEOUT' })
    const client = {
      discoverMarketplace: async () => ({ items: [{ listingId: 'listing-1' }] }),
      marketplaceCustomerCommitments: async () => ({ commitments: [] }),
      merchantMarketplaceOperations: async () => ({ listings: [{ listingId: 'listing-1' }] }),
      operationsReport: async () => { throw timeout },
    }
    const loader = createTusResourceLoader({ client, session: { ...${JSON.stringify(session)}, permissions: ['tus:marketplace:read', 'tus:reporting:read'] } })
    const states = await loader.load()
    console.log(JSON.stringify({
      discovery: { status: states.discovery.status, hasData: states.discovery.data !== undefined },
      commitments: { status: states.commitments.status, hasData: states.commitments.data !== undefined },
      merchant: { status: states.merchant.status, hasData: states.merchant.data !== undefined },
      report: { status: states.report.status, code: states.report.code, message: states.report.message, hasRetry: typeof states.report.retry === 'function' },
    }))
  `)

  assert.deepEqual(result.discovery, { status: 'ready', hasData: true })
  assert.deepEqual(result.commitments, { status: 'empty', hasData: true })
  assert.deepEqual(result.merchant, { status: 'ready', hasData: true })
  assert.equal(result.report.status, 'error')
  assert.equal(result.report.code, 'REPORT_TIMEOUT')
  assert.equal(result.report.hasRetry, true)
  assert.doesNotMatch(result.report.message, /private timeout detail/i)
})

test('PR1 retries only the failed reporting resource and preserves merchant data', () => {
  const result = runTypeScriptScenario(`
    const { createTusResourceLoader } = (await import('./apps/web/src/lib/tus-resource-loader.ts')).default
    let reportCalls = 0
    let merchantCalls = 0
    const client = {
      discoverMarketplace: async () => ({ items: [{ listingId: 'listing-1' }] }),
      marketplaceCustomerCommitments: async () => ({ commitments: [] }),
      merchantMarketplaceOperations: async () => { merchantCalls += 1; return { listings: [{ listingId: 'merchant-listing' }] } },
      operationsReport: async () => { reportCalls += 1; if (reportCalls === 1) throw Object.assign(new Error('temporary'), { status: 503, code: 'TEMPORARY' }); return { tenantId: 'tenant-authorized', dimensions: { demand: 2 } } },
    }
    const loader = createTusResourceLoader({ client, session: { ...${JSON.stringify(session)}, permissions: ['tus:marketplace:read', 'tus:reporting:read'] } })
    await loader.load()
    const merchantBefore = loader.snapshot().merchant.data
    await loader.retry('report')
    const states = loader.snapshot()
    console.log(JSON.stringify({ reportCalls, merchantCalls, merchantBefore, merchantAfter: states.merchant.data, report: { status: states.report.status, hasData: states.report.data !== undefined } }))
  `)

  assert.equal(result.reportCalls, 2)
  assert.equal(result.merchantCalls, 1)
  assert.deepEqual(result.merchantAfter, result.merchantBefore)
  assert.deepEqual(result.report, { status: 'ready', hasData: true })
})

test('PR1 withholds every protected resource after a 401 and invokes session recovery', () => {
  const result = runTypeScriptScenario(`
    const { createTusResourceLoader } = (await import('./apps/web/src/lib/tus-resource-loader.ts')).default
    let recovered = false
    const unauthorized = Object.assign(new Error('tenant secret must not render'), { status: 401, code: 'SESSION_EXPIRED' })
    const client = {
      discoverMarketplace: async () => ({ items: [{ listingId: 'private-listing' }] }),
      marketplaceCustomerCommitments: async () => ({ commitments: [{ commitmentId: 'private-commitment' }] }),
      merchantMarketplaceOperations: async () => ({ listings: [{ listingId: 'private-merchant-record' }] }),
      operationsReport: async () => { throw unauthorized },
    }
    const loader = createTusResourceLoader({ client, session: { ...${JSON.stringify(session)}, permissions: ['tus:marketplace:read', 'tus:reporting:read'] }, onUnauthorized: () => { recovered = true } })
    await loader.load()
    const states = loader.snapshot()
    console.log(JSON.stringify({ recovered, states: Object.fromEntries(Object.entries(states).map(([key, state]) => [key, { status: state.status, hasData: state.data !== undefined, message: state.message }])) }))
  `)

  assert.equal(result.recovered, true)
  for (const state of Object.values(result.states)) {
    assert.equal(state.hasData, false)
    assert.equal(state.status, 'disabled')
    assert.doesNotMatch(
      state.message,
      /private-listing|private-commitment|private-merchant-record|tenant secret/i
    )
  }
})

test('PR1 treats permissions as the only loading authority and ignores role-only access', () => {
  const result = runTypeScriptScenario(`
    const { canLoadTusResource } = (await import('./apps/web/src/lib/tus-resource-loader.ts')).default
    console.log(JSON.stringify({
      roleOnly: canLoadTusResource('report', []),
      marketplace: canLoadTusResource('discovery', ['tus:marketplace:read']),
      wildcard: canLoadTusResource('report', ['tus:*']),
      unrelated: canLoadTusResource('report', ['tus:operations:read']),
    }))
  `)

  assert.deepEqual(result, { roleOnly: false, marketplace: true, wildcard: true, unrelated: false })
})

test('PR1 ignores late responses after a surface loader is cancelled', () => {
  const result = runTypeScriptScenario(`
    const { createTusResourceLoader } = (await import('./apps/web/src/lib/tus-resource-loader.ts')).default
    let resolveDiscovery
    const discovery = new Promise((resolve) => { resolveDiscovery = resolve })
    const client = {
      discoverMarketplace: async () => discovery,
      marketplaceCustomerCommitments: async () => ({ commitments: [] }),
      merchantMarketplaceOperations: async () => ({ listings: [] }),
      operationsReport: async () => ({ tenantId: 'tenant-authorized' }),
    }
    const loader = createTusResourceLoader({ client, session: ${JSON.stringify(session)} })
    const pending = loader.load()
    loader.cancel()
    resolveDiscovery({ items: [{ listingId: 'late-private-listing' }] })
    await pending
    const state = loader.snapshot().discovery
    console.log(JSON.stringify({ status: state.status, hasData: state.data !== undefined }))
  `)

  assert.deepEqual(result, { status: 'loading', hasData: false })
})
