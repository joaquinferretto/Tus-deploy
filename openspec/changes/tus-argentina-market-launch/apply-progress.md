# Apply Progress: TUS Argentina Market Launch

## Status

- Phase 0, Phase 1, and Phase 2 implementation is present but not complete.
- Phase 3 and Phase 4 implementation is complete for deterministic in-memory coverage; the focused runner is available through the repository's pinned NVM Node toolchain.
- Phase 5 and Phase 6 implementation is complete for deterministic focused coverage; live persistence/provider evidence remains blocked by the execution boundary.
- Phase 7 and Phase 8 implementation is complete for deterministic focused coverage; live WhatsApp, database, and delivery runtime evidence remains verify-only.
- Runtime database execution remains intentionally blocked; no database writes were performed.

## Completed Implementation Work

- Added `scripts/sdd/git-boundary.mjs` and its strict boundary tests.
- Added exact minor-unit `Money` helpers and exported them from `packages/contracts/src/index.ts`.
- Added the forward-only launch migration with tenant, commerce, finance, communications, operations, delivery, POS, audit, outbox, and job tables.
- Added migration inventory, exact-money, backup-restore, schema, and launch-marker gates to `scripts/tus-migration-repair-lib.mjs`.
- Updated migration-repair tests for the launch migration and exact-money behavior.
- Fixed launch-marker classification, launch ledger inspection, and legacy POS-only snapshot detection so the repair gate does not reject its own additive marker or require the full launch shape during the legacy POS test path.
- Added Phase 2 runtime/security scaffolding: Render-safe host/port resolution, bounded startup/shutdown, body limits, correlation IDs, CORS headers, async error forwarding, redacted envelopes, safe logging, and explicit schema readiness states.
- Added optional durable identity-store transactions with serialized in-memory rollback support; wrapped auth registration, sign-in, sign-out, verification, recovery, credential, session, and account mutations.
- Added Prisma security/tenancy audit sinks, tenancy persistence adapters, normalized auth/tenancy errors, provider-disabled fail-closed routing, and worker activation gates.
- Updated `render.yaml`, `docker-compose.yml`, worker configuration, and root `.env` to use canonical `DATABASE_URL` while keeping activation disabled until external evidence exists.
- Added Phase 2 RED coverage in `tests/foundation/backend-runtime-security.test.mjs`.
- Added Phase 3 marketplace/catalog ownership, exact price snapshots, zero-stock publication filtering, conditional inventory reservation, customer/merchant boundaries, idempotent checkout replay, and marketplace route integration.
- Added Phase 4 calendar rules, timezone-aware buffered slot generation, blackout handling, role/tenant-scoped booking service, capacity locking, cutoff/cancellation/no-show transitions, audit/outbox boundaries, Prisma persistence adapter, and authenticated API routes.
- Added `tests/integration/tus/catalog-booking.test.mjs` with five focused scenarios covering catalog races/replay and calendar policy/race behavior.

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 0.1 | Tests written first in `tests/foundation/sdd-git-boundary.test.mjs` | Blocked: Node/pnpm unavailable in the environment | Static source review completed; runtime refactor pending |
| 1.1 | Tests written first in `tests/integration/tus/migration-repair.test.mjs` | Blocked: Node/pnpm unavailable; PostgreSQL client tools unavailable | Static SQL/schema review completed; runtime refactor pending |
| 2.1 | Tests written first in `tests/foundation/backend-runtime-security.test.mjs` | Blocked: Node/pnpm unavailable in the environment | Static TypeScript/Python/YAML review completed; runtime refactor pending |
| 3.1 | Tests written first in `tests/integration/tus/catalog-booking.test.mjs` | Passed: 6/6 focused tests | Triangulated tenant split, exact price, zero-stock filtering, race, replay, and forbidden access | Passed: focused suite remained 6/6 after adapter/router/catalog cleanup |
| 4.1 | Tests written first in `tests/integration/tus/catalog-booking.test.mjs` | Passed: 6/6 focused tests | Triangulated timezone, blackout, buffer, capacity, cutoff, cancellation, no-show, idempotency, role, and tenant paths | Passed: focused suite remained 6/6 after validation/idempotency cleanup |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm test -- tests/foundation/backend-runtime-security.test.mjs`; not run — `pnpm`, `node`, and `npm` are unavailable in PATH. Python syntax and YAML parsing checks passed for changed worker/configuration files. |
| Runtime harness command/scenario and exact result | N/A for this planning/apply slice; the task artifact defines runtime as verify-only, and API/DB/provider execution is blocked because Node, PostgreSQL tools, Docker, and provider credentials are unavailable. |
| Rollback boundary | Revert only Phase 2 files: backend runtime/middleware, lifecycle/health/server, auth, tenancy, provider, worker, deployment, environment, and Phase 2 test changes; preserve Phase 0/1 and unrelated working-tree changes. |

## Static Evidence

- `git diff --check`: passed.
- `git diff --check` after Phase 2 changes: passed; Git line-ending normalization warnings remain on existing modified files.
- Python syntax check: passed for `apps/workflow-runtime-python/src/worker/core/config.py` and `main.py`.
- YAML parse check: passed for `render.yaml` and `docker-compose.yml`.
- Tool availability check: `node`, `npm`, `pnpm`, `pytest`, `docker`, `psql`, `pg_dump`, and `pg_restore` unavailable in PATH.
- PowerShell static database/schema check: passed; 56 required launch tables found, no forbidden destructive SQL tokens, and no Prisma `Float` fields remain.
- Model/migration comparison: launch tables have corresponding Prisma models except the expected `_prisma_migrations` table; pre-existing Prisma models remain represented by historical migrations.
- Post-fix `git diff --check`: passed.
- Commerce focused test: `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd test -- tests/integration/tus/catalog-booking.test.mjs`; exit 0, 6 passed, 0 failed.
- Commerce runtime harness: deterministic in-memory catalog/calendar command scenarios passed; external API/database runtime intentionally not started.

## Blockers

- Install/provide Node.js and pnpm before running focused tests.
- Provide PostgreSQL client/backup tooling and an operator-approved restorable backup handle before any DDL execution.
- Resolve whether pre-existing historical `Float` columns require an approved additive backfill before treating the Prisma exact-money conversion as runtime-ready.
- Install/provide Node.js and pnpm before claiming Phase 2 focused tests or TypeScript compilation pass.
- Review generated `apps/api/tsconfig.tsbuildinfo` separately; it was not intentionally changed by this Phase 2 slice.
- API typecheck and the backend foundation test remain blocked by the existing `@factory/errors` workspace module-resolution failure; this is not live PostgreSQL evidence.
- Live calendar persistence remains blocked pending an approved additive schema for separate booking owner/customer tenancy and persisted duration/policy/snapshot fields.

## Phase 3/4 Database Boundary

No PostgreSQL connection, DDL, migration, seed, backup, restore, or write was performed. Existing `database-evidence.md` remains authoritative for the database block.

## Phase 5: Durable POS

- Added tenant-owned device registration, cash shift/session open and closeout reconciliation, product/service line snapshots, immutable receipt evidence, compensating refunds/cancellations, role and tenant fencing, printer recovery records, operation status queries, concurrent version fencing, and atomic audit/outbox effects.
- Added mobile revoked-device quarantine and a status-only query path that never resubmits a sale; added authenticated POS refund, cancellation, printer-failure, and operation-status HTTP routes.

### TDD Cycle Evidence

| Task | Test file | Layer | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 5.1 | `tests/integration/tus/pos-durability.test.mjs` | deterministic integration | ✅ New tests failed on missing shift/status/refund/printer APIs and mobile runtime path | ✅ Pinned Node runner: 6/6 passed | ✅ Cash closeout; same-key concurrency; compensation immutability; validation/auth; printer claim fencing; revoked offline quarantine/status | ✅ Focused suite passed after adding read-only status, compensation fences, and queue quarantine |

### Phase 5 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/pos-durability.test.mjs`; exit 0, 6 passed, 0 failed. Mobile Jest: `pnpm --filter @factory/mobile exec jest tests/unit/tus-pos.test.ts --runInBand`; exit 0, 23 passed, 0 failed. |
| Runtime harness command/scenario and exact result | N/A for this apply slice: deterministic in-memory and mobile queue harnesses were executed, but API/DB/provider/browser/Docker/device/printer/deployment execution remains intentionally blocked. |
| Rollback boundary | Revert `apps/api/src/tus/pos/index.ts`, POS additions in `apps/api/src/tus/http/router.ts`, `apps/mobile/src/application/tus-client.ts`, and `tests/integration/tus/pos-durability.test.mjs`; preserve Phase 0–4 and unrelated working-tree changes. |

