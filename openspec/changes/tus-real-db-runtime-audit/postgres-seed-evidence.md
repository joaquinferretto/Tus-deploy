# PostgreSQL Seed Evidence

## Current bounded implementation result — focused seed-gate correction

```yaml
status: passed
executed: true
source_used: root .env DATABASE_URL only
alternate_url_sources: ignored
seed_intent: explicit `seed` command required
profile_gate: process NODE_ENV=development plus explicit --confirm-development-target
target_classification: remote-development-attested
attestation: operator-confirmed; not automated ownership or production proof
connection_attempts:
  - attempt: 1
    timeout_ms: 60000
    status: passed
seed_runs: 2
verification:
  first_run: { total: 1, distinct_identity: 1, stable_identity_matches: true }
  second_run: { total: 1, distinct_identity: 1, stable_identity_matches: true }
  duplicate_fixtures: 0
  tenant_isolation: not-exercised-by-fixture-only-seed
  pos_product_service: not-exercised-by-fixture-only-seed
  audit_outbox: not-exercised-by-fixture-only-seed
side_effects:
  connections: 1
  migrations: 1
  queries: 6
  fixtures: 1
  seed_invocations: 2
  writes: 2
  deletes: 0
  provider_calls: 0
cleanup_state: closed
liveConformance: true
next_recommended: do not run API/web/mobile/browser or provider flows in this focused batch
```

The correction allows the explicitly attested remote development target after
production refusal and URL validation, while retaining a redacted
`remote-development-attested` classification. The bounded migration path
applied only the namespaced fixture table and indexes with `IF NOT EXISTS`; it
did not run the historical Prisma migration backlog because the target had no
Prisma migration ledger. The fixture-only seed does not create POS, audit, or
outbox rows, so those broader runtime scenarios are not claimed here.

## Execution Attempt: Focused Seed-Gate Correction — 2026-08-31

```yaml
status: passed
executive_summary: "Explicit development attestation authorized the root .env remote target; additive fixture migration and two idempotent seed runs passed."
source_used: root .env DATABASE_URL only
profile_used: NODE_ENV=development
confirmation_flag: --confirm-development-target
connection_attempts:
  - { attempt: 1, timeout_ms: 60000, status: passed }
  - { attempt: 2, status: not-needed, reason: first attempt passed }
  - { attempt: 3, status: prohibited }
seed_runs: 2
verification:
  aggregate_fixture_counts: { first_total: 1, second_total: 1, stable: true }
  stable_fixture_identities: { first_distinct: 1, second_distinct: 1, duplicates: 0 }
  tenant_isolation: not-exercised-by-fixture-only-seed
  pos_product_service: not-exercised-by-fixture-only-seed
  audit_outbox: not-exercised-by-fixture-only-seed
  provider_calls: 0
side_effects:
  connections: 1
  migrations: 1
  queries: 6
  fixtures: 1
  seed_invocations: 2
  writes: 2
  deletes: 0
  provider_calls: 0
cleanup_state: closed
liveConformance: true
```

No URL, host, database name, credential, token, cookie, PII, or raw child
output is recorded. No reset, truncate, cascade, untagged deletion, provider
call, service, browser, watcher, Docker, or API process was used.

## Work Unit Evidence — focused correction

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/postgres-seed.test.mjs tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; `35` passed, `0` failed, `0` skipped. |
| Runtime harness command/scenario | `NODE_ENV=development node scripts/postgres-seed.mjs seed --confirm-development-target` — exit 0; one 60-second-bounded connection attempt passed, one additive migration applied, and the pool closed in `finally`. |
| Verification | Two namespaced upserts; aggregate totals remained `1`/`1`, distinct identities `1`/`1`, stable identity matched, duplicates `0`; fixture-only scope did not exercise POS/audit/outbox journeys. |
| Rollback boundary | Revert only `scripts/test-runner-lib.mjs`, `apps/api/prisma/seed.ts`, the named additive migration, `tests/integration/tus/postgres-seed.test.mjs`, and this change's evidence/progress artifacts. Never delete untagged rows. |

## Current risks and limitations

- Remote use is enabled only by the exact process development environment and
  explicit operator confirmation; that attestation is not automated ownership,
  disposability, or production-safety proof.
- The target had no Prisma migration ledger. The runner therefore applied only
  the named additive fixture table/index SQL and did not replay the historical
  migration backlog.
