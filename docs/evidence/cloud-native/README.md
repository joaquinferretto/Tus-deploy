# Cloud-native evidence contract

P0.6c records cloud-native evidence without provisioning or making live claims.
Every record identifies the selected profile, boundary scope, gates, rollback
reference, and status.

## Evidence classes

| Class | Proves | Does not prove |
|---|---|---|
| `native-smoke` | Developer-only native API/web behavior and declared local states | Cloud integration or production readiness |
| `cloud-plan-validation` | Render/AWS declared shape, configuration references, and boundary coverage | Provisioning, connectivity, or live conformance |
| `authorized-cloud-smoke` | An explicitly authorized smoke against configured resources | Unrelated services or universal activation |
| `unavailable-deferred` | A missing credential, resource, quota, owner approval, or live gate | A passing live integration |

Plan/validation fixtures are check-only and must set `provisioned: false`,
`cloudCalls: false`, and `liveConformance: false`. Missing live gates preserve a
deterministic fake or disabled disposition. Live conformance is not claimed from
plan/validation alone.

## Required boundary fields

Both active profiles declare PostgreSQL, MongoDB, Redis, object storage, and
queues. Each boundary has a non-secret configuration reference, owner,
rollback reference, managed/fake/disabled mode, and activation gate. Real
values remain in local secret stores or provider secret stores; diagnostics are
redacted and `.env` is never an evidence input.

Compose remains retained, deferred, unchecked, and non-blocking. It is not a
fallback for either active cloud-native profile.
