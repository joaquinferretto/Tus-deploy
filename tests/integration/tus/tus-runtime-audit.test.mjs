import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createEvidenceReceipt,
  runTusRuntimeAudit,
} from '../../../scripts/audit/tus-runtime-audit.mjs'

test('runtime audit classifies unavailable browser, device, and provider paths as external-blocked', async () => {
  const evidence = await runTusRuntimeAudit({
    browserAvailable: false,
    mobileAvailable: false,
    providerAvailable: false,
  })

  assert.equal(evidence.status, 'external-blocked')
  assert.equal(evidence.receipts.length, 4)
  assert.equal(evidence.receipts.every((receipt) => receipt.tag === 'external-blocked'), true)
  assert.equal(evidence.receipts.every((receipt) => receipt.status === 'deferred'), true)
  assert.equal(evidence.receipts.every((receipt) => receipt.liveConformance === false), true)
  assert.equal(evidence.receipts.every((receipt) => receipt.redacted === true), true)
  assert.doesNotMatch(JSON.stringify(evidence), /password|token|secret|DATABASE_URL/i)
})

test('runtime receipts remain redacted and reject a success claim without live conformance', () => {
  const receipt = createEvidenceReceipt({
    tag: 'browser/mobile',
    status: 'passed',
    liveConformance: false,
    reason: 'local authenticated web journey only',
  })
  assert.deepEqual(receipt, {
    tag: 'browser/mobile',
    status: 'passed',
    liveConformance: false,
    redacted: true,
    reason: 'local authenticated web journey only',
  })
})

test('available authenticated flows use the bounded runner while unavailable provider evidence stays blocked', async () => {
  const seen = []
  const evidence = await runTusRuntimeAudit({
    browserAvailable: true,
    mobileAvailable: true,
    providerAvailable: false,
    timeoutMs: 120,
    runFlow: async (flow) => {
      seen.push(flow)
      return { tag: flow === 'authenticated-api' ? 'deterministic' : 'browser/mobile', status: 'passed', liveConformance: false, reason: `${flow} local evidence` }
    },
  })

  assert.deepEqual(seen, ['authenticated-api', 'authenticated-web', 'mobile-export'])
  assert.equal(evidence.receipts.find((receipt) => receipt.tag === 'external-blocked').status, 'deferred')
  assert.equal(evidence.receipts.filter((receipt) => receipt.status === 'passed').length, 3)
  assert.equal(evidence.maxFlowMs, 180_000)
})

test('timed runtime flows receive cancellation and always run owned cleanup', async () => {
  const events = []
  const evidence = await runTusRuntimeAudit({
    browserAvailable: true,
    timeoutMs: 20,
    runFlow: async (_flow, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { events.push('aborted'); reject(new Error('aborted')) }, { once: true })
      void resolve
    }),
    cleanupFlow: async (flow) => { events.push(`cleanup:${flow}`) },
  })

  assert.equal(evidence.receipts[0].status, 'deferred')
  assert.deepEqual(events, ['aborted', 'cleanup:authenticated-api', 'aborted', 'cleanup:authenticated-web'])
})

test('successful browser and mobile flows record bounded screenshot references without exposing paths', async () => {
  const screenshots = []
  const evidence = await runTusRuntimeAudit({
    browserAvailable: true,
    mobileAvailable: true,
    providerAvailable: false,
    runFlow: async (flow) => ({ tag: flow === 'authenticated-api' ? 'deterministic' : 'browser/mobile', status: 'passed', reason: `${flow} passed` }),
    captureScreenshot: async (flow) => { screenshots.push(flow); return 'C:\\private\\evidence\\secret-user-path.png' },
  })

  assert.deepEqual(screenshots, ['authenticated-web', 'mobile-export'])
  assert.deepEqual(evidence.screenshots, ['authenticated-web', 'mobile-export'])
  assert.doesNotMatch(JSON.stringify(evidence), /private|secret-user-path|C:\\/i)
})
