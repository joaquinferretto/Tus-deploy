const DURABLE_WORK_TYPES = ['ledger', 'outbox', 'dlq']

/**
 * Build a provider-free rollback record for the native profile.
 *
 * This is a deterministic local scenario used by the native evidence tests and
 * runbook. It does not connect to a provider or mutate a durable store.
 */
export function createNativeRollbackScenario(input) {
  if (input.failingHealth.ready !== false) {
    throw new Error('The failing version must be non-ready before rollback.')
  }

  if (input.restoredHealth.ready !== true) {
    throw new Error('The restored version must be ready before traffic resumes.')
  }

  const events = [
    'candidate-selected',
    'readiness-failed',
    'traffic-stopped',
    'durable-work-checkpointed',
    'last-passing-restored',
    'health-verified',
    'traffic-resumed',
  ]

  const durableWork = Object.fromEntries(
    DURABLE_WORK_TYPES.map((type) => [
      type,
      {
        preserved: true,
        replayable: true,
        record: structuredClone(input.durableWork[type]),
      },
    ]),
  )

  return {
    status: 'rolled-back',
    events,
    traffic: {
      stoppedBeforePartialServing:
        events.indexOf('traffic-stopped') < events.indexOf('durable-work-checkpointed'),
      acceptedRequestsDuringFailure: 0,
      resumedAfterHealthVerification:
        events.indexOf('traffic-resumed') > events.indexOf('health-verified'),
    },
    durableWork,
    replayableRecordIds: DURABLE_WORK_TYPES.map((type) => input.durableWork[type].id),
    evidence: {
      deployedVersion: input.deployedVersion,
      restoredVersion: input.restoredVersion,
      reason: input.reason,
      operator: input.operator,
      timestamp: input.timestamp,
      health: {
        failing: structuredClone(input.failingHealth),
        restored: structuredClone(input.restoredHealth),
      },
    },
  }
}
