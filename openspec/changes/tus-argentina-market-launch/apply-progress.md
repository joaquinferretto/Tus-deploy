# Apply Progress: TUS Argentina Market Launch

## Status

- Phase 0, Phase 1, and Phase 2 foundation implementation is complete for deterministic/static gates; live backup/restore, PostgreSQL DDL, and external runtime evidence remain blocked by the explicit execution boundary.
- Phase 3 and Phase 4 implementation is complete for deterministic in-memory coverage; the focused runner is available through the repository's pinned NVM Node toolchain.
- Phase 5 and Phase 6 implementation is complete for deterministic focused coverage; live persistence/provider evidence remains blocked by the execution boundary.
- Phase 7 and Phase 8 implementation is complete for deterministic focused coverage; live WhatsApp, database, and delivery runtime evidence remains verify-only.
- Runtime database execution remains intentionally blocked; no database writes were performed.
- Phase 12 deployment/operations implementation is complete for deterministic static/configuration coverage; live cloud, DNS/TLS, worker, backup, and production evidence remains external-blocked.
- The cumulative task artifact now marks all 14 implementation tasks complete; this does not promote external-blocked evidence to readiness.
- Exact-money correction is implemented statically; the focused suite requires the pinned NVM Node path for re-verification.

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

## Exact-Money Correction Pass

- Added canonical `MoneyJson` serialization/deserialization and bigint-safe JSON helpers in `packages/contracts/src/money.ts`.
- Added currency scale metadata for ARS, USD, and EUR and rejected non-canonical minor-unit strings at JSON boundaries.
- Changed additive POS repair columns from `DOUBLE PRECISION` to `BIGINT` and added uppercase ISO currency checks.
- Added additive launch-baseline currency checks and an exact-money SQL compatibility gate.
- Strengthened approved historical backfill SQL with unknown-currency, invalid-number, fractional-precision, and signed-64-bit overflow preflight checks.
- Hardened `apps/api/src/tus/finance/prisma.ts` to use `unknown` row fields and reject unsafe BigInt-to-number persistence conversions instead of silently losing precision.
- Updated `database-evidence.md` and added `money-evidence.md`; no database effect occurred.

### Exact-Money Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | Migration repair: pinned NVM Node test command; exit 0, 18 passed, 0 failed. Finance persistence/webhook: `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/finance-webhook.test.mjs`; exit 0, 7 passed, 0 failed. |
| Runtime harness command/scenario and exact result | N/A; this correction is static contracts/migration safety work and the explicit boundary prohibits database/provider/runtime execution. |
| Rollback boundary | Revert only exact-money helpers/exports, additive migration type/constraint changes, migration repair gates, focused migration tests, and exact-money evidence artifacts. |

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

## Phase 10: Web / PWA

- Added `apps/web/src/lib/tus-web-contract.ts` for truthful payment states, secret-safe UI errors, offline POS record shape, and explicit PWA capability labels.
- Extended `apps/web/src/lib/tus-client.ts` with registration, recovery, calendar slots/bookings, payment intents, POS status, delivery tasks, and support-case routes. Service-slot dates are encoded in the URL and mutations preserve stable idempotency keys.
- Updated both web and auth fetch transports to use explicit bearer authorization with `credentials: 'omit'`; auth/recovery requests do not require client-authored tenant context.
- Added a reconnect-aware POS queue path that stores only the non-token operation payload and keeps the operation `queued-offline` until server acknowledgement.
- Added public recovery navigation and install/update/offline boundary copy without claiming that installability provides offline server operation.

### Phase 10 TDD Cycle Evidence

| Task | Test file | RED | GREEN | REFACTOR |
|---|---|---|---|---|
| 10.1 | `tests/foundation/tus-web-pwa.test.mjs` | ✅ 4/4 failed before implementation: missing web contract/client methods, ambient-cookie transport, and recovery/PWA source contracts | ✅ Pinned Node runner: 4/4 passed | ✅ Combined Phase 10 focused set: 40/40 passed; web typecheck passed; POS queue strips `accessToken` before local persistence |

### Phase 10 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/tus-web-pwa.test.mjs tests/foundation/tus-journeys-ui.test.mjs tests/foundation/tus-idempotency-ui.test.mjs tests/foundation/tus-responsive-pwa.test.mjs tests/foundation/p9-ui-contract.test.mjs tests/foundation/tus-ui-ux-improvement.test.mjs`; exit 0, 40 passed, 0 failed. |
| Typecheck command and exact result | `pnpm --filter @factory/web typecheck` with the pinned NVM Node directory prepended to `PATH`; exit 0. |
| Runtime harness command/scenario and exact result | N/A by explicit execution boundary: no API server, database, provider, browser, device, Docker, or deployment runtime was started; deterministic transport and source-contract harnesses only. |
| Rollback boundary | Revert `apps/web/src/lib/tus-web-contract.ts`, the Phase 10 additions in `apps/web/src/lib/tus-client.ts` and `tus-auth-client.ts`, the POS/home changes, and `tests/foundation/tus-web-pwa.test.mjs`; preserve Phases 0–9 and unrelated work. |

### Phase 10 Validation Limits

- `apps/web` production build compiled, typechecked, linted, and generated 14 static pages, but Next standalone trace finalization failed with Windows `EPERM` while creating dependency symlinks. This is an environment permission limitation, not a source compile failure.
- `git diff --check`: passed; existing LF/CRLF normalization warnings remain.
- No browser screenshot or live web/API evidence was produced; browser/runtime evidence remains verify-only.

## Phase 10 Recovery Pass

- Re-read the current web/PWA source, focused tests, web evidence, cumulative apply progress, proposal, design, and applicable commerce, settlement, messaging/delivery/billing, and launch-surface specifications before making bounded corrections.
- Corrected the POS feedback action so `Refresh server status` calls the read-only POS operation-status route and never resubmits the original sale. Offline status checks remain pending without creating another queue record.
- Removed browser token persistence from the web auth client. Confirmed bearer credentials now remain module-volatile, legacy browser storage is cleared without being read or written, and in-app sign-in uses client navigation so the volatile session survives the route transition. A full browser reload requires fresh sign-in by design.
- Preserved all prior Phase 0–9 and Phase 10 implementation evidence; `Goldenrepo-js_py` remains excluded.

### Recovery TDD Cycle Evidence

| Correction | Test file | RED | GREEN | REFACTOR |
|---|---|---|---|---|
| POS refresh status boundary | `tests/foundation/tus-web-pwa.test.mjs` | ✅ New source-contract test failed because refresh invoked `sendOperation` and no status method existed | ✅ Focused recovery test passed 5/5 | ✅ Shared POS error classification retained; status path remains GET/read-only |
| Volatile auth credential | `tests/foundation/tus-web-pwa.test.mjs` and `tests/foundation/tus-ui-ux-improvement.test.mjs` | ✅ New no-storage test failed on `storage.write`; existing persistence assertions were updated to the required volatile contract | ✅ Focused combined web set passed 42/42 | ✅ Removed credential serialization/read path; sign-in retains bearer-only in-memory navigation |

### Recovery Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd test -- tests/foundation/tus-web-pwa.test.mjs tests/foundation/tus-journeys-ui.test.mjs tests/foundation/tus-idempotency-ui.test.mjs tests/foundation/tus-responsive-pwa.test.mjs tests/foundation/p9-ui-contract.test.mjs tests/foundation/tus-ui-ux-improvement.test.mjs`; exit 0, 42 passed, 0 failed. |
| Web typecheck command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd --filter @factory/web typecheck`; exit 0 after the build generated `.next/types`. |
| Build command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd --filter @factory/web build`; compiled successfully, typechecked, linted, and generated 14 pages; final standalone tracing failed only on Windows `EPERM` dependency symlink creation. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: no API service, database, provider, browser, device, Docker, deployment, or external runtime was started; deterministic transport/source-contract harnesses only. |
| Browser effects | None. No browser session, screenshot, navigation, or live web/API call was executed. |
| Database effects | None. No connection, migration, DDL, seed, read, write, rollback, or schema operation was executed. |
| Rollback boundary | Revert only the recovery additions in `apps/web/src/app/(auth)/sign-in/page.tsx`, `apps/web/src/app/tus/tus-pos.tsx`, `apps/web/src/lib/tus-auth-client.ts`, the two focused test files, and this recovery evidence; preserve Phases 0–9, prior Phase 10 contracts, unrelated changes, and `Goldenrepo-js_py` exclusion. |