### Phase 5 Static Evidence and Risks

- API typecheck is blocked only by the pre-existing `@factory/errors` module-resolution errors in `apps/api/src/presentation/middleware/{error,logger}.ts`; no Phase 5 type errors remained.
- CodeGraph fallback: `.codegraph/` exists, but the upstream `codegraph` CLI was unavailable; structural review used the existing POS ports/adapters and focused source reads.
- Live POS persistence, shift reconciliation, device hardware, printer, provider/payment, browser/mobile device, and deployment evidence remain unverified. Deterministic tests do not promote to live evidence.

## Phase 6: Mercado Pago intermediary settlement

- Added an explicit `tus-intermediary` / `intermediary` merchant-of-record boundary. Payment intents retain order ID, optional POS operation ID, immutable five-day policy metadata, release-at timestamp, provider correlation, and `credentialsCollected: false`.
- Added exact minor-unit finance helpers and BigInt basis-point commission calculation; Prisma conversion accepts persisted `BIGINT` values without binary floating-point arithmetic.
- Added provider payment retry handling with bounded attempts, timeout/unavailable classification, frozen provider-error intents, and provider-disabled held responses.
- Added signed Mercado Pago webhook verification with constant-time comparison, five-minute freshness, tenant/payment/reference correlation, event idempotency, out-of-order fencing, and terminal transition handling for pending, approved, rejected, expired, cancelled, refunded, and charged-back states.
- Added cumulative partial/full refund limits, chargeback freezes, mismatch freezes, reconciliation quarantine, append-only compensating ledger entries, and explicit five-day release gating when enabled.
- Extended the additive Prisma payment shape with order/POS correlation, policy snapshot, release timestamp, provider event timestamp, and redacted provider error state. No historical migration was rewritten or executed.

### TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 6.1 | `tests/integration/tus/finance-webhook.test.mjs` | deterministic integration/domain | New file; prior finance safety run exposed only the known `@factory/errors` import block in the HTTP test | ✅ New payment/webhook/settlement APIs failed before implementation | ✅ pinned Node runner: 5/5 passed | ✅ five-day hold; order/POS correlation; all requested provider states; signature freshness/replay/order; partial/full refund; chargeback/mismatch; timeout retry; disabled provider; secret-safe result | ✅ focused suite remained 5/5 after exact-money, Prisma boundary, route correlation, and migration cleanup |

### Phase 6 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/finance-webhook.test.mjs`; exit 0, 5 passed, 0 failed. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: no API service, database, browser, Docker, deployment, or Mercado Pago sandbox/live endpoint was started or called. Deterministic in-memory provider fakes exercised the domain path only. |
| Rollback boundary | Revert `apps/api/src/tus/finance/index.ts`, `apps/api/src/tus/finance/prisma.ts`, the optional finance route correlation change in `apps/api/src/tus/http/router.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260909130000_tus_argentina_payments/migration.sql`, and `tests/integration/tus/finance-webhook.test.mjs`; preserve Phase 0–5 and unrelated work. |

### Phase 6 Static / External Evidence and Risks

- `git diff --check`: passed; existing LF/CRLF normalization warnings remain.
- API TypeScript check: only the pre-existing `@factory/errors` module-resolution errors remain in `apps/api/src/presentation/middleware/{error,logger}.ts`; no Phase 6 finance errors remain.
- Package TypeScript check: blocked by the package's missing local Node type/runtime globals (`node:crypto`, `node:buffer`, `fetch`, `URL`), not by a Phase 6 package source change.
- Absolute tooling was used because `node`/`pnpm` are not on PATH; the pinned Node executable ran the focused suite successfully. The package `pnpm test` script could not run because its nested `pnpm` command is not on PATH and package-local dependencies are absent.
- No Mercado Pago credentials, applications, users, access tokens, webhook secrets, or live/sandbox requests were read, printed, invented, or committed. The deterministic source is test-only; no provider evidence or funds claim is made.
- No PostgreSQL connection, migration, seed, DDL, write, rollback, or schema mutation was performed. The additive SQL remains pending the existing backup/restore and database gates.

