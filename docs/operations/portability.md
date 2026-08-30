# Clean-environment portability

P6.6 verifies that a neutral product team can start from a fresh checkout,
select an active cloud-native profile, and understand every managed boundary
without maintainer-only knowledge. The validator is deterministic and
provider-free. It reads committed synthetic fixtures only; it never reads
`.env`, credentials, database endpoints, or provider resources.

## Fresh-checkout bootstrap

From a clean checkout, use the following order:

1. Install the pinned workspace dependencies with `pnpm install --frozen-lockfile`.
2. Run the native developer commands exactly as documented:

   ```text
   cd backend && pnpm run dev
   cd frontend && pnpm run dev
   ```

   Native requires PostgreSQL through the existing `DATABASE_URL` key. MongoDB,
   Redis, Python workers, mobile, and external providers remain explicitly
   fake, disabled, optional, or unavailable as recorded by native evidence.

3. Select exactly one active cloud-native profile explicitly: `render-native`
   or `aws-terraform`.
4. Run the portability validator from the repository root:

   ```text
   node scripts/validation/portability/index.mjs
   ```

5. Review `docs/evidence/profile-parity.md`, the generated parity matrix, and
   the contamination result before discussing any deployment or live smoke.

The clean-environment contract is stored at
`scripts/validation/portability/fixtures/clean-environment.json`. Its checks
reject copied source, maintainer-only assumptions, environment-file reads,
cloud calls, provisioning, implicit profile selection, and Compose fallback.

## Evidence boundaries

The validator produces separate evidence for:

| Evidence                 | Meaning                                                                                 |                   Live conformance |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------: |
| `cloud-plan-validation`  | Synthetic Render/AWS shape and declared-boundary validation only                        |                            `false` |
| `authorized-cloud-smoke` | A separately authorized provider/resource smoke, when performed by an approved operator | `true` only with matching evidence |
| `unavailable-deferred`   | Credentials, resources, quota, authorization, or tooling are unavailable                |                            `false` |
| `deferred`               | Optional Compose/P0.6b work is not part of this completion slice                        |                            `false` |

Plan validation cannot become a live claim. Missing credentials or managed
resources preserve deterministic fakes or disabled states and produce an
unavailable/deferred disposition.

## Unsupported-profile rule

If either active profile is missing a required managed boundary, owner,
rollback path, fake/disabled mode, activation gate, or shared contract value,
the result is explicitly:

```json
{
  "status": "unsupported-profile",
  "valid": false,
  "liveConformance": false
}
```

The affected profile is listed in `unsupportedProfiles` and each divergence
includes its boundary and remediation reason. A parity failure must not be
converted into production readiness or silently repaired by switching to
Compose or another undeclared service.

## Rollback boundary

Portability validation is evidence-only. Roll back this slice by reverting
`scripts/validation/portability/**`,
`tests/foundation/p6-portability.test.mjs`,
`docs/operations/portability.md`, and
`docs/evidence/profile-parity.md`. Existing P5.6 validation, P6.1–P6.5
implementation, profile configuration, and deferred Compose files remain
outside this rollback boundary.