### Recovery Result Fields

- `status`: `success`
- `executive_summary`: Phase 10 web/PWA contracts were revalidated and two narrow defects were corrected: POS refresh is status-only, and auth bearer credentials are no longer browser-persisted.
- `artifacts`: `apps/web/src/app/(auth)/sign-in/page.tsx`; `apps/web/src/app/tus/tus-pos.tsx`; `apps/web/src/lib/tus-auth-client.ts`; `tests/foundation/tus-web-pwa.test.mjs`; `tests/foundation/tus-ui-ux-improvement.test.mjs`; this apply progress; `web-evidence.md`.
- `tasks_completed`: `10.1` and `11.1` are checked; cumulative task progress is 9/14 with Phases 12–13 and the earlier incomplete safety/database/backend tasks still pending.
- `tests`: focused combined set 42/42; web typecheck 0; build compiled/typechecked/linted/generated 14 pages before EPERM trace finalization.
- `browser_effects`: none.
- `database_effects`: none.
- `risks`: no persistent bearer means a full browser reload requires fresh sign-in; browser/live API/provider/database/deployment evidence remains verify-only or external-blocked; Windows standalone tracing remains EPERM-limited.
- `next_recommended`: `sdd-verify` after the remaining tasks are complete; Phase 12 is the next implementation slice.
- `skill_resolution`: `fallback-path` for the four user-specified skill paths; CodeGraph fallback because the upstream CLI was unavailable.
- `cleanup_state`: no runtime processes or external resources were started; no cleanup required; generated `.next` build output is local tooling state only.

## Phase 11: Native Mobile / POS

- Added the mobile surface client for device registration, POS sessions, status-only operation lookup, refunds, marketplace discovery, service booking, payment intent, delivery tasks, and support cases.
- Enforced bearer-only mobile transport and removed access tokens from persisted offline POS envelopes. Replayed operations obtain the current token from secure credential storage rather than queue storage.
- Closed the replay credential gap: legacy/in-memory `operation.accessToken` values are stripped before queue restoration/submission, and every POS request/status lookup resolves the current bearer from secure credential storage at request time.
- Added registration/recovery auth actions, recovery route/link, native NetInfo/AppState lifecycle synchronization, deterministic status refresh, and accessible POS feedback actions.
- Preserved offline/replay semantics: accepted/replayed/conflict/pending/error states remain server-evidence driven; status refresh never resubmits a sale.

### TDD Cycle Evidence

| Task | Test file | RED | GREEN | REFACTOR |
|---|---|---|---|---|
| 11.1 | `apps/mobile/tests/unit/*.test.ts(x)` | ✅ Runtime refresh/persisted-token tests failed before implementation; recovery assertion failed when a stale operation token won over secure storage | ✅ Pinned Jest runner: 11 suites, 69 tests passed | ✅ POS lifecycle callback stabilized; status lookup remains read-only; queue and in-memory replay operations strip bearer tokens; request-time secure lookup is authoritative |

### Phase 11 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd --filter @factory/mobile exec jest tests/unit --runInBand`; exit 0, 11 suites passed, 69 tests passed, 0 failed, including secure request-time replay lookup. |
| Typecheck command and exact result | `pnpm.cmd --filter @factory/mobile typecheck`; exit 0. |
| Lint command and exact result | `pnpm.cmd --filter @factory/mobile lint`; exit 0, 0 errors, 11 pre-existing/style warnings. |
| Expo config command and exact result | `APP_PROFILE=staging .\\node_modules\\.bin\\expo.cmd config --type public`; exit 0, staging config resolved with web/iOS/Android platforms and `factory-staging` scheme. |
| Expo web export command and exact result | From `apps/mobile`: `APP_PROFILE=staging .\\node_modules\\.bin\\expo.cmd export --platform web --output-dir .expo-export-check`; web bundle exported successfully (787 modules, `index.html`, JS bundle, metadata). Temporary export directory was removed. |
| Runtime harness command/scenario and exact result | N/A: no native device/emulator, API service, database, payment provider, browser session, Docker, deployment, or external runtime was started. Native/device evidence remains verify-only. |
| Rollback boundary | Revert `apps/mobile/app/(app)/pos.tsx`, `apps/mobile/app/(auth)/recovery.tsx`, `apps/mobile/app/(auth)/login.tsx`, `apps/mobile/src/application/{tus-auth,tus-client,tus-surface-client,mobile-lifecycle}.ts`, `apps/mobile/src/core/services/secure-credential-store.ts`, the Phase 11 unit tests, and this Phase 11 evidence; preserve Phases 0–10 and unrelated working-tree changes. |

### Phase 11 Limits

- The package `test` script is a no-op (`node -e "process.exit(0)"`); passing evidence uses the real installed Jest binary directly. Passing `--runInBand` through `pnpm --filter @factory/mobile test` therefore fails because Node rejects that argument; this is a script limitation, not a test failure.
- Lint warnings remain in existing `require()`/array-type patterns and test import ordering; no lint errors remain.
- No native device evidence, real tenant/provider/database effect, or production/deployment claim is made.

### Phase 11 Recovery Pass

- Added one bounded regression assertion inside the existing POS security test: a stale `operation.accessToken` must not override the fresh credential returned by secure storage during replay.
- RED result: the transport sent `Bearer stale-operation-token`; GREEN result: the full mobile suite returned 69/69 after request-time secure lookup and token stripping were enforced.
- No other mobile contract, runtime, or evidence boundary was changed; `Goldenrepo-js_py` remains excluded.

## Phase 12: Deployment / Operations / Evidence

- Added `PORT=$PORT` Render API and web start contracts, explicit liveness/readiness documentation, and Docker local port defaults without changing external deployment state.
- Added `scripts/deployment/render-predeploy.mjs`, which refuses migration release unless an approved environment provides a verified backup and `additive-only` plan, then invokes only `prisma migrate deploy` before API start.
- Replaced the Python worker's one-shot example execution with a long-lived, signal-aware queue consumer path; Render remains explicitly disabled with `external-blocked-placeholder` and `WORKER_ENABLE_CONSUMER=false`.
- Normalized worker local settings to the repository-root `.env` while retaining platform environment injection under canonical names; corrected web/API/mobile no-op test scripts where safe and pinned CI's pnpm version.
- Added DNS/TLS/CORS domain contracts, consolidated deployment/operations runbook coverage for secrets, rotation, monitoring, logging, SLO targets, alerts, incidents, rollback, backup/restore, and owned PID cleanup.
- Added `evidence-index.md`, `deployment-operations-evidence.md`, and focused static/config tests. All evidence is deterministic or external-blocked; no live success is claimed.

### Phase 12 TDD Cycle Evidence

| Task | Test file | RED | GREEN | REFACTOR |
|---|---|---|---|---|
| 12.1 | `tests/foundation/p12-deployment-operations.test.mjs` | ✅ Initial run: 6/7 assertions failed before implementation because the backup wrapper/runbook/domain/index were absent, the worker was one-shot, and package tests were no-ops; recovery added root-only environment, migration history/selection, worker dependency, and package-runner assertions | ✅ Pinned Node runner: 9/9 passed | ✅ Release order, root env inventory, explicit worker gates, DNS/TLS/CORS, CI, runbooks, PID cleanup, and truthful evidence index are covered |

### Phase 12 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p12-deployment-operations.test.mjs`; exit 0, 9 passed, 0 failed. |
| Python static command and exact result | `python -m compileall -q apps/workflow-runtime-python/src/worker`; exit 0. No worker process was started. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: no Render/Vercel/DNS/TLS/worker/API listener/Docker/provider/PostgreSQL/backup/browser runtime was started or contacted. |
| Toolchain/plan checks | Terraform and cloud CLI execution not attempted; no CLI was required for static contracts and no live claim is made. PyYAML parsed `render.yaml` and `docker-compose.yml` successfully; no deployment was executed. |
| Package script smoke | With pinned Node on PATH, `pnpm.cmd --filter @factory/web test` and `@factory/api test` each exited 0 and ran all 9 focused tests. The earlier PATH/module-loader failures were corrected by rooting both scripts through `pnpm --dir ../..`. |
| Rollback boundary | Revert only Phase 12 files listed in `deployment-operations-evidence.md`; preserve Phases 0–11, sibling exclusion, and unrelated working-tree changes. |

