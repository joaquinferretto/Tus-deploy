import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  ACTIVATION_DISPOSITION,
  PAID_LIVE_ACTIVATION_TARGETS,
  REQUIRED_ACTIVATION_GATES,
  evaluateActivation,
} from '../../scripts/activation/index.mjs'

const root = join(import.meta.dirname, '..', '..')

const completeEvidence = {
  credits: true,
  credentials: true,
  region: true,
  quota: true,
  ownerApproval: true,
  liveConformance: true,
}

test('every paid/live AWS and SES target denies activation for each missing gate', () => {
  for (const target of PAID_LIVE_ACTIVATION_TARGETS) {
    for (const missingGate of REQUIRED_ACTIVATION_GATES) {
      const evidence = { ...completeEvidence, [missingGate]: false }
      const result = evaluateActivation({ target, mode: 'live', evidence })

      assert.equal(result.status, 'unavailable', `${target}:${missingGate}`)
      assert.equal(result.activation, 'denied', `${target}:${missingGate}`)
      assert.equal(result.liveConformance, false, `${target}:${missingGate}`)
      assert.deepEqual(result.missingRequirements, [missingGate], `${target}:${missingGate}`)
      assert.equal(result.disposition, ACTIVATION_DISPOSITION.UNAVAILABLE_DEFERRED)
    }
  }
})

test('a live request with no evidence is explicitly unavailable and preserves the local fake', () => {
  const result = evaluateActivation({ target: 'bedrock', mode: 'live', evidence: {} })

  assert.deepEqual(result.missingRequirements, [...REQUIRED_ACTIVATION_GATES])
  assert.equal(result.localFake, 'preserved')
  assert.equal(result.disposition, ACTIVATION_DISPOSITION.UNAVAILABLE_DEFERRED)
  assert.match(
    result.reason,
    /credits, credentials, region, quota, owner approval, live conformance/
  )
})

test('fake execution remains available without live evidence and never claims conformance', () => {
  const result = evaluateActivation({ target: 'ses', mode: 'fake', evidence: {} })

  assert.deepEqual(result, {
    target: 'ses',
    mode: 'fake',
    status: 'available',
    activation: 'local-fake',
    disposition: ACTIVATION_DISPOSITION.DETERMINISTIC_LOCAL_FAKE,
    liveConformance: false,
    localFake: 'active',
    missingRequirements: [],
    reason: 'deterministic local fake is active; live activation remains gated',
  })
})

test('complete live evidence activates only the requested scoped target', () => {
  const result = evaluateActivation({
    target: 'bedrock',
    mode: 'live',
    evidence: completeEvidence,
  })

  assert.equal(result.status, 'active')
  assert.equal(result.activation, 'active')
  assert.equal(result.liveConformance, true)
  assert.equal(result.disposition, ACTIVATION_DISPOSITION.AUTHORIZED_LIVE)
  assert.deepEqual(result.missingRequirements, [])
})

test('an unlisted live target cannot bypass the explicit activation catalog', () => {
  const result = evaluateActivation({
    target: 'future-paid-provider',
    mode: 'live',
    evidence: completeEvidence,
  })

  assert.equal(result.status, 'unavailable')
  assert.equal(result.activation, 'denied')
  assert.deepEqual(result.missingRequirements, ['target-policy'])
  assert.equal(result.disposition, ACTIVATION_DISPOSITION.UNAVAILABLE_DEFERRED)
  assert.equal(result.liveConformance, false)
})

test('Groq remains active through its injected transport without AWS activation evidence', () => {
  const result = evaluateActivation({
    target: 'groq',
    mode: 'active',
    transportConfigured: true,
    evidence: {},
  })

  assert.equal(result.status, 'active')
  assert.equal(result.activation, 'active-provider')
  assert.equal(result.liveConformance, false)
  assert.equal(result.disposition, ACTIVATION_DISPOSITION.ACTIVE_PROVIDER)
  assert.equal(result.localFake, 'available')
})

test('activation gate implementation is deterministic and does not discover environment secrets', () => {
  const source = readFileSync(join(root, 'scripts', 'activation', 'index.mjs'), 'utf8')

  assert.doesNotMatch(source, /process\.env|dotenv|readFileSync/)
  assert.deepEqual(
    evaluateActivation({ target: 'provider-smoke', mode: 'live', evidence: {} }),
    evaluateActivation({ target: 'provider-smoke', mode: 'live', evidence: {} })
  )
})

test('activation documentation names the denied disposition and every scoped live target', () => {
  const docs = readFileSync(join(root, 'docs', 'activation-gates.md'), 'utf8').toLowerCase()

  for (const gate of [
    'credits',
    'credentials',
    'region',
    'quota',
    'owner approval',
    'live conformance',
  ]) {
    assert.match(docs, new RegExp(gate))
  }
  for (const target of PAID_LIVE_ACTIVATION_TARGETS) assert.match(docs, new RegExp(target))
  assert.match(docs, /unavailable-deferred/)
  assert.match(docs, /deterministic local fake/)
  assert.match(docs, /groq remains active/)
})