## Phase 6 Recovery Pass

- Revalidated the existing Phase 6 implementation against the umbrella proposal, design, Mercado Pago settlement specification, payment-related source, focused tests, Prisma schema/migration, and `payment-evidence.md`; the core intermediary five-day, lifecycle, webhook, compensation, reconciliation, exact-money, and fail-closed boundaries are implemented.
- The prior evidence was incomplete in two concrete places. First, the domain webhook verifier checked the HMAC but did not bind the signature's `ts=` field to the event timestamp. Second, `PrismaTusFinanceStore.paymentToRow` passed `releaseAt` and `providerEventAt` as numbers even though Prisma `DateTime` fields require `Date` values.
- Added RED tests before correction for both gaps, then fixed only `apps/api/src/tus/finance/index.ts` and `apps/api/src/tus/finance/prisma.ts`. The signed timestamp mismatch now rejects, and both payment timestamps are converted to Prisma `Date` values.

### Recovery TDD Cycle Evidence

| Correction | Test file | RED | GREEN | REFACTOR |
|---|---|---|---|---|
| Bind webhook signature timestamp | `tests/integration/tus/finance-webhook.test.mjs` | ✅ Mismatched `ts=` was incorrectly processed | ✅ Focused Phase 6 suite passed 7/7 | ✅ Existing fresh/replay/expired/out-of-order coverage remained green |
| Map Prisma payment timestamps | `tests/integration/tus/finance-webhook.test.mjs` | ✅ Persistence boundary passed numbers and crashed on row conversion | ✅ Focused Phase 6 suite passed 7/7 | ✅ Nullable `providerEventAt` remains supported; no database call |

### Recovery Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/finance-webhook.test.mjs`; exit 0, 7 passed, 0 failed. `tests/foundation/p9-finance.test.mjs`; exit 0, 7 passed, 0 failed. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: no API service, database, browser, Docker, deployment, or Mercado Pago sandbox/live endpoint was started or called. Deterministic in-memory and persistence-boundary fakes only. |
| Rollback boundary | Revert only the recovery assertions in `tests/integration/tus/finance-webhook.test.mjs`, the signature timestamp guard in `apps/api/src/tus/finance/index.ts`, and Prisma timestamp mapping in `apps/api/src/tus/finance/prisma.ts`; preserve all Phase 0–5, original Phase 6, unrelated changes, and `Goldenrepo-js_py` exclusion. |

### Recovery Validation and Limits

- `git diff --check`: passed.
- `tests/foundation/p8-tus-finance.test.mjs`: 7/8 passed; the authenticated HTTP smoke remains blocked by the pre-existing `@factory/errors` module-resolution failure before the route can start. This is not a Phase 6 finance assertion failure.
- `@repo/mercado-pago` package test was attempted with absolute pnpm, but its nested `pnpm run build` cannot find `pnpm` and the package-local `node_modules` is absent. The repository `node` and `pnpm` commands are also absent from PATH; pinned absolute Node was used for the passing focused suites.
- No provider or database effects occurred. Provider, real-PostgreSQL, legal/tax, KYC/KYB, custody, payout, and exact policy approval remain external-blocked evidence classes.

## Phase 7: WhatsApp

- Added tenant/merchant/customer consent lifecycle with explicit opt-out, fail-closed consent enforcement, retention metadata, and tenant-scoped audit records.
- Added versioned WhatsApp template allowlisting, variable validation/redaction, idempotent inbound/outbound effects, outbox records, support handoff, and credential-collection rejection.
- Added signed webhook freshness, tenant policy routing, provider-disabled fail-closed behavior, rate limiting, deterministic timeout classification, bounded retry, and replay protection.
- Added authenticated HTTP routes for consent, template registration, and support handoff in `apps/api/src/tus/http/router.ts`.

### TDD Cycle Evidence

| Task | Test file | Layer | RED | GREEN | REFACTOR |
|---|---|---|---|---|---|
| 7.1 | `tests/integration/tus/whatsapp-delivery-billing.test.mjs` | deterministic integration/provider boundary | ✅ Consent, disabled/rate-limited/stale webhook, and timeout-retry tests failed before the corresponding implementation | ✅ Pinned Node runner: 6/6 passed | ✅ Corrected retry due-time assertion and preserved idempotent send/replay behavior |