- The focused seed creates no product/service POS, tenant-pair, audit, or
  outbox records. Those broader scenarios remain unrun because this batch did
  not start an API, web, mobile, browser, watcher, Docker, or provider path.

## Execution Attempt: Guarded Seed — 2026-08-31

```yaml
status: deferred
executive_summary: "Stopped before connection because the existing resolver returned non-production-target-unproven."
source_used: root .env DATABASE_URL only
profile_used: NODE_ENV=development
connection_attempts: []
seed_runs: 0
verification:
  aggregate_fixture_counts: not-run
  stable_fixture_identities: not-run
  pos_product_service: not-run
  tenant_isolation: not-run
  audit_outbox: not-run
  replay_related_records: not-run
  reason: non-production-target-unproven
side_effects:
  connections: 0
  migrations: 0
  queries: 0
  fixtures: 0
  seed_invocations: 0
  writes: 0
  deletes: 0
  provider_calls: 0
cleanup_state: not-started
risks:
  - "The process profile proved non-production intent, but the root DATABASE_URL target was not provably local under the existing simplified safety resolver."
  - "No real PostgreSQL, fixture, POS, tenant-isolation, audit, outbox, or replay evidence is claimed."
next_recommended: "Stop before connecting; do not invent alternate URLs, flags, metadata, or proof."
skill_resolution:
  shared: C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md
  typescript: C:\Users\mmmau\.config\opencode\skills\typescript\SKILL.md
```

The implementation refuses `NODE_ENV=production` or production deployment
profiles before transport. Local/test targets remain profile-gated; the
approved remote development target additionally requires process
`NODE_ENV=development` and the exact confirmation flag. The attestation is
recorded as operator intent only; no free-tier status or newly invented
metadata is used as ownership or production-safety proof.

## Safety contract

- `DATABASE_URL` is read from the repository-root `.env` only.
- Local/test targets require the existing non-production profile. Remote
  targets require process `NODE_ENV=development` plus
  `--confirm-development-target`; production values refuse the operation.
- `node scripts/postgres-seed.mjs seed` is required; an omitted command intent
  performs zero actions.
- The namespaced upsert fixture remains idempotent and cleanup remains targeted;
  reset, truncate, cascade, and untagged deletion are prohibited.
- Startup remains bounded to 60 seconds per attempt with exactly one retry.
- Target diagnostics contain only redacted metadata.

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/postgres-seed.test.mjs` — exit 0; 7 passed, 0 failed, 0 skipped. |
| Runtime harness command/scenario | `N/A` — no seed, PostgreSQL, migration, write, service, browser, watcher, Docker, or deployment execution was authorized in this pass. |
| Rollback boundary | Revert only the canonical resolver, guarded seed entrypoint, native profile, seed target contract, focused tests, and these named artifacts. |

## Risks

- A profile can express local/test intent but cannot independently prove database
  ownership; suspicious production/shared/staging hostnames remain refused and
  all other unsupported cases fail closed.
- Real PostgreSQL durability, counts, identity, tenant, POS, and recovery remain
  unclaimed until an explicit operator-run harness supplies live evidence.

## Execution Attempt: Guarded Seed

```yaml
status: deferred
executive_summary: "Stopped before connection because the existing resolver returned non-production-profile-required."
source_used: root .env DATABASE_URL only
connection_attempts:
  previous:
    - []
  current:
    - []
seed_runs: 0
verification:
  aggregate_counts: not-run
  stable_fixture_identities: not-run
  pos_product_service: not-run
  tenant_isolation: not-run
  audit_outbox: not-run
  reason: non-production-profile-required
side_effects:
  connections: 0
  migrations: 0
  queries: 0
  fixtures: 0
  seed_invocations: 0
  writes: 0
  deletes: 0
  provider_calls: 0
cleanup_state: not-started
risks:
  - "The simplified safety contract still refuses because existing canonical environment/profile values do not prove non-production intent."
  - "No real PostgreSQL, POS, tenant-isolation, audit, or outbox evidence is claimed."
next_recommended: "Stop with zero effects; do not invent alternate URLs, flags, or metadata."
skill_resolution:
  shared: C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md
  typescript: C:\Users\mmmau\.config\opencode\skills\typescript\SKILL.md
```
