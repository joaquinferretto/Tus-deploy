import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolvePostgresSmokeEvidence } from '../../../scripts/test-runner-lib.mjs'

test('PostgreSQL HTTP smoke is an explicit opt-in boundary, never a fake local pass', () => {
  assert.deepEqual(resolvePostgresSmokeEvidence({}), {
    status: 'deferred',
    evidenceClass: 'local-postgresql-http',
    liveConformance: false,
    reason: 'TUS_POSTGRES_URL is unavailable; authenticated PostgreSQL smoke was not run',
  })
})