### Phase 7 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/whatsapp-delivery-billing.test.mjs`; exit 0, 6 passed, 0 failed. Existing `tests/foundation/p5-whatsapp.test.mjs`; exit 0, 6 passed, 0 failed. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: deterministic in-memory provider/store scenarios ran; no WhatsApp provider, API service, database, browser, Docker, or deployment was started. |
| Rollback boundary | Revert `apps/api/src/tus/whatsapp/index.ts`, WhatsApp additions in `apps/api/src/providers/whatsapp/index.ts` and `apps/api/src/tus/http/router.ts`, the WhatsApp schema/migration additions, and `tests/integration/tus/whatsapp-delivery-billing.test.mjs`; preserve Phases 0–6 and unrelated changes. |

## Phase 8: Own Delivery

- Added tenant-scoped, operator-owned delivery zones, shifts, tasks, assignment fencing, lifecycle transitions through `delivered`, cancellation, failed-delivery/return handling, incident review, proof requirements, and SLA evaluation.
- Added pickup/in-transit/handoff timestamps, SLA breach metadata, tenant isolation, operator ownership checks, idempotent audit/outbox effects, and explicit rejection of external bidding.
- Added delivery assignment/cancellation and proof-related HTTP integration in `apps/api/src/tus/http/router.ts`.
- Added additive Prisma fields/models and migration `apps/api/prisma/migrations/20260909150000_tus_comms_delivery_controls/migration.sql`; no migration or database write was executed.

### TDD Cycle Evidence

| Task | Test file | Layer | RED | GREEN | REFACTOR |
|---|---|---|---|---|---|
| 8.1 | `tests/integration/tus/whatsapp-delivery-billing.test.mjs` | deterministic integration/domain | ✅ Transition, SLA, proof, ownership, cancellation, failed-return, and no-bidding cases failed before implementation | ✅ Pinned Node runner: 6/6 passed | ✅ Added proof-gated `delivered` transition and preserved Phase 5 delivery behavior: selected WU5 suite 6/6 passed |

### Phase 8 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/whatsapp-delivery-billing.test.mjs`; exit 0, 6 passed, 0 failed. Selected `tests/foundation/p8-tus-delivery-pos.test.mjs` WU5 cases; exit 0, 6 passed, 0 failed. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: deterministic in-memory delivery scenarios ran; no live API, PostgreSQL, provider, browser, Docker, device, or deployment runtime was started. |
| Rollback boundary | Revert only `apps/api/src/tus/delivery/index.ts`, `apps/api/src/tus/adapters/delivery-pos.ts`, delivery additions in `apps/api/src/tus/http/router.ts`, delivery schema/migration additions, and the Phase 8 assertions in the shared focused test; preserve the Phase 7 WhatsApp implementation/tests and unrelated changes. |

## Phase 7/8 Static Validation and Limits

- `git diff --check`: passed after the Phase 8 delivered-transition correction.
- No credentials, provider requests, PostgreSQL connection, migration, seed, API server, Docker, browser, or deployment execution occurred.
- Existing API typecheck limitation remains the pre-existing `@factory/errors` workspace module-resolution failure; full TypeScript compilation was not claimed.
- Phase 7 and Phase 8 are complete for deterministic focused coverage and remain pending live/provider/database evidence in verification.

## Phase 7/8 Recovery Pass

- Re-read the proposal, design, WhatsApp/delivery/billing and backend-hardening specifications, current implementation, focused tests, additive Prisma schema/migration, and prior comms/delivery evidence before making a narrow correction.
- Closed three deterministic gaps without restarting the slice: template idempotency keys now reject a different request hash; webhook replay responses are emitted only after freshness, tenant policy, and signature verification; SLA breaches persist auditable task state and outbox evidence, while delivery failure/proof/incident/return mutations require the assigned operator and reject terminal-task failures.
- Preserved the fail-closed provider boundary: the integration webhook router still rejects disabled provider actions before adapter execution, and the adapter still rejects disabled, stale, rate-limited, forged, and replayed traffic without a provider call.