### Phase 12 Limits

- No live Render/Vercel/worker/backup/DNS/TLS/CORS/production success is claimed.
- PostgreSQL was not connected, migrated, seeded, read, written, or restored. The Render migration wrapper remains backup-gated and was not invoked.
- Existing unrelated working-tree changes were preserved. `Goldenrepo-js_py` remains excluded.

## Phase 12 Recovery Pass

- Revalidated the deployment files, Phase 12 test/evidence, umbrella proposal/design/specification, environment inventory, and current migration inventory without restarting earlier phases.
- Found and corrected three narrow issues: local API configuration could consume an ambient development `DATABASE_URL`; the Render migration wrapper did not require reconciled historical state and an exact selected additive migration before `prisma migrate deploy`; and package test scripts required a nested `pnpm` command to be discoverable on `PATH`.
- Local/test API configuration now reads only the repository-root `.env` `DATABASE_URL`; production configuration accepts the platform-injected canonical key. Package-local API/web environment examples no longer advertise database configuration.
- Render migration release now requires verified backup, `additive-only`, reconciled history, and `20260909090000_tus_argentina_market_launch` selection before Prisma is invoked. Historical migration inventory remains external/blocked and no database operation was run.
- Worker activation now remains fail-closed unless canonical `DATABASE_URL`, `REDIS_URL`, `QUEUE_REF`, deployment status, consumer enablement, and queue ownership are present; the checked-in Render worker remains disabled and `external-blocked-placeholder`.
- Root test runner invocation is portable from workspace package scripts; `Goldenrepo-js_py` remains excluded.

### Recovery Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `node scripts/test-runner.mjs tests/foundation/p12-deployment-operations.test.mjs` with pinned Node; exit 0, 9 passed, 0 failed |
| Package script smoke | With pinned Node on `PATH`, `pnpm.cmd --filter @factory/web test` and `@factory/api test`; exit 0, 9 passed each, 0 failed |
| Python/YAML static checks | `python -m compileall -q apps/workflow-runtime-python/src/worker`; exit 0. PyYAML parsed `render.yaml` and `docker-compose.yml`; exit 0 |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: no API, worker, database, backup, provider, browser, Docker, cloud, DNS, or TLS runtime was started |
| Rollback boundary | Revert only the Phase 12 recovery files: `scripts/deployment/render-predeploy.mjs`, API configuration, worker config/activation, Render metadata, package scripts/root runner, package env examples, focused test, and deployment evidence; preserve all prior phases and sibling exclusion |

### Recovery Result Fields

- `status`: `success`
- `executive_summary`: Phase 12 deployment/operations contracts were revalidated and minimally corrected for root-only local database resolution, additive migration history/selection gating, explicit worker dependencies, and portable package test execution.
- `artifacts`: `scripts/deployment/render-predeploy.mjs`; `apps/api/src/platform/configuration/domain.ts`; `apps/workflow-runtime-python/src/worker/{main.py,core/config.py}`; `render.yaml`; `apps/{api,web}/package.json`; `scripts/test-runner.mjs`; package environment examples; Phase 12 test/evidence/runbooks.
- `tasks_completed`: `12.1` and `13.1` are checked; cumulative task state is 13/14 with only safety/database/backend foundation still pending.
- `tests`: Phase 12 focused 9/9; web/API package smoke 9/9 each; Python compileall and YAML parsing passed; `git diff --check` passed with existing line-ending warnings.
- `browser_effects`: none.
- `database_effects`: none; migration inventory confirmed historical destructive/ambiguous statements, but no wrapper or Prisma command was invoked.
- `risks`: live deployment, database, worker lease/heartbeat, backup/restore, DNS/TLS, CORS browser, provider, and production SLO evidence remain external-blocked; worker activation requires owner-provided queue/lease evidence and remains disabled in Render.
- `next_recommended`: `sdd-verify` for the completed implementation slices; do not treat static evidence as deployment readiness.
- `skill_resolution`: requested `sdd-apply`, `_shared`, `typescript`, and `nextjs-15` paths loaded; upstream CodeGraph CLI unavailable, so structural fallback used after confirming `.codegraph/`.
- `cleanup_state`: no runtime process or external resource was started; temporary test directories were removed; no PID cleanup required.

## Phase 13: Pilot / Go-Live Readiness Gates

- Added `scripts/launch/pilot-readiness.mjs` with the complete database/schema/tenancy/POS/payments/WhatsApp/delivery/billing/web/mobile/deployment capability matrix, explicit evidence taxonomy, fail-closed P0 evaluation, idempotent decision replay/conflict fencing, P0 rollback preservation, canary/pilot/broad-launch flags, and tenant/customer allowlists.
- Added `tests/foundation/p13-pilot-go-live.test.mjs` covering RED/GREEN/REFACTOR for missing, expired, revoked, conflicting, deterministic-only, out-of-scope, replayed, idempotency-conflicting, and P0 rollback conditions.
- Added `docs/runbooks/tus-pilot-go-live.md` for support, incidents, backup/restore, rollback, staged activation, and user-owned inputs.
- Added `go-live-evidence.md` and extended `evidence-index.md`; all current matrix rows remain `external-blocked`, `liveConformance: false`, and no production readiness is claimed.

### Phase 13 TDD Cycle Evidence

| Task | Test file | RED | GREEN | REFACTOR |
|---|---|---|---|---|
| 13.1 | `tests/foundation/p13-pilot-go-live.test.mjs` | ✅ Initial run failed because `scripts/launch/pilot-readiness.mjs` and Phase 13 evidence/runbook artifacts were absent | ✅ Pinned Node runner: 9/9 passed | ✅ Matrix, evidence separation, P0 expiry/revocation/conflict/idempotency/replay/rollback, flags, and staged tenant/customer activation remain covered |

### Phase 13 Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p13-pilot-go-live.test.mjs` — exit 0; 9 passed, 0 failed; bounded under 180 seconds |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: deterministic gate tests only; no API, worker, PostgreSQL, provider, browser/mobile, Docker, cloud, deployment, migration, seed, backup, or restore runtime was started or contacted |
| Rollback boundary | Revert only `scripts/launch/pilot-readiness.mjs`, `tests/foundation/p13-pilot-go-live.test.mjs`, `docs/runbooks/tus-pilot-go-live.md`, `go-live-evidence.md`, the Phase 13 evidence-index row, and these Phase 13 progress/task additions; preserve all prior phase evidence and `Goldenrepo-js_py` exclusion |

### Phase 13 Limits and Go/No-Go

- **No-go:** all eleven capability rows are currently blocked by missing direct evidence; providers, payments, worker, delivery, and broad launch flags remain false.
- `liveConformance` remains `false` until current, direct, owner-approved, profile- and scope-matched evidence exists. Deterministic, real PostgreSQL local, provider, browser/mobile, deployment, legal/tax, and external-blocked evidence classes remain separate.
- No production readiness, provider conformance, database durability, backup/restore success, tenant/customer activation, cloud health, browser/device, legal/tax, or broad-launch claim is made.
- User-owned inputs remain the exact blockers recorded in `go-live-evidence.md`: backup/restore and additive schema approval; tenancy/POS/device ownership; Mercado Pago/WhatsApp/delivery evidence; billing/legal/tax/accounting approval; Render/Vercel/DNS/TLS/worker/operations evidence; browser and Android/iPhone evidence.

## Phase 0–2 Foundation Recovery Pass

- Revalidated the repository boundary and corrected `git -C` resolution so relative and absolute selections are evaluated against `Goldenrepo-js-py`, the underscore sibling is rejected before ambiguity handling, matching explicit roots are accepted, and commit/push commands require an intended staged index and explicit branch refspec.
- Added exact decimal-to-minor conversion with explicit rounding policy and a separate approval-gated additive backfill planner. The planner emits no SQL until an approval identifier exists and always requires development confirmation plus verified backup/restore.
- Revalidated the complete migration inventory and destructive replay refusal. Historical migrations remain inventory-only; the selected launch baseline remains additive and no historical file or ledger row was rewritten.
- Added a real backup-tooling gate to the default repair path. Missing `pg_dump`/`pg_restore` blocks before connection and never creates a fake dump or claims restore success.
- Reconciled backend focused execution by adding the missing `@factory/errors` workspace dependency/link and using Node's transform-types mode when supported by the pinned runtime. Production/provider/worker flags remain fail-closed.

