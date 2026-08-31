# Apply Progress: TUS Real Database and Runtime Audit

## Work Unit

- Change: `tus-real-db-runtime-audit`
- Artifact store: Hybrid (OpenSpec + Engram)
- Mode: Strict TDD
- Delivery: single PR with approved `size-exception`; no chain required
- Scope: Phase 2 PostgreSQL and safe seed only; Phase 3/4/5 remain untouched
- Base/checkpoint: `b663b5e chore: checkpoint partial tus hardening`
- Current status: Focused Phase 2 seed-gate correction and HTTP POS confirmation propagation complete; no live correction runtime was run

## Cumulative Task Status

### Phase 1: Canonical Hardening

- [x] 1.1 RED: Focused tests reject alternate URLs, explicit production profiles, missing local/test intent, non-local targets, and missing seed intent before effects.
- [x] 1.2 GREEN: Native, smoke, and seed paths use only root `.env` `DATABASE_URL`; existing profile intent is used for fail-closed gating; diagnostics are redacted; startup is 60 seconds plus exactly one retry.
- [x] 1.3 REFACTOR: Runbooks, inventory, examples, and SDD contracts document local versus production inputs without six metadata variables or alternate URLs.

### Phase 2: Additive PostgreSQL and Safe Seed

- [x] 2.1 RED: Added strict-TDD coverage for the root-only URL, exact development CLI confirmation, production refusal, bounded retry, additive migration, and zero denied effects.
- [x] 2.2 GREEN: Added `--confirm-development-target` parsing and gating, required explicit `NODE_ENV=development`, made the migration check honor the completed migration marker, added the additive audit migration, and aligned the Prisma fixture index. Existing `seed.ts` namespaced upsert/idempotency behavior was retained because it already satisfied the contract.
- [x] 2.3 REFACTOR: Recorded redacted PostgreSQL attempts, deferred target proof, deterministic verification, cleanup state, provider-zero counts, and the exact side-effect ledger in `postgres-evidence.md`.

### Focused Correction: Remote Development Seed Gate

- [x] RED: Added strict-TDD coverage for remote development attestation, pooler-shaped remote classification, fixture-target attestation, production refusal, missing confirmation, timeout/retry, and secret redaction; the new remote cases failed before the gate correction.
- [x] GREEN: `resolveSafeTargetDetails` now authorizes only process `NODE_ENV=development` plus the explicit confirmation, preserves unconditional production refusal, and emits `remote-development-attested` metadata. The tagged fixture contract accepts that attestation without trusting arbitrary unconfirmed URLs.
- [x] REFACTOR: Seed migration preflight handles a missing Prisma migration ledger safely and applies only the additive fixture table/index SQL; no historical migration backlog is executed.
- [x] LIVE: The explicit root `.env` seed command connected once, applied one additive migration, ran the namespaced fixture twice, verified stable identity/counts with zero duplicates, and closed the pool.

### Focused Correction: HTTP POS Confirmation Propagation

- [x] RED: Added regression coverage proving the HTTP harness refuses a remote development target without confirmation before schema or connection operations, and that explicit confirmation must reach the harness.
- [x] GREEN: Propagated the existing `confirmed` value from `runTusPostgresHttpSmoke` into the shared root `.env` `DATABASE_URL` safety resolver as `allowRemoteDevelopment`; the resolver's production refusal and all downstream gates remain unchanged.
- [x] REFACTOR: Kept one canonical resolver path and the existing bounded startup, child-environment redaction, tenant/auth/readiness, cleanup, and provider-zero behavior; no alternate URL or environment variable was introduced.
- [x] RUNTIME: Not run by correction instruction; no live DB, seed, API, web, mobile, browser, Docker, or watcher process was started.

### Remaining Phases

- [ ] Phase 3: Durable PostgreSQL tenant POS
- [ ] Phase 4: Owned runtime and browser/mobile evidence
- [ ] Phase 5: Canonical environment and deployment evidence

## TDD Cycle Evidence