### Recovery TDD Cycle Evidence

| Correction | Test file | RED | GREEN | REFACTOR |
|---|---|---|---|---|
| Template request-hash idempotency conflict | `tests/integration/tus/whatsapp-delivery-billing.test.mjs` | ✅ Same key with a different request hash replayed silently | ✅ Focused suite passed 6/6 | ✅ Request hash persisted in the additive Prisma message shape/migration |
| Verify forged webhook before replay | `tests/integration/tus/whatsapp-delivery-billing.test.mjs` | ✅ Forged duplicate event returned `replay` | ✅ Focused suite passed 6/6 | ✅ Existing stale, rate-limit, disabled, retry, and valid replay cases remained green |
| Persist SLA breach and fence delivery ownership/terminal failure | `tests/integration/tus/whatsapp-delivery-billing.test.mjs` | ✅ SLA was read-only; foreign operator could fail; delivered task could re-enter incident review | ✅ Focused suite passed 6/6 | ✅ Audit/outbox emitted once on breach; proof/incident/return ownership and terminal transition guards preserved |

### Recovery Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/whatsapp-delivery-billing.test.mjs`; exit 0, 6 passed, 0 failed. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: deterministic in-memory/provider-boundary scenarios only; no provider, database, migration, seed, API server, browser, Docker, deployment, or credential-dependent runtime was started. |
| Rollback boundary | Revert only the recovery assertions in `tests/integration/tus/whatsapp-delivery-billing.test.mjs`, WhatsApp request-hash/replay-order changes in `apps/api/src/tus/whatsapp/index.ts` and `apps/api/src/providers/whatsapp/index.ts`, delivery SLA/ownership guards in `apps/api/src/tus/delivery/index.ts`, and the additive request-hash schema/migration lines; preserve prior Phase 7/8 work and unrelated phases. |

### Recovery Validation and Limits

- `git diff --check`: passed after the recovery correction; existing LF/CRLF normalization warnings remain.
- The focused Phase 7/8 suite is the authoritative apply evidence for this pass. The legacy `tests/foundation/p8-tus-delivery-pos.test.mjs` deterministic cases passed 6/7; its authenticated HTTP case remains blocked before execution by the pre-existing `@factory/errors` workspace module-resolution failure, so no Phase 8 assertion failure is attributed to this pass.
- `Goldenrepo-js_py` remains excluded. No provider or database effect occurred; live WhatsApp, real-PostgreSQL, delivery runtime, legal/tax, and deployment evidence remain verify-only/external-blocked.

## Phase 9: Billing, subscriptions, invoices, and tax boundaries

- Added ARS-only tenant billing contracts and an asynchronous `BillingStore` boundary in `apps/api/src/tus/billing/index.ts`.
- Added deterministic account ownership, subscription plan snapshots, cancellation and provider-disabled dunning, tax-gated invoice issuance/numbering, immutable invoice snapshots, credit/refund compensations, linked ledger entries, tenant idempotency, audit/outbox effects, and accounting external-approval gating.
- Added `apps/api/src/tus/billing/prisma.ts` with Prisma BigInt/date conversion and generated-delegate persistence mappings. Undefined nullable dates are normalized to `null` rather than invalid `Date` values.
- Added additive Prisma schema/migration coverage for billing accounts, plans, refunds, ledger, idempotency, audit, outbox, dunning, invoice numbering, accounting exports, tax metadata, and append-only database triggers. No migration was executed.
- Added `tests/foundation/p9-billing.test.mjs` and `billing-evidence.md`; updated migration inventory expectations for the new migration.

### Phase 9 TDD Cycle Evidence

| Task | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| 9.1 | `tests/foundation/p9-billing.test.mjs` | ✅ Missing billing module failure before implementation | ✅ Pinned Node runner: 7/7 passed | ✅ Tenant, ARS/BigInt, tax gate, numbering, subscriptions/dunning, immutable compensation, idempotency/audit/outbox, accounting, and Prisma boundary cases | ✅ Corrected nullable date mapping and unified sync/async store compatibility |