### Phase 0–2 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 0.1 | `tests/foundation/sdd-git-boundary.test.mjs` | Unit/contract | ✅ Existing 4-case baseline exposed two boundary defects | ✅ Added relative `git -C`, matching-root, index, and explicit-refspec cases | ✅ Pinned runner 5/5 passed | ✅ Boundary remains hyphenated-only across relative/absolute/`git -C` inputs | ✅ Explicit command construction is path/refspec fenced |
| 1.1 | `tests/integration/tus/migration-repair.test.mjs` | Unit/integration contract | ✅ Existing 14-case migration baseline passed | ✅ Added decimal conversion, approval-gated backfill, and backup-tooling cases | ✅ Pinned runner 16/16 passed | ✅ Reject, half-up, approved, missing tooling, and injected backup paths covered | ✅ SQL identifiers and diagnostics are validated/redacted |
| 2.1 | `tests/foundation/backend-runtime-security.test.mjs`, `tests/foundation/backend-hardening.test.mjs` | Unit/integration contract | ✅ Initial run exposed missing workspace `@factory/errors` resolution and Node strip-only limitation | ✅ Dependency/link and transform-types runner correction applied | ✅ Pinned runner 6/6 + 8/8 passed | ✅ Root env, retry cleanup, no-listener, readiness, CORS, limits, auth rollback, and redaction remain green | ✅ Only the directly related resolution/runtime harness blockers were corrected |

### Phase 0–2 Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/sdd-git-boundary.test.mjs tests/integration/tus/migration-repair.test.mjs tests/foundation/backend-runtime-security.test.mjs tests/foundation/backend-hardening.test.mjs` — exit 0; 5 + 16 + 8 + 6 = 35 passed, 0 failed |
| API typecheck command and exact result | Pinned `pnpm.cmd --filter @factory/api typecheck` with the NVM directory on `PATH` — `@factory/errors` resolution is cleared; exit 2 only for pre-existing unrelated Phase 8 delivery status-union errors at `apps/api/src/tus/delivery/index.ts:337,365` |
| Static safety command and exact result | `git diff --check` — passed; no destructive database command was executed |
| Runtime harness command/scenario and exact result | Deterministic tests used only ephemeral in-process HTTP listeners; no long-lived API/worker service, PostgreSQL connection, migration, seed, backup, restore, Docker, browser, provider, or deployment runtime was started |
| Rollback boundary | Revert only `scripts/sdd/git-boundary.mjs`, `tests/foundation/sdd-git-boundary.test.mjs`, `packages/contracts/src/money.ts`, `scripts/tus-migration-repair-lib.mjs`, `tests/integration/tus/migration-repair.test.mjs`, `apps/api/package.json`, the corresponding lock importer, `scripts/test-runner.mjs`, and the parameter-property compatibility correction in `apps/api/src/auth-security/adapters/postgres/prisma-identity-store.ts`; preserve Phases 3–13 and unrelated working-tree changes |

### Phase 0–2 Limits

- `pg_dump` and `pg_restore` remain unavailable; backup/restore is blocked and no substitute artifact was created.
- No PostgreSQL connection, DDL, seed, migration, read, write, restore, provider call, service, browser, Docker, or deployment effect occurred.
- API typecheck is not fully green because only unrelated pre-existing Phase 8 delivery type errors remain after the `@factory/errors` blocker was resolved.
- Static/deterministic completion does not promote the database, schema, deployment, provider, or go-live evidence classes.

## P1 Remediation Pass

- Revalidated the P1 findings from `verify-report.md` with RED coverage in `tests/foundation/p1-remediation.test.mjs`.
- Mounted injected TUS routers in `apps/api/src/server.ts`, restoring the isolated HTTP harness routes without starting a long-lived service.
- Corrected delivery status narrowing and explicit middleware typing in `apps/api/src/tus/delivery/index.ts` and `apps/api/src/presentation/middleware/correlation.ts`; the API typecheck is now green.
- Added browser/Node library declarations and corrected the workspace TypeScript config dependency in `packages/mercado-pago`; regenerated the lockfile and installed links offline without scripts.
- Replaced scanner-triggering test fixture values with short, clearly synthetic placeholders. The security scanner's `--tracked` mode was run against the staged index temporarily and the files were restored to unstaged state afterward; the working-tree path scan also passed.
- Added `scripts/prisma-validate.mjs` and `apps/api`'s `prisma:validate` script so Prisma resolves only the repository-root `.env` database URL, without logging it or connecting to the database.
- Fixed marketplace HTTP serialization of exact money `bigint` values at the JSON boundary in `apps/api/src/tus/http/router.ts`; this removed the remaining 500/400/empty-discovery cascade in the legacy marketplace scenarios.

### P1 Remediation TDD Cycle Evidence

| Correction | Test file | RED | GREEN | REFACTOR |
|---|---|---|---|---|
| Injected TUS router mounting | `tests/foundation/p1-remediation.test.mjs` | ✅ Isolated discovery route returned 404 before mounting correction | ✅ Focused remediation suite passed 7/7 | ✅ Existing route factories remain injectable and no long-lived listener is retained |
| Delivery status and middleware TypeScript blockers | `tests/foundation/p1-remediation.test.mjs` plus API typecheck | ✅ API typecheck failed at delivery status predicates and inferred middleware portability | ✅ `@factory/api` typecheck and root typecheck passed | ✅ Narrow guards and explicit `RequestHandler` typing preserve existing runtime behavior |
| Mercado Pago build/configuration and lockfile | `tests/foundation/p1-remediation.test.mjs` plus package test | ✅ Package build lacked DOM/Node globals and workspace config resolution | ✅ Package build/test passed 7/7 | ✅ Browser/Node declarations stay package-local and exact-money values remain lossless internally |
| Security fixture scan | `tests/foundation/p1-remediation.test.mjs` plus security scan | ✅ Scanner rejected two test-only placeholder values | ✅ Tracked-index scan and explicit working-tree scan exited 0 | ✅ No real-looking credentials were added; values remain test-only |
| Root-env Prisma validation | `tests/foundation/p1-remediation.test.mjs` plus `prisma:validate` | ✅ Package-local Prisma validation could not resolve `DATABASE_URL`/CLI | ✅ Schema validation passed with no database connection | ✅ URL remains process-local and is never printed |
| Marketplace JSON boundary | `tests/foundation/p1-remediation.test.mjs` plus P8 marketplace HTTP suite | ✅ Listing JSON serialization produced HTTP 500 due to `bigint` values | ✅ Marketplace suite passed 8/8 and all legacy P8 HTTP suites passed | ✅ Only marketplace response payloads are serialized at the HTTP boundary |

### P1 Remediation Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p1-remediation.test.mjs tests/foundation/p8-tus-commerce-api.test.mjs tests/foundation/p8-tus-marketplace.test.mjs tests/foundation/p8-tus-delivery-pos.test.mjs tests/foundation/p8-tus-finance.test.mjs` — exit 0; 35 passed, 0 failed. |
| Typecheck/build command and exact result | Pinned Node on `PATH`: `pnpm typecheck` — exit 0; 8/8 tasks passed. `pnpm --filter @factory/api typecheck` — exit 0. `pnpm --filter @repo/mercado-pago test` — exit 0; 7 passed. |
| Security/Prisma command and exact result | `pnpm security:scan` — exit 0 with the two corrected fixture files temporarily staged for the scanner's index-based `--tracked` mode, then unstaged. Explicit working-tree scan — exit 0. `pnpm --filter @factory/api run prisma:validate` — exit 0; schema valid, no connection. |
| Runtime harness command/scenario and exact result | Deterministic in-process HTTP listeners exercised router mounting, marketplace discovery/checkout, commerce, delivery/POS, and finance paths; all 28 legacy P8 cases passed. No database, provider, browser, Docker, worker, or deployment runtime was started. |
| Rollback boundary | Revert only the P1 remediation changes in `apps/api/src/server.ts`, `apps/api/src/presentation/middleware/correlation.ts`, `apps/api/src/tus/delivery/index.ts`, `apps/api/src/tus/http/router.ts`, `packages/mercado-pago/{package.json,tsconfig.json}`, fixture placeholders, `scripts/prisma-validate.mjs`, `apps/api/package.json`, `pnpm-lock.yaml`, and the focused remediation test/artifacts; preserve unrelated working-tree changes and `Goldenrepo-js_py`. |