| Task | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| 2.1 | `23/23` pre-change focused tests passed | Missing confirmation export caused the new contract suite to fail before production edits | Focused suites passed `29/29` after gate/parser implementation | Root-only source, CLI confirmation, exact development env, production refusal, timeout/retry, and denied zero-effect cases | Confirmation constant/parser centralizes the CLI contract and keeps evidence redacted |
| 2.2 | Existing seed/smoke/schema contracts passed before migration/schema edits | New additive migration/index assertions failed before the new migration/index existed | Focused suites passed `29/29`; guarded live attempt stopped before transport | Mock two-run identity/counts plus migration marker and destructive-token checks | Migration marker prevents silent skip when the prior fixture table already exists |
| 2.3 | N/A (new evidence artifact) | N/A (non-executable artifact) | N/A (generated from bounded results) | Attempts, seed runs, verification, cleanup, provider-zero, and side-effect counts are separately recorded | Evidence classes and redaction boundaries are explicit |
| Focused correction | `29/29` prior focused tests passed | Remote target and remote fixture contract failed before the correction; live migration history was also unavailable | Final focused suites passed `35/35`; live command passed | Remote attestation, production refusal, redaction, timeout/retry, additive-only migration, and two-run identity verification | Added explicit remote classification and a safe additive migration fallback without historical Prisma replay |
| HTTP POS confirmation propagation | `17/17` prior HTTP smoke tests passed | Explicit confirmation case failed before the harness forwarded `confirmed` to the shared resolver | Focused suites passed `37/37` with no live runtime execution | Missing confirmation refuses before transport; explicit development confirmation reaches root-target validation; production/refusal, timeout/retry, redaction, and gate coverage remain green | Minimal passthrough; no duplicate resolver or alternate target path |

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/postgres-seed.test.mjs tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; `35` passed, `0` failed, `0` skipped. |
| Runtime harness command/scenario | `NODE_ENV=development node scripts/postgres-seed.mjs seed --confirm-development-target` — exit 0; one 60s-bounded connection attempt passed, one additive migration ran, two seed invocations passed, and no provider/API/web/mobile/browser process started. |
| Verification | Live fixture aggregate: first and second totals `1`, distinct identities `1`, stable identity `true`, duplicates `0`; broader tenant/POS/audit/outbox journeys were not exercised by the fixture-only command. |
| Rollback boundary | `scripts/test-runner-lib.mjs`; `apps/api/prisma/seed.ts`; `apps/api/prisma/migrations/20260831170000_tus_real_db_runtime_audit/migration.sql`; `tests/integration/tus/postgres-seed.test.mjs`; this change's evidence/progress artifacts only. |
| Cleanup state | `closed`; the seed pool closed in `finally`; no owned child, service, watcher, browser, Docker process, or listener was created. |

## Correction Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `pnpm test -- tests/integration/tus/postgres-seed.test.mjs tests/integration/tus/postgres-http-smoke.test.mjs` — exit 0; `37` passed, `0` failed, `0` skipped. |
| Runtime harness command/scenario | `N/A` — explicitly prohibited for this correction; no live DB, seed, API, web, mobile, browser, Docker, or watcher execution was performed. |
| Verification | Missing confirmation returned `remote-development-unattested` / `non-production-target-unproven` with zero schema/connection calls; explicit confirmation reached root `.env` URL validation and returned `remote-development-attested` without exposing the secret. Existing tenant/auth/readiness gates were not bypassed. |
| Rollback boundary | Revert only `scripts/test-runner-lib.mjs` and the two regression cases in `tests/integration/tus/postgres-http-smoke.test.mjs`; preserve all unrelated dirty-tree work and prior evidence. |
| Cleanup state | `not-started`; the correction tests used temporary `.env` fixtures and operation spies only, with no owned child or listener created. |

## Deviations and Issues

- The existing fixture construction and tagged, stable, idempotent upsert
  contract were retained; `apps/api/prisma/seed.ts` was minimally extended to
  accept only the resolver's explicit remote-development attestation.
- The remote target is permitted only by the exact process development
  environment plus explicit operator confirmation; this is not automated
  ownership, disposability, or production-safety proof.
- The target had no Prisma migration ledger, so the seed used only its exact
  additive fixture table/index SQL rather than replaying the historical
  migration backlog.
- `prisma validate` was attempted without an alternate URL and failed before
  database access because the package-local Prisma invocation did not load the
  repository-root `.env`; no environment variable was added or changed.

## Status

6/15 listed task items complete in this change: Phase 1 `1.1–1.3` and Phase 2
`2.1–2.3`; the focused seed-gate and HTTP confirmation corrections are complete.
Phase 3/4/5 are not started.

Artifacts: `openspec/changes/tus-real-db-runtime-audit/tasks.md`,
`openspec/changes/tus-real-db-runtime-audit/apply-progress.md`,
`openspec/changes/tus-real-db-runtime-audit/postgres-seed-evidence.md`,
`scripts/test-runner-lib.mjs`, and
`tests/integration/tus/postgres-http-smoke.test.mjs`.
