# Durable POS Evidence: TUS Argentina Market Launch

## Scope

Phase 5 implements deterministic POS domain, API-route, and mobile-queue behavior only. No PostgreSQL connection, migration, seed, provider, printer, browser, mobile device, Docker, or deployment execution was performed. Existing database and backend blocks remain authoritative.

## Implemented Boundaries

- Device registration is tenant-owned; revoked devices and closed shifts fail closed. Session opening creates a cash shift with an opening float, and closeout records expected/count/variance reconciliation.
- Product and service sales keep separate contexts, validate positive safe integer minor units, preserve line and operation snapshots, and update cash totals for cash sales.
- Same-key replay returns the original response without duplicate operation, receipt, audit, outbox, or version effects. Serialized in-memory transactions and durable adapter version predicates provide the deterministic fencing boundary.
- Refunds and cancellations are linked compensating records; original operations and receipts remain unchanged. Refunds require a manager/admin role or explicit POS refund permission.
- Printer failures create retryable recovery records and outbox evidence. Outbox claim acknowledgement requires the exact claim fence. Operation status is read-only and never resubmits a sale.
- Mobile reconnect replays the original payload and stable idempotency key. Revoked-device conflicts are quarantined and removed from replay; status queries report the quarantine state without transport submission.
- Authenticated routes expose operation status, refunds, cancellations, printer recovery, device/session lifecycle, and existing conflict resolution without trusting client tenant/actor authority.

## TDD Cycle Evidence

| Task | Test file | Layer | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 5.1 | `tests/integration/tus/pos-durability.test.mjs` | deterministic integration | ✅ New tests failed on missing shift/status/refund/printer APIs and mobile runtime path | ✅ Pinned Node runner: 6/6 passed | ✅ Cash closeout; same-key concurrency; compensation immutability; validation/auth; printer fencing; revoked offline quarantine/status | ✅ Focused suite passed after status/quarantine/router cleanup |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/pos-durability.test.mjs`; exit 0, 6 passed, 0 failed. `pnpm --filter @factory/mobile exec jest tests/unit/tus-pos.test.ts --runInBand`; exit 0, 23 passed, 0 failed. |
| Runtime harness command/scenario and exact result | N/A for this apply slice: only deterministic in-memory and mobile queue harnesses were executed. API server, PostgreSQL, provider, printer, browser, device, Docker, and deployment runtime were explicitly not started. |
| Rollback boundary | Revert `apps/api/src/tus/pos/index.ts`, POS route additions in `apps/api/src/tus/http/router.ts`, `apps/mobile/src/application/tus-client.ts`, and `tests/integration/tus/pos-durability.test.mjs`; preserve prior phases and unrelated changes. |

## Static / External Evidence

- API TypeScript check remains blocked by pre-existing `@factory/errors` resolution errors in `apps/api/src/presentation/middleware/{error,logger}.ts`; the POS files introduced no additional typecheck errors.
- `git diff --check` passed; only existing LF/CRLF normalization warnings remain.
- CodeGraph was not available as a CLI despite an existing `.codegraph/` directory; fallback source review was limited to the affected POS ports, adapter, router, mobile queue, contracts, and tests.
- No live or production claims are made. Database, backup/restore, schema compatibility, printer hardware, payment/provider, browser/mobile device, and deployment evidence remain external-blocked.
