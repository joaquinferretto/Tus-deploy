# Billing Evidence: TUS Argentina Market Launch

## Scope

Phase 9.1 covers the deterministic billing domain and persistence boundary only. The implementation is ARS-only, tenant-scoped, append-only for invoices/credits/refunds/ledger history, and fail-closed when tax, accounting, or provider evidence is absent.

## TDD Cycle Evidence

| Task | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| 9.1 | `tests/foundation/p9-billing.test.mjs` | ✅ Initial run failed because `apps/api/src/tus/billing/index.ts` was missing | ✅ Pinned Node runner: 7/7 passed | ✅ Tenant ownership, subscription cancellation/dunning, tax approval/numbering, immutable snapshots, credit/refund compensation, idempotency/audit/outbox, accounting gate, ARS/BigInt validation, Prisma BigInt/date mapping | ✅ Fixed undefined `issuedAt` date conversion, changed the store boundary to async for Prisma compatibility, added additive schema/migration shape and append-only triggers |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p9-billing.test.mjs`; exit 0, 7 passed, 0 failed. |
| Migration safety command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/migration-repair.test.mjs`; exit 0, 14 passed, 0 failed. `prisma validate` also passed. |
| Runtime harness command/scenario and exact result | N/A by explicit execution boundary: no API server, PostgreSQL, migration, seed, provider, browser, Docker, or credentials were used. Deterministic in-memory and Prisma-delegate fakes only. |
| Rollback boundary | Revert `apps/api/src/tus/billing/index.ts`, `apps/api/src/tus/billing/prisma.ts`, billing additions in `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260909170000_tus_billing/migration.sql`, `scripts/tus-migration-repair-lib.mjs`, `tests/foundation/p9-billing.test.mjs`, the migration inventory count update, and this evidence file; preserve Phases 0–8 and unrelated working-tree changes. |

## Implemented Boundaries

- `BillingStore` is asynchronous so the in-memory and Prisma implementations share one contract.
- All persisted billing money uses ARS minor-unit `bigint`/PostgreSQL `BIGINT`; unsupported currencies and non-BigInt values fail closed.
- Invoice, credit-note, refund, and billing-ledger rows are append-only at the database boundary through immutable triggers.
- Invoice numbering occurs only during approved issuance; tax snapshots carry explicit external approval references without claiming tax compliance.
- Accounting export remains blocked without an explicit external approval reference; recurring provider execution remains disabled/fail-closed.
- The migration is additive and uses no `DROP`, `TRUNCATE`, or destructive data rewrite.

## External Evidence Limits

No live PostgreSQL, ARCA/AFIP, Mercado Pago, accounting, provider, legal, tax, KYC/KYB, or deployment evidence was produced. These remain verification-stage/external-blocked classes.

## Recovery Pass: Phase 9.1 Billing Boundaries

The existing Phase 9.1 implementation and evidence were re-read against the proposal, design, billing specifications, tasks, Prisma schema/migration, current diff, and prior Engram progress. Only bounded billing corrections were applied; Phases 0–8 and `Goldenrepo-js_py` remain untouched/excluded.

### Recovery TDD Cycle Evidence

| Correction | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Tenant-owned invoice account | `tests/foundation/p9-billing.test.mjs` | ✅ Cross-tenant account accepted | ✅ 12/12 focused tests passed | ✅ Existing tenant account denial plus explicit invoice account path | ✅ Not-found response reveals no cross-tenant existence |
| Invoice/payment/order/POS linkage | `tests/foundation/p9-billing.test.mjs` | ✅ Compensation accepted mismatched payment/order | ✅ 12/12 focused tests passed | ✅ Both refund and credit mismatch paths rejected | ✅ Shared compensation guard |
| Immutable tax snapshot and exact ARS boundary | `tests/foundation/p9-billing.test.mjs` | ✅ Tax approval metadata could be rewritten; malformed currency crashed | ✅ 12/12 focused tests passed | ✅ Issued total/tax snapshot and malformed/unsupported currency cases | ✅ Evidence reference is separate from external approval |
| Prisma invoice persistence/issuance | `tests/foundation/p9-billing.test.mjs` | ✅ Legacy BigInt columns were omitted; issuance attempted duplicate create | ✅ 12/12 focused tests passed | ✅ Draft-to-issued update and legacy exact-money mappings | ✅ Removed explicit `any` row boundary in favor of unknown-safe helpers |
| Append-only database controls | `tests/foundation/p9-billing.test.mjs` | ✅ Invoice lines and control records lacked migration fences | ✅ 12/12 focused tests passed | ✅ Invoice, line, ledger, credit, refund, audit, idempotency, and accounting trigger assertions | ✅ Outbox event identity/payload stays immutable while worker state remains operational |

### Recovery Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/foundation/p9-billing.test.mjs`; exit 0, 12 passed, 0 failed. |
| Migration safety command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/migration-repair.test.mjs`; exit 0, 14 passed, 0 failed. `prisma validate --schema apps/api/prisma/schema.prisma`; passed. |
| Static checks | `git diff --check`; passed. API `tsc --noEmit` remains blocked only by pre-existing `@factory/errors` resolution and unrelated Phase 8 delivery type errors; no billing-specific errors remain. |
| Runtime harness command/scenario and exact result | N/A by explicit boundary: no server, database, migration, seed, provider, browser, Docker, deployment, or credentials used; deterministic in-memory/Prisma-delegate fakes only. |
| Rollback boundary | Revert only the recovery assertions in `tests/foundation/p9-billing.test.mjs`, billing corrections in `apps/api/src/tus/billing/{index.ts,prisma.ts}`, and billing migration trigger/mapping changes in `apps/api/prisma/migrations/20260909170000_tus_billing/migration.sql`; preserve prior Phase 9 and Phases 0–8. |

### Recovery Limits

- Tax/IVA/ARCA/AFIP authority, accounting interpretation, provider/payment linkage, legal approval, and production compliance remain external gates; no compliance claim was invented.
- No PostgreSQL, provider, accounting, or deployment effects occurred. The additive migration remains pending the existing backup/restore and database execution gates.