### P1 Remediation Limits

- No PostgreSQL connection, DDL, migration, seed, backup, restore, provider request, credential access, browser/device runtime, Docker, worker, or deployment execution occurred.
- `liveConformance` remains `false`; this pass clears deterministic compile, package, security, Prisma-schema, and legacy HTTP contract failures only.

## Final P1 Remediation Correction Pass

- Corrected the two failing `p9-marketplace` `tsx --eval` boundaries to use a
  JSON replacer that emits `bigint` minor units as decimal strings. The parsed
  test contract now asserts exact `priceMinor` and commitment snapshot strings;
  no money value is converted through `Number(bigint)` or another floating
  point path.
- Isolated the Next failure to generated page-data modules shared by the
  `_not-found`, `/auth/recovery`, and `/tus/pos` routes. The repository-root
  `outputFileTracingRoot` is now explicit, and Windows avoids unsupported pnpm
  standalone symlink copying while Linux production retains standalone output.
  The production build now generates all 14 routes without the `a[d]` error.
- The two test fixtures remain short synthetic values and pass the tracked scan
  when the corrected current files are temporarily indexed, plus the explicit
  working-tree scan. The scanner's real-secret patterns were not weakened.
- Reconciled only `go-live-evidence.md` with the authoritative `14/14` task
  count, `0/11` direct capability evidence, and `liveConformance: false`.
  Fixture-only PostgreSQL evidence remains unpromoted.

### Final P1 TDD Cycle Evidence

| Correction | RED | GREEN | REFACTOR |
|---|---|---|---|
| Marketplace JSON contract | `p9-marketplace.test.mjs`: 2/6 failed on direct `bigint` JSON serialization. | Pinned runner: 6/6 passed; legacy marketplace: 8/8 passed. | Exact minor units remain strings across the JSON boundary; internal values remain `bigint`. |
| Next build contract | Production build reproduced `TypeError: a[d] is not a function` during page-data collection. | Web build and root build exit 0; 14 routes generated. | Explicit workspace tracing and platform-specific standalone behavior preserve the Linux deployment contract. |
| Security fixtures | Tracked scan rejected the stale index content for the two fixture paths. | Temporary two-file index scan and explicit working-tree scan exit 0. | No scanner weakening or secret exposure. |

### Final P1 Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p9-marketplace.test.mjs tests/foundation/p8-tus-marketplace.test.mjs tests/foundation/p1-remediation.test.mjs`; exit 0, 22 passed, 0 failed. |
| Build/typecheck commands | `pnpm --filter @factory/web build`; exit 0, 14 routes. `pnpm --filter @factory/web typecheck`; exit 0. `pnpm build`; exit 0, 5 build tasks. `pnpm typecheck`; exit 0, 8/8 tasks. |
| Security commands | `pnpm security:scan` with only the two corrected fixtures temporarily indexed; exit 0. Explicit paths scan; exit 0. Index restored to unstaged state. |
| Runtime harness command/scenario | Deterministic in-process HTTP marketplace/P1 harnesses only; exit 0. No external runtime boundary was available or authorized. |
| Rollback boundary | Revert only `tests/foundation/p9-marketplace.test.mjs`, `tests/foundation/p1-remediation.test.mjs`, `apps/web/next.config.js`, the two corrected fixture files, `go-live-evidence.md`, `final-remediation-evidence.md`, and this section. Preserve all unrelated changes and `Goldenrepo-js_py`. |

### Final P1 Result Fields

- `status`: `success` for the bounded deterministic remediation; launch remains `NO-GO`.
- `executive_summary`: Marketplace exact-money JSON tests, Next production route generation/build, tracked fixture scanning, and launch evidence reconciliation are complete.
- `tasks_completed`: All 14 cumulative implementation tasks remain checked; this remediation added no new phase task.
- `tests`: Marketplace/P1/legacy marketplace 22/22; web build 14 routes; root build 5/5; root typecheck 8/8; security scans pass.
- `database_effects`: none.
- `provider_effects`: none.
- `risks`: external launch evidence remains blocked; Windows standalone output is intentionally disabled locally due pnpm symlink privilege limits; lint warnings remain.
- `next_recommended`: `sdd-verify` using `final-remediation-evidence.md`; retain `liveConformance: false`.
- `skill_resolution`: Strict TDD with the five requested skills loaded; CodeGraph fallback because the CLI was unavailable.
- `cleanup_state`: no long-lived process or external resource; temporary index staging reverted; generated build/cache state is local only.

## Phase 12 Deterministic Blocker Correction

- Replaced the stale literal standalone-output assertion in `tests/foundation/p12-deployment-operations.test.mjs` with a contract for the actual platform-conditioned configuration: Windows local builds use `undefined`, while non-Windows production builds use `standalone`.
- Added the matching Render deployment contract to `docs/deployment/render.md`, preserving the Linux/Render standalone entrypoint and explicitly documenting that TypeScript and ESLint build failures remain fatal.
- Represented the two corrected security fixtures in the tracked index and ran the normal `pnpm security:scan`; no scanner pattern was weakened, and the real-secret regression still detects a synthetic AWS key without printing its value.
- Preserved the Render, Vercel, Docker, fail-closed evidence boundaries and `Goldenrepo-js_py` exclusion. No new implementation task was added; cumulative tasks remain 14/14.

### Phase 12 Correction TDD Cycle Evidence

| Correction | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Platform-conditioned standalone contract | `tests/foundation/p12-deployment-operations.test.mjs` | ✅ Baseline was 8/9: stale `/output:\s*['"]standalone['"]/` rejected the existing Windows-safe config; the replacement also failed until the Render contract was documented | ✅ Pinned runner: 9/9 passed | ✅ Conditional config, Render Linux standalone documentation, strict build-failure flags, Vercel contract, and no-`next start` checks all pass | ✅ Assertion is whitespace-tolerant and tests the public deployment contract rather than a stale source literal |
| Tracked security fixture state | `tests/foundation/p0-security.test.mjs` plus normal scanner | ✅ Normal tracked scan rejected stale indexed fixture content before corrected files were represented in the index | ✅ `pnpm security:scan` exit 0; `p0-security.test.mjs` 3/3 passed | ✅ Working-tree fixture values pass while a synthetic `AKIA...` value is still rejected and not printed | ✅ Scanner patterns and redaction behavior unchanged |