### Phase 9 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p9-billing.test.mjs`; exit 0, 7 passed, 0 failed. |
| Migration safety command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/migration-repair.test.mjs`; exit 0, 14 passed, 0 failed. Prisma schema validation passed. |
| Runtime harness command/scenario and exact result | N/A by explicit execution boundary: no API server, PostgreSQL, migration, seed, provider, browser, Docker, or credentials were used; deterministic in-memory and Prisma-delegate fakes only. |
| Rollback boundary | Revert only the Phase 9 billing source, Prisma schema/migration, migration inventory expectation, focused test, tasks checkbox, progress/evidence artifacts; preserve Phases 0–8 and unrelated working-tree changes. |

### Phase 9 Limits

- Full API typecheck still has pre-existing `@factory/errors` workspace-resolution errors and unrelated delivery type errors; no billing-specific TypeScript errors remain after the async store correction.
- No live PostgreSQL, ARCA/AFIP, Mercado Pago, accounting, legal/tax, KYC/KYB, provider, or deployment evidence was produced. These remain verify-stage/external-blocked.

## Phase 9.1 Recovery Pass

- Re-read the current billing implementation/tests/evidence, proposal, design, billing specifications, tasks, Prisma schema/migration, current diff, and prior Engram progress before applying a bounded correction.
- Preserved all cumulative Phase 0–8 and Phase 9 completion evidence; `Goldenrepo-js_py` remains excluded.
- Enforced tenant ownership for explicitly supplied invoice billing accounts and denied cross-tenant account references without existence disclosure.
- Enforced exact invoice payment/order/POS linkage for credits and refunds; ledger compensation entries now cannot be relinked to a different commercial charge.
- Kept tax evidence separate from external approval: an evidence reference never becomes an ARCA/AFIP approval reference without an approved external gate; malformed currencies fail with the bounded billing error.
- Preserved issued invoice snapshots, including tax approval metadata, and added the controlled draft-to-issued persistence update path. Prisma now maps legacy and additive invoice money columns as `BIGINT` values.
- Added append-only SQL fences for invoice lines, billing audit, billing idempotency, and accounting exports. Outbox event identity/payload is immutable in the in-memory boundary while status/attempt scheduling remains worker-operational.

### Phase 9.1 Recovery TDD Cycle Evidence

| Correction | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Tenant account, compensation linkage, and tax evidence | `tests/foundation/p9-billing.test.mjs` | ✅ New cross-tenant/mismatch/approval-separation assertions failed before correction | ✅ 12/12 passed | ✅ Refund and credit paths plus existing issued-snapshot coverage | ✅ Shared guards and non-claiming tax snapshot |
| Prisma invoice update and legacy exact-money mapping | `tests/foundation/p9-billing.test.mjs` | ✅ Duplicate-create/omitted legacy-column assertions failed | ✅ 12/12 passed | ✅ Controlled update plus all four legacy money columns | ✅ Unknown-safe row conversion; no explicit `any` |
| Append-only control coverage | `tests/foundation/p9-billing.test.mjs` | ✅ Missing invoice-line/control triggers and conflicting in-memory rewrites failed | ✅ 12/12 passed | ✅ Database trigger text and audit/outbox/idempotency behavior | ✅ Outbox lifecycle fields remain mutable by design |

### Phase 9.1 Recovery Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p9-billing.test.mjs`; exit 0, 12 passed, 0 failed. |
| Migration safety command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/migration-repair.test.mjs`; exit 0, 14 passed, 0 failed. Prisma schema validation passed. |
| Static checks | `git diff --check`; passed. API typecheck remains blocked by the known pre-existing `@factory/errors` module resolution and unrelated delivery type errors; no billing-specific errors remain. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: no API server, PostgreSQL, migration, seed, provider, browser, Docker, deployment, or credentials were used; deterministic fakes only. |
| Rollback boundary | Revert only `apps/api/src/tus/billing/{index.ts,prisma.ts}`, the Phase 9 billing migration trigger/mapping corrections, and the recovery assertions/evidence; preserve prior Phase 9 and unrelated work. |

### Phase 9.1 Recovery Limits

- No live PostgreSQL, ARCA/AFIP, IVA/legal, accounting, Mercado Pago/provider, KYC/KYB, or deployment evidence was produced. These remain verify-stage/external-blocked.
- No database connection, migration, seed, write, provider request, secret read, server, browser, Docker, or deployment effect occurred.
