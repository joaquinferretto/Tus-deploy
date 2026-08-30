# Tasks: TUS Live Runtime Correction

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1,400 authored lines |
| Configured review budget | 99,999 changed lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR #1 diagnostics → PR #2 PostgreSQL/POS → PR #3 integration/evidence |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Safe env resolution and redaction | PR #1; base = feature/tus-live-runtime-correction | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` | No live target; prove deterministic no-target/unsafe deferral | Revert runner and integration-test changes |
| 2 | Durable PostgreSQL HTTP/POS pilot | PR #2; base = PR #1 branch | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs tests/foundation/p9-delivery-pos.test.mjs` | Authorized disposable URL only; run authenticated restart/replay/POS/delivery, then bounded cleanup | Revert POS/schema/migration/smoke changes; preserve unrelated data |
| 3 | Error, mobile, activation, evidence integration | PR #3; base = PR #2 branch | `pnpm test -- tests/foundation/p9-tus-runtime-readiness.test.mjs tests/foundation/p9-activation.test.mjs apps/mobile/tests/unit/tus-pos.test.ts` | `node scripts/activation/tus-readiness.mjs render-native`; local/deferred only, never production/provider | Revert integration, activation, mobile, and matrix edits |

## Phase 1: Environment Diagnostics and URL Safety

- [x] 1.1 **RED → GREEN → REFACTOR:** In `tests/integration/tus/postgres-http-smoke.test.mjs`, test precedence, absent, malformed, unsafe/shared, redaction, stable reason, and placeholder rerun output; implement one resolver/gate in `scripts/test-runner-lib.mjs`; refactor duplicate reads. Focused `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs`; local evidence only, live evidence N/A without owner authorization; rollback those two files.
- [x] 1.2 **RED → GREEN → REFACTOR:** In `tests/integration/tus/postgres-http-smoke.test.mjs`, assert no Prisma command, connection, query, migration, or fixture side effect before disposable proof; implement fixed argv/env and destructive-operation denial in `scripts/test-runner-lib.mjs`; refactor diagnostics to expose only owner/boundary/status. Same focused command; local deferred evidence, no provider/production claim; rollback runner/test gate changes.

## Phase 2: PostgreSQL HTTP/POS Pilot and Cleanup

- [x] 2.1 **RED → GREEN → REFACTOR:** In `tests/foundation/p9-delivery-pos.test.mjs`, add durable version/transaction failure RED cases; update `apps/api/src/tus/pos/index.ts` and `apps/api/src/tus/adapters/delivery-pos.ts` with `TusPosVersion`, atomic transaction, tenant-scoped audit/outbox reads, and in-memory parity. Focused `pnpm test -- tests/foundation/p9-delivery-pos.test.mjs`; local deterministic proof, live only with authorized disposable DB; rollback these POS files/tests.
- [x] 2.2 **RED → GREEN → REFACTOR:** In `tests/integration/tus/postgres-http-smoke.test.mjs`, add authenticated device/session, product/service POS, delivery proof/handoff, replay/hash/version conflict, restart, counts, provider-spy, and cleanup RED cases; implement in `apps/api/src/tus/composition/index.ts`, `apps/api/src/tus/http/router.ts`, `apps/api/prisma/schema.prisma`, and additive `apps/api/prisma/migrations/20260829120000_tus_pos_runtime_correction/migration.sql`; refactor bounded child/pool/transaction finalization in `scripts/test-runner-lib.mjs`. Focused `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs`; authorized disposable PostgreSQL only, otherwise `deferred`; rollback these files and unique fixtures.
- [x] 2.3 **RED → GREEN → REFACTOR:** In `tests/integration/tus/postgres-http-smoke.test.mjs`, force startup/assertion/timeout/cleanup failures; implement stop/await/close/targeted-delete in `scripts/test-runner-lib.mjs`; refactor stable scenario keys and `liveConformance:false`. Focused `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs`; separate local/live evidence, never an unauthorized pilot; rollback runner/test lifecycle changes.

## Phase 3: Runtime, Error, and Evidence Integration

- [x] 3.1 **RED → GREEN → REFACTOR:** In `apps/mobile/tests/unit/tus-pos.test.ts`, assert canonical route, replay/conflict/error mapping, and no acceptance inference; update `apps/mobile/src/application/tus-client.ts`; refactor shared response mapping. Focused mobile Jest command; local only, no device/POS-pilot claim; rollback the two mobile files.
- [x] 3.2 **RED → GREEN → REFACTOR:** In `tests/foundation/p9-tus-runtime-readiness.test.mjs` and `tests/foundation/p9-activation.test.mjs`, assert unavailable vs assertion-failure, local/deferred taxonomy, fail-closed gates, drain/quarantine, and append-only rollback; update `scripts/activation/tus-readiness.mjs` and `docs/evidence/readiness/tus-matrix.md`. Focused `pnpm test -- tests/foundation/p9-tus-runtime-readiness.test.mjs tests/foundation/p9-activation.test.mjs`; provider-free `not-production-ready`; rollback activation/test/matrix edits.
- [x] 3.3 **RED → GREEN → REFACTOR:** In `scripts/test-runner-lib.mjs`, `apps/api/src/tus/pos/index.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, `scripts/activation/tus-readiness.mjs`, and `docs/evidence/readiness/tus-matrix.md`, run RED then GREEN then REFACTOR regression/evidence checks. Focused `pnpm test`; runtime `node scripts/activation/tus-readiness.mjs render-native`; separate authorized live vs deferred records, no production/provider claim; rollback only this change’s files.