### Phase 12 Correction Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p12-deployment-operations.test.mjs`; exit 0, 9 passed, 0 failed. Web/API package smoke each exit 0 with 9 passed, 0 failed. |
| Security command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd security:scan`; exit 0 in normal tracked-index state. `p0-security.test.mjs`; exit 0, 3 passed, 0 failed. |
| Root validation commands and exact result | `pnpm.cmd typecheck`; exit 0, 8/8 tasks. `pnpm.cmd build`; exit 0, 5/5 tasks and 14 web routes. `pnpm.cmd lint`; exit 0, 6/6 tasks, 0 errors, existing warnings only. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: no database/provider/browser/device/cloud/Docker/deployment/long-lived service runtime was started; only bounded deterministic tests and local build tooling ran. |
| Rollback boundary | Revert only `tests/foundation/p12-deployment-operations.test.mjs`, `docs/deployment/render.md`, the two staged security fixture corrections, and this evidence section. Preserve all unrelated working-tree changes and `Goldenrepo-js_py`. |

### Phase 12 Correction Result Fields

- `status`: `success` for the bounded deterministic correction; launch remains `NO-GO` and `liveConformance: false`.
- `executive_summary`: The Phase 12 test now asserts the Windows-safe conditional output while retaining Linux/Render standalone requirements and strict build validation; normal tracked security scanning is clean.
- `tasks_completed`: All 14 cumulative implementation tasks remain checked; this correction added no new phase task.
- `tests`: Phase 12 9/9; web/API package smoke 9/9 each; security scan 0; `p0-security` 3/3; root typecheck 8/8; root build 5/5; root lint 0 errors.
- `database_effects`: none.
- `provider_effects`: none.
- `risks`: Live PostgreSQL, provider, browser/device, deployment, Docker, backup/restore, and legal evidence remain external-blocked; existing lint warnings remain non-blocking.
- `next_recommended`: `sdd-verify` with this correction evidence; retain `liveConformance: false`.
- `skill_resolution`: Strict TDD; requested `sdd-apply`, `_shared`, `typescript`, and `nextjs-15` skills loaded; CodeGraph fallback used because the upstream CLI was unavailable.
- `cleanup_state`: No runtime process or external resource was started. Corrected security fixtures remain intentionally staged so the normal tracked scan evaluates their current content; no unrelated files were staged. Build and TypeScript cache output is local tooling state.

## Final Security/Environment Remediation Pass

- Reconciled the deterministic security-policy blocker to the repository's actual
  active consumer contract: `MONGODB_URL` is canonical in Render, examples, and
  the API connection resolver; `MONGODB_URI` remains only as the resolver's
  explicit compatibility fallback because that consumer still reads it.
- Updated the security policy validator to require the canonical Render key and
  updated deployment/runbook documentation to state the alias boundary without
  emitting or copying secret values.
- Added `resolveMongoUrl` coverage for canonical precedence, development fallback
  behavior, and production/Render fail-closed behavior. Mongo connection error
  logging now emits generic messages instead of raw driver errors or connection
  strings.

### Final Security/Environment TDD Cycle Evidence

| Correction | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Canonical MongoDB environment resolver | `tests/foundation/mongodb-environment-contract.test.mjs` | ✅ Import failed because `resolveMongoUrl` did not exist | ✅ Pinned runner: 3/3 passed | ✅ Canonical-over-alias, alias/local-development, and production-missing-key paths | ✅ Pure resolver, trimmed inputs, no secret-bearing diagnostics |
| Canonical Render security policy | `tests/foundation/p6-security.test.mjs` | ✅ Baseline policy assertion failed on stale `MONGODB_URI` requirement | ✅ Pinned security suite: 4/4 passed | ✅ Clean policy and forbidden embedded-value regression remain covered | ✅ Validator reports key/rule only; no values are emitted |

### Final Security/Environment Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/mongodb-environment-contract.test.mjs tests/foundation/p6-security.test.mjs tests/foundation/p0-security.test.mjs` — exit 0; 10 passed, 0 failed |
| Standalone policy command | Pinned Node `scripts/security/validate-policy.mjs` — exit 0; no findings |
| Tracked security scan | Pinned `pnpm.cmd security:scan` with the NVM Node directory on `PATH` — exit 0; no findings |
| Root validation | Pinned `pnpm.cmd typecheck` — exit 0, 8/8 tasks; `pnpm.cmd build` — exit 0, 5/5 tasks and 14 web routes; `pnpm.cmd lint` — exit 0, 6/6 tasks, 0 errors and existing warnings only |
| Diff check | `git diff --check` — exit 0; existing line-ending normalization warnings only |
| Runtime harness | N/A by explicit user boundary: no API, MongoDB, PostgreSQL, provider, browser/device, Docker, cloud, deployment, migration, seed, write, or long-lived service runtime was started |
| Rollback boundary | Revert only `scripts/security/validate-policy.mjs`, `apps/api/src/infrastructure/database/mongodb/connection.ts`, its focused test, the four Mongo/deployment documentation updates, the API config README, `tasks.md`, and this evidence section; preserve all unrelated changes and `Goldenrepo-js_py` exclusion |

### Final Security/Environment Result Fields

- `status`: `success` for the bounded deterministic security/environment correction; launch remains `NO-GO` and `liveConformance: false`.
- `executive_summary`: The stale `MONGODB_URI` policy requirement now matches the canonical `MONGODB_URL` Render contract, while the proven API compatibility alias remains supported and production configuration fails closed.
- `tasks_completed`: All 14 cumulative implementation tasks plus scoped remediation `R1` are checked.
- `tests`: Mongo resolver 3/3; security umbrella 10/10; standalone policy and tracked security scan pass; root typecheck 8/8; build 5/5; lint 6/6 with warnings only; diff check pass.
- `database_effects`: None. No connection, read, write, migration, DDL, seed, backup, restore, rollback, or schema operation occurred.
- `provider_effects`: None. No provider request, credential, webhook, cloud, deployment, browser, or device operation occurred.
- `risks`: Live database durability, provider, browser/device, deployment, worker, backup/restore, DNS/TLS, legal/tax, and production evidence remain external-blocked; the compatibility alias remains until its active resolver consumer is intentionally migrated.
- `next_recommended`: `sdd-verify` against this merged remediation evidence; retain `NO-GO` and `liveConformance: false`.
- `skill_resolution`: Strict TDD; requested `sdd-apply`, `_shared`, and `typescript` skills loaded via exact paths. `.codegraph/` existed but the upstream CLI was unavailable, so bounded fallback inspection followed the availability check. No delegation or authorization pause occurred.
- `cleanup_state`: Complete. No long-lived process or external resource was started; no secret values were read or emitted; generated build/typecheck cache state is local tooling output.

## Scoped Deterministic Contract Assertion Correction

- Corrected `tests/foundation/p0-native-boundaries.test.mjs` to assert the current
  repository-root native wrappers (`node scripts/dev/native-profile.mjs api|web`)
  instead of restoring the removed `cd backend/frontend && pnpm run dev` text.
  The PostgreSQL-required readiness, disabled dependency, rollback-ordering, and
  no-secret safety assertions remain unchanged.
- Corrected `tests/foundation/tus-product-hardening.test.mjs` to assert the
  platform-aware Next contract (`undefined` on Windows and `standalone` on
  non-Windows production), preserving the Linux/Render standalone behavior.
- No implementation task was added or reopened; cumulative tasks remain 14/14
  plus scoped remediation R1, and `Goldenrepo-js_py` remains excluded.

### Scoped Correction TDD Cycle Evidence

| Correction | RED | GREEN | REFACTOR |
|---|---|---|---|
| Native wrapper documentation assertion | Baseline focused run failed because the runbook no longer contains the removed legacy `cd backend/frontend && pnpm run dev` commands | Pinned runner passed `p0-native-boundaries`: 2/2 | Assertions now follow the authoritative root wrapper commands while preserving all existing safety-boundary checks |
| Platform-aware Next standalone assertion | Baseline focused run failed because the assertion required a literal `output: 'standalone'` | Pinned runner passed `tus-product-hardening`: 19/19; Phase 12 contract: 9/9 | Assertion accepts only the existing Windows conditional with the non-Windows `standalone` branch; Linux/Render documentation and strict build flags remain covered |

### Scoped Correction Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p0-native-boundaries.test.mjs tests/foundation/tus-product-hardening.test.mjs tests/foundation/p12-deployment-operations.test.mjs` — exit 0; 2 + 19 + 9 = 30 passed, 0 failed |
| Root build/typecheck/lint | Pinned `pnpm.cmd build` — exit 0, 5/5 tasks; `pnpm.cmd typecheck` — exit 0, 8/8 tasks; `pnpm.cmd lint` — exit 0, 6/6 tasks, 0 errors and existing warnings only |
| Policy/security/diff checks | `pnpm.cmd exec node scripts/security/validate-policy.mjs` — exit 0; `pnpm.cmd security:scan` — exit 0, no findings; `git diff --check` — exit 0 with existing line-ending warnings |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: only deterministic source-contract tests and local validation ran; no API, database, provider, browser/device, Docker, cloud, deployment, migration, seed, or long-lived service runtime was started |
| Rollback boundary | Revert only the two assertion updates and this scoped evidence section; preserve the current native wrapper safety boundary, Linux/Render standalone contract, all prior phase work, external NO-GO evidence, and `Goldenrepo-js_py` exclusion |

### Scoped Correction Result Fields

