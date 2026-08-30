const ACTIVATION_MODE = {
  FAKE: 'fake',
  LIVE: 'live',
  ACTIVE: 'active',
}

export const REQUIRED_ACTIVATION_GATES = Object.freeze([
  'credits',
  'credentials',
  'region',
  'quota',
  'ownerApproval',
  'liveConformance',
])

export const PAID_LIVE_ACTIVATION_TARGETS = Object.freeze([
  'bedrock',
  'bedrock-guardrails',
  'transcribe',
  'polly',
  'textract',
  'rekognition',
  'translate',
  'ses',
  's3',
  'sqs',
  'eventbridge',
  'lambda',
  'cloudwatch',
  'iam',
  'kms',
  'cloudtrail',
  'guardduty',
  'security-hub',
  'inspector',
  'backup',
  'budgets',
  'service-quotas',
  'aws',
  'provider-smoke',
])

export const ACTIVATION_DISPOSITION = Object.freeze({
  AUTHORIZED_LIVE: 'authorized-live',
  ACTIVE_PROVIDER: 'active-provider',
  DETERMINISTIC_LOCAL_FAKE: 'deterministic-local-fake',
  UNAVAILABLE_DEFERRED: 'unavailable-deferred',
})

const ACTIVATION_TARGETS = new Set([...PAID_LIVE_ACTIVATION_TARGETS, 'groq'])

const GATE_LABELS = Object.freeze({
  credits: 'credits',
  credentials: 'credentials',
  region: 'region',
  quota: 'quota',
  ownerApproval: 'owner approval',
  liveConformance: 'live conformance',
})

function isProvidedEvidence(value) {
  return value === true || (typeof value === 'string' && value.trim().length > 0)
}

function normalizedEvidence(input) {
  return input && typeof input === 'object' ? input : {}
}

function missingRequirements(evidence) {
  return REQUIRED_ACTIVATION_GATES.filter((gate) => {
    if (gate === 'region') {
      return !isProvidedEvidence(evidence.region)
    }
    return evidence[gate] !== true
  })
}

function unavailableResult(target, mode, missing, reason) {
  return {
    target,
    mode,
    status: 'unavailable',
    activation: 'denied',
    disposition: ACTIVATION_DISPOSITION.UNAVAILABLE_DEFERRED,
    liveConformance: false,
    localFake: 'preserved',
    missingRequirements: missing,
    reason,
  }
}

function localFakeResult(target) {
  return {
    target,
    mode: ACTIVATION_MODE.FAKE,
    status: 'available',
    activation: 'local-fake',
    disposition: ACTIVATION_DISPOSITION.DETERMINISTIC_LOCAL_FAKE,
    liveConformance: false,
    localFake: 'active',
    missingRequirements: [],
    reason: 'deterministic local fake is active; live activation remains gated',
  }
}

function evaluateGroq(target, mode, input) {
  if (mode === ACTIVATION_MODE.FAKE) return localFakeResult(target)

  if (mode === ACTIVATION_MODE.ACTIVE && input.transportConfigured === true) {
    return {
      target,
      mode,
      status: 'active',
      activation: 'active-provider',
      disposition: ACTIVATION_DISPOSITION.ACTIVE_PROVIDER,
      liveConformance: false,
      localFake: 'available',
      missingRequirements: [],
      reason: 'Groq remains active through its explicitly injected transport',
    }
  }

  return unavailableResult(
    target,
    mode,
    ['transport'],
    'Groq transport is unavailable; deterministic local fake remains available'
  )
}

export function evaluateActivation(input = {}) {
  const target = typeof input.target === 'string' ? input.target.trim() : ''
  const mode = input.mode ?? ACTIVATION_MODE.LIVE

  if (!target) throw new TypeError('activation target is required')
  if (![ACTIVATION_MODE.FAKE, ACTIVATION_MODE.LIVE, ACTIVATION_MODE.ACTIVE].includes(mode)) {
    throw new TypeError(`unsupported activation mode: ${mode}`)
  }

  if (mode === ACTIVATION_MODE.FAKE) return localFakeResult(target)
  if (target === 'groq') return evaluateGroq(target, mode, input)
  if (!ACTIVATION_TARGETS.has(target)) {
    return unavailableResult(
      target,
      mode,
      ['target-policy'],
      'live activation denied because the target is not in the explicit activation catalog'
    )
  }

  const evidence = normalizedEvidence(input.evidence)
  const missing = missingRequirements(evidence)

  if (missing.length > 0) {
    const labels = missing.map((gate) => GATE_LABELS[gate] ?? gate)
    return unavailableResult(
      target,
      mode,
      missing,
      `live activation denied until required evidence exists: ${labels.join(', ')}`
    )
  }

  return {
    target,
    mode,
    status: 'active',
    activation: 'active',
    disposition: ACTIVATION_DISPOSITION.AUTHORIZED_LIVE,
    liveConformance: true,
    localFake: 'available',
    missingRequirements: [],
    reason: 'authorized live activation is scoped to the requested target',
  }
}

export default {
  ACTIVATION_DISPOSITION,
  PAID_LIVE_ACTIVATION_TARGETS,
  REQUIRED_ACTIVATION_GATES,
  evaluateActivation,
}
