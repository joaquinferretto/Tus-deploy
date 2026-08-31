# Tasks: TUS Real Database and Runtime Audit

Remaining work only: Phases 1–2 hardening/contracts are complete and omitted. `Goldenrepo-js_py`, providers/cloud/compliance/production, hardware, credentials, review lifecycle, `sdd-verify`, and archive remain out of scope. No code or runtime action occurs while planning.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1,500 |
| 400-line budget risk | High; approved size exception |
| Chained PRs recommended | No; single PR |
| Suggested split | One PR containing three reviewable work units |
| Delivery strategy | single-pr; approved size exception |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Execution guard (applies before any future live phase)

Use only root `.env` `DATABASE_URL`; no alternate URLs or `TUS_TEST_*` variables. The sole guarded command is `NODE_ENV=development node scripts/postgres-seed.mjs seed --confirm-development-target`: that operator attestation permits the owned remote development target, but is not automated proof. `NODE_ENV=production` refuses unconditionally before transport. Connection/start is 60s per attempt with exactly one retry (120s total), then stop. Seed twice with stable identity/counts and zero duplicates; additive migration and exact tagged cleanup only—never reset, truncate, cascade, or untagged delete. All phases are strict `RED→GREEN→REFACTOR`, ≤15m; HTTP/browser actions ≤30s; cleanup ≤120s; evidence is truthful, redacted, and classified.

### Suggested Work Units

| Unit | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|
| 1 POS | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` ≤15m | Guarded seed command, then bounded tenant replay; `external-blocked` if proof unavailable | POS files, test, evidence |
| 2 runtime | `pnpm test -- tests/foundation/p0-native-profile.test.mjs tests/integration/tus/tus-runtime-audit.test.mjs` ≤15m | Owned helpers + Playwright/CDP; 30s/action and cleanup | runner/audit files, test, evidence |
| 3 deploy | `pnpm test -- tests/foundation/tus-product-hardening.test.mjs` ≤15m | N/A: static contracts only; no cloud/service activation | named env/docs/manifests/evidence |

## Phase 3: Durable PostgreSQL Tenant POS

- [ ] 3.1 **RED** — Add product/service retry-original-result, version-conflict/no-partial-write, receipt, tenant isolation, audit/outbox, replay/recovery, and provider-zero cases to `tests/integration/tus/postgres-http-smoke.test.mjs`; denied/unavailable paths assert zero effects.
- [ ] 3.2 **GREEN** — Implement tenant transactions/idempotency, receipts, audit/outbox, bounded replay and restart recovery in `apps/api/src/tus/pos/index.ts`, `apps/api/src/tus/ports/index.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, and `apps/api/src/tus/adapters/prisma.ts`; preserve provider calls at zero.
- [ ] 3.3 **REFACTOR** — Update `openspec/changes/tus-real-db-runtime-audit/postgres-evidence.md` with redacted counts, exact tagged cleanup, and `real-postgres` only after successful proof; otherwise `external-blocked`.

## Phase 4: Owned Runtime and Browser/Mobile Evidence

- [ ] 4.1 **RED** — In `tests/foundation/p0-native-profile.test.mjs` and `tests/integration/tus/tus-runtime-audit.test.mjs`, cover PID/cwd/argv mismatch, timeout/interruption, SIGTERM/SIGKILL escalation, `finally`, no-orphan cleanup, and separate API/web/browser/mobile/POS receipts.
- [ ] 4.2 **GREEN** — Harden exact ownership, bounded lifecycle, escalation, and cleanup in `scripts/test-runner-lib.mjs`, `scripts/dev/native-profile.mjs`, and `scripts/audit/tus-runtime-audit.mjs`; unknown processes are never killed.
- [ ] 4.3 **REFACTOR** — Write `openspec/changes/tus-real-db-runtime-audit/runtime-evidence.md` with secret-free separate receipts; unrun credentials/devices/browser/runtime flows are `external-blocked`, never observed.

## Phase 5: Canonical Environment and Deployment Evidence

- [ ] 5.1 **RED** — Add inventory, root `.env` authority, no alternate URL/metadata variables, local/Render/Vercel contract, bounded cleanup, and static-vs-live assertions to `tests/foundation/tus-product-hardening.test.mjs`.
- [ ] 5.2 **GREEN** — Normalize `.env.example`, `apps/api/.env.example`, `apps/web/.env.example`, `apps/mobile/.env.example`, `docs/runbooks/tus-environment-consumer-inventory.md`, `docs/runbooks/local-profiles.md`, `docs/runbooks/tus-deployment.md`, `docs/deployment/render.md`, `render.yaml`, and `vercel.json`.
- [ ] 5.3 **REFACTOR** — Write `openspec/changes/tus-real-db-runtime-audit/deployment-evidence.md` separating deterministic contracts from truthful `external-blocked` cloud/ownership/production status; never imply activation.