- `status`: `success` for the bounded deterministic correction; launch remains `NO-GO` and `liveConformance: false`.
- `executive_summary`: Both stale assertions now match current authoritative contracts without restoring removed documentation or weakening Linux/Render production behavior.
- `tasks_completed`: All 14 cumulative implementation tasks plus scoped remediation R1 remain checked; no phase task changed.
- `tests`: Focused correction 30/30; root build 5/5; typecheck 8/8; lint 6/6 with warnings; policy/security/diff checks pass.
- `database_effects`: None. No database connection, read, write, migration, DDL, seed, backup, restore, or schema operation occurred.
- `provider_effects`: None. No provider, credential, webhook, cloud, deployment, browser, device, or Docker operation occurred.
- `risks`: External database, provider, browser/device, deployment, legal/tax, backup/restore, and production evidence remain blocked; deterministic success does not change `liveConformance=false`.
- `next_recommended`: `sdd-verify` against this correction evidence; retain external NO-GO evidence and the sibling exclusion.
- `skill_resolution`: Strict TDD; requested `sdd-apply`, `_shared`, `typescript`, and `nextjs-15` paths loaded. `.codegraph/` existed but upstream CodeGraph was unavailable, so bounded fallback inspection followed the availability check.
- `cleanup_state`: Complete. No long-lived process or external resource was started; no secrets were exposed; generated build/typecheck cache state is local tooling output.

## Dedicated Database Backup Evidence Pass

- `status`: `blocked`
- `executive_summary`: The authorized development backup pass used only the repository-root `.env` `DATABASE_URL` with `NODE_ENV=development` and explicit development confirmation. Both bounded custom-format `pg_dump` attempts failed; no valid dump or backup handle was produced.
- `backup_tool`: The requested `...\postgresql-client-16.2\bin\pg_dump.exe` and `...\bin\pg_restore.exe` paths were absent. The installed user-local executables at `...\postgresql-client-16.2\pg_dump.exe` and `...\pg_restore.exe` were used; no substitute tool was used.
- `backup_handle_redacted`: `null`; no successful file exists to preserve.
- `connection_attempts`: `2` total bounded attempts, 60,000 ms each, exactly one retry; no third attempt.
- `backup_verification`: `blocked`; both attempts produced no nonzero dump, so `pg_restore --format=custom --list` was not run; dump contents were not read or returned.
- `database_effects`: two backup/connection attempts; zero writes, DDL, DML, deletes, migrations, seeds, provider calls, or deployment effects.
- `cleanup_state`: Complete; each run-owned partial path was removed, no run-owned helper processes remain, and no prior backup was deleted.
- `risks`: The additive PostgreSQL migration remains blocked until a verified restorable custom-format backup is available. Failure diagnostics were not retained because they could contain connection details.
- `next_recommended`: Correct the installed-tool path contract and run a new bounded development backup pass; only after `pg_restore --format=custom --list` succeeds may the dump handle be passed to the additive migration phase.
- `skill_resolution`: Requested `sdd-apply`, `_shared`, and `work-unit-commits` skill paths loaded; Strict TDD was active for the change, but no source-code RED test applied to this external backup-only work unit. `.codegraph` existed and the upstream CLI was unavailable.

### Database Backup Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | N/A — this was an external backup-only evidence pass with no source-code task; tool availability was checked and the installed executables reported PostgreSQL 16.2. |
| Runtime harness command/scenario and exact result | Two bounded `pg_dump` custom-format attempts against the authorized development target; both failed, each bounded at 60 seconds; no `pg_restore` list/format check was possible. |
| Rollback boundary | Revert only `database-backup-evidence.md` and this appended evidence section; preserve all prior implementation, tasks, migration files, and unrelated working-tree changes. |

## Correct-Path Database Backup Retry

- `status`: `blocked`
- `executive_summary`: The retry was bounded to the user-supplied exact PostgreSQL paths. Both exact `bin` paths were verified absent in the current filesystem, so no substitute package-root executable was invoked and no PostgreSQL connection was opened.
- `backup_tool`: Required paths only: `C:\Users\mmmau\AppData\Local\Temp\opencode\postgresql-client-16.2\bin\pg_dump.exe` and `C:\Users\mmmau\AppData\Local\Temp\opencode\postgresql-client-16.2\bin\pg_restore.exe`; both unavailable.
- `backup_handle_redacted`: `null`
- `connection_attempts`: `0`; the one-retry rule was not entered because the required tool precondition failed before connection startup.
- `backup_verification`: `not-run`; no custom-format dump existed for nonzero-size or `pg_restore --format=custom --list`/format verification.
- `database_effects`: none; no connection, backup, read, write, DDL, DML, migration, seed, provider, service, browser, Docker, or deployment operation occurred.
- `cleanup_state`: complete; no output file or helper process was created by this retry, and the prior failed attempt was preserved.
- `risks`: A verified restorable development backup is still unavailable. Do not proceed to additive DDL/migration.
- `next_recommended`: Re-run only after the exact supplied `bin` executables are present; preserve a redacted dump handle only after successful `pg_restore --format=custom --list`/format verification.

### Correct-Path Retry Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | N/A — external backup-only pass; exact tool-path availability preflight blocked before any source-code or database command. |
| Runtime harness command/scenario and exact result | N/A — no backup connection attempt was possible because both required exact executable paths were absent; no substitute path was invoked. |
| Rollback boundary | Revert only the current retry sections in `database-backup-evidence.md` and this file; preserve the prior failed attempt, all implementation tasks, migration files, and unrelated changes. |

## Dedicated Database Backup Pass — Successful

- `status`: `success`
- `executive_summary`: Created and preserved a nonzero custom-format development PostgreSQL backup using only the repository-root `.env` `DATABASE_URL`, `NODE_ENV=development`, and explicit development confirmation. Structural restore verification passed with `pg_restore --format=custom --list`.
- `backup_tool`: Supplied exact paths `C:\Users\mmmau\Tools\postgresql-client-16.2\bin\pg_dump.exe` and `C:\Users\mmmau\Tools\postgresql-client-16.2\bin\pg_restore.exe`; both reported PostgreSQL 16.2.
- `backup_handle_redacted`: `file:tus-argentina-market-launch-backup.dump`
- `output_path`: `C:\Users\mmmau\AppData\Local\Temp\opencode\tus-argentina-market-launch-backup.dump`
- `connection_attempts`: `1`; 60,000 ms bound; one retry allowed but unused; no third attempt.
- `backup_verification`: passed; `pg_dump` exit 0, nonzero file, `pg_restore --format=custom --list` exit 0; archive contents were not read or returned.
- `database_effects`: one read-only backup connection/attempt; zero writes, DDL, DML, migrations, seeds, provider calls, or deployment effects.
- `cleanup_state`: complete; verified dump intentionally preserved, no run-owned helper process remains, no unrelated file was removed.
- `risks`: A full restore rehearsal was not performed in this backup-only pass; the archive is structurally verified and must remain the required backup handle for the authorized additive migration phase.
- `next_recommended`: Proceed to the separately authorized additive migration phase using the preserved backup handle, while retaining all destructive-operation blocks.
- `skill_resolution`: Requested `sdd-apply`, `_shared`, and `work-unit-commits` paths loaded; Strict TDD active, with no applicable source-code RED test for this external backup-only unit.

### Successful Database Backup Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | N/A — external backup-only unit; PostgreSQL client version checks passed (16.2), and archive verification passed. |
| Runtime harness command/scenario and exact result | One bounded exact-path `pg_dump` attempt; exit 0 and nonzero custom-format output; exact-path `pg_restore --format=custom --list`; exit 0. |
| Rollback boundary | Remove only the successful backup evidence sections from these two allowed evidence files; preserve the dump at its approved external path and all prior implementation/evidence work. |

## Target-Specific Additive Repair Attempt — Blocked at Preflight

- `status`: `blocked`
- `executive_summary`: The preserved custom-format backup and selected launch SQL gate passed, then the authorized development connection reached aggregate preflight. Preflight stopped before DDL because the existing target contains a monetary column with an incompatible non-exact type.
- `backup_state`: passed; the preserved handle `file:tus-argentina-market-launch-backup.dump` was checked for existence/nonzero size and passed `pg_restore --format=custom --list` before the connection.
- `sql_gate`: passed; one selected additive launch SQL file, 124 statements scanned, zero destructive statements, zero ambiguous statements, and zero non-additive statements.
- `connection_attempts`: one successful 60,000 ms-bounded connection; retry allowance was one and unused; no third attempt.
- `migration_result`: not-started; zero DDL, zero DML, zero historical migration invocations, and zero ledger mutations.
- `schema_verification`: not-run because preflight failed before the additive transaction.
- `database_effects`: one aggregate catalog preflight read, zero writes/deletes, zero provider calls, and zero row data emitted or persisted.
- `blocker`: exact redacted reason `exact-money-type-mismatch`; the approved exact-money planner still requires an explicit approval identifier before any additive conversion/backfill.
- `cleanup_state`: verified; the pool was closed and no owned helper/service/API/browser/Docker/provider process was started.

### Target-Specific Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | Pinned Node runner `scripts/test-runner.mjs tests/integration/tus/migration-repair.test.mjs`; exit 0, 17 passed, 0 failed, after the new default backup-file/`pg_restore --list` contract. |
| Runtime harness command/scenario and exact result | `NODE_ENV=development` pinned Node CLI with explicit `--confirm-development-target` and the preserved backup path; backup structural check passed, one DB connection/preflight ran, exact-money preflight blocked before DDL, pool cleanup verified. |
| Rollback boundary | Revert only the default backup verification helper in `scripts/tus-migration-repair-lib.mjs`, its focused test addition, and this evidence section; preserve the verified external backup, historical migrations, and unrelated working-tree changes. |

### Target-Specific TDD Cycle Evidence

| Change | Test file | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| Default backup archive gate | `tests/integration/tus/migration-repair.test.mjs` | 16/16 passed | Import failed because the new helper was absent | 17/17 passed | Existing injected backup contract plus nonzero archive/`pg_restore --list` path | Shared bounded helper, ignored output, and redacted failure reasons |

The focused change is not marked complete in the focused task artifact: task
`3.2` remains pending because exact-money preflight failed before DDL, and task
`3.3` remains pending because schema proof did not run and the user boundary
prohibits API/POS runtime execution in this phase.

## Latest Full Launch Migration Retry After Exact-Money Reconciliation

- The preserved custom-format backup was rechecked before any DDL: nonzero
  size and `pg_restore --format=custom --list` exit `0`; the handle remains
  outside the repository and is recorded only in redacted form.
- The selected launch baseline was scanned alone: `125` statements,
  `0` destructive, `0` ambiguous, `0` unsafe-alter, and exact-money SQL gate
  `passed`. Historical migrations remained inventory-only.
- The CLI ran with process `NODE_ENV=development`, the exact
  `--confirm-development-target` flag, and only the repository-root `.env`
  `DATABASE_URL`. One bounded connection attempt succeeded; no retry was
  needed and no third attempt occurred.
- Aggregate preflight stopped with the exact redacted reason
  `exact-money-type-mismatch`, before DDL. The static exact-money correction
  is green, but the target still has an incompatible existing monetary column;
  an approved lossless conversion/backfill identifier is not present.
- Migration result is `not-started`: `0` DDL, `0` DML, `0` historical
  migration invocations, `0` ledger mutations, `0` deletes, and `0` provider
  calls. Schema verification and durable POS remain deferred.
- Cleanup is verified: the pool closed and no API, POS, provider, browser,
  mobile, Docker, deployment, worker, or seed runtime was started.

### Latest Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `C:\\Users\\mmmau\\AppData\\Local\\nvm\\v22.22.2\\node.exe scripts/test-runner.mjs tests/integration/tus/migration-repair.test.mjs` — exit `0`; `18` passed, `0` failed, `0` skipped. |
| Runtime harness command/scenario and exact result | `NODE_ENV=development` plus `apply --confirm-development-target --backup-id <redacted-preserved-file>` — exit `1`; backup and selected-SQL gates passed, one connection/preflight ran, `exact-money-type-mismatch` stopped before DDL, pool closed. |
| Rollback boundary | No database rollback is needed because DDL did not begin. Revert only this appended evidence section if required; preserve the backup handle and prior implementation/evidence. |

### Latest Status

- Tasks `3.2` and `3.3` remain unchecked. The exact-money static contract is
  reconciled, but the live target-specific type mismatch is still a blocker.
- Next action is an explicitly approved, lossless target conversion/backfill
  plan followed by a fresh bounded retry; do not use historical migrations,
  reset, `db push`, seed rerun, truncate, cascade, or untagged deletes.

## Focused Corrective Slice: P7/P8 Local Contracts

- Corrected the web ESM imports of `api-url.ts` in `api-client.ts`,
  `tus-client.ts`, and `tus-auth-client.ts`. The explicit `.ts` specifiers are
  required by the repository's Node 22 strip-types test loader; the web
  TypeScript project now permits those specifiers through
  `allowImportingTsExtensions`.
- Reconciled the P8 deployment assertion with the existing cross-platform
  contract: Windows local builds keep `output` disabled to avoid pnpm symlink
  privilege failures, while non-Windows production builds retain
  `output: 'standalone'` for Render/Vercel deployment.
- Updated only the P7 test setup where the current fail-closed contracts were
  already explicit: provider webhook actions are enabled for the invalid-
  signature branch, and the web transport receives a synthetic local API URL.
  No production provider or network behavior was enabled by these test
  fixtures.

### Focused Corrective TDD Cycle Evidence

| Correction | Test file | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| Extensionless `api-url` ESM imports | `tests/foundation/p7-tus-marketplace-operations.test.mjs` | ✅ Baseline failed during module resolution | ✅ Existing P7 regression failed on extensionless `api-url` import | ✅ P7 passed 22/22 | ✅ Web client, auth client, and API client all use explicit TypeScript specifiers; web typecheck passed | ✅ Added the minimum compiler option required by TypeScript; no URL semantics changed |
| Windows/Render standalone deployment contract | `tests/foundation/p8-tus-deployment.test.mjs` | ✅ Baseline failed on the stale literal `standalone` assertion | ✅ P8 passed 8/8 | ✅ Conditional Windows/non-Windows output and existing Render start/docs checks remain covered | ✅ Assertion now verifies the public platform-conditioned contract |

### Focused Corrective Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `C:\\Users\\mmmau\\AppData\\Local\\nvm\\v22.22.2\\pnpm.cmd test -- tests/foundation/p7-tus-marketplace-operations.test.mjs tests/foundation/p8-tus-deployment.test.mjs` — exit `0`; P7 `22/22` and P8 `8/8` passed, `0` failed, `0` skipped. |
| Relevant typecheck | `pnpm.cmd --filter @factory/web typecheck` — exit `0`. |
| Relevant lint | `pnpm.cmd --filter @factory/web lint` — exit `0`; existing warnings only, no errors. |
| Static diff check | `git diff --check` — exit `0`; existing CRLF normalization warnings only. |
| Runtime harness command/scenario and exact result | N/A by explicit user boundary: no API service, database, provider, browser, Docker, cloud, deployment, or external runtime was started or contacted; only deterministic local tests and web static checks ran. |
| Rollback boundary | Revert only `apps/web/src/lib/{api-client.ts,tus-auth-client.ts,tus-client.ts}`, `apps/web/tsconfig.json`, and the P7/P8 test assertion/setup changes. Preserve all prior launch phases, external-blocked evidence, and `Goldenrepo-js_py` exclusion. |

### Focused Corrective Result Fields

- `status`: `success` for this bounded deterministic correction; launch remains
  `NO-GO` and `liveConformance: false`.
- `executive_summary`: P7 now resolves the web API URL module under the pinned
  Node ESM loader and P8 verifies the intended Windows-safe/Linux-standalone
  deployment contract without changing live deployment configuration.
- `tasks_completed`: All cumulative implementation tasks plus R1 remain
  checked; this corrective slice adds no new phase task.
- `tests`: P7 `22/22`; P8 `8/8`; web typecheck passed; web lint passed with
  existing warnings only; `git diff --check` passed.
- `database_effects`: None.
- `provider_effects`: None.
- `risks`: Live PostgreSQL, provider, browser/device, worker, cloud,
  deployment, backup/restore, DNS/TLS, legal/tax, and production evidence
  remain external-blocked. Windows standalone output remains intentionally
  disabled locally; Render/Linux standalone behavior remains static-contract
  only and is not live verification.
- `next_recommended`: `sdd-verify` against this corrective evidence; retain
  `liveConformance: false`.
- `skill_resolution`: Strict TDD active; requested `sdd-apply`, `_shared`,
  `typescript`, and `work-unit-commits` skills loaded. `.codegraph/` existed;
  CodeGraph exploration was attempted and bounded fallback inspection was
  used for the exact files. No review command or new review transaction was
  created.
- `cleanup_state`: Complete. No runtime process or external resource was
  started; no secret values were read or emitted.
