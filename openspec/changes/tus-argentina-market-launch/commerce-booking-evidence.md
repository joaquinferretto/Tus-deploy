# Commerce and Booking Evidence

## Scope

Phases 3 and 4 implement deterministic marketplace/catalog and service-calendar/booking behavior. This slice does not execute PostgreSQL, migrations, seeds, providers, Docker, or long-lived services. The known database gate remains closed.

## Implemented Boundaries

- Merchant ownership is keyed by authenticated tenant while `merchantId` remains a separate merchant identity; listing creation rejects a merchant outside the tenant.
- Product and service listings carry immutable `priceSnapshot` values (`currency` plus `bigint` minor units). Currency is normalized to uppercase ISO-style codes and mismatched decimal/minor inputs are rejected.
- Discovery removes unpublished, stale-policy, unauthorized, and zero-stock product offers. Product reservations use tenant, publication, stock, and availability-version predicates; the serialized in-memory transaction and Prisma conditional update protect the final unit.
- Checkout preserves customer tenant, merchant/listing policy, exact price snapshot, idempotency replay/conflict outcomes, audit records, and marketplace outbox records. Product and service lines remain separate contexts.
- Calendars enforce merchant/operator roles, tenant authority, IANA timezone, working-hour intervals, duration, buffer, capacity, blackout dates, booking cutoff, cancellation windows, and no-show timing.
- Slot generation converts local Argentina wall-clock time to UTC and uses deterministic slot IDs. Booking rechecks the generated slot and capacity inside a serialized transaction; cancellation and no-show transitions increment versions and append audit/outbox records.
- API routes expose authenticated calendar creation, slot discovery, booking, cancellation, and operator no-show commands with bounded errors.
- `PrismaServiceCalendarStore` and the existing Prisma marketplace adapter provide persistence boundaries only; no PostgreSQL proof is claimed.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 | `tests/integration/tus/catalog-booking.test.mjs` | deterministic integration | N/A — no prior catalog-booking file | ✅ Missing calendar import and stale zero-stock expectation failed before implementation | ✅ 6/6 focused tests passed | ✅ tenant split, exact money, zero-stock filtering, race, replay, forbidden access | ✅ focused suite passed after cleanup |
| 4.1 | `tests/integration/tus/catalog-booking.test.mjs` | deterministic integration | N/A — new calendar files | ✅ Missing calendar module, invalid slot date, replay and tenant-role cases failed during cycles | ✅ 6/6 focused tests passed | ✅ timezone, blackout, buffer, capacity race, cutoff, late cancellation, no-show, role and tenant paths | ✅ focused suite passed after validation/idempotency cleanup |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\pnpm.cmd test -- tests/integration/tus/catalog-booking.test.mjs`; exit 0, 6 tests passed, 0 failed. |
| Runtime harness command/scenario and exact result | Same focused deterministic in-memory catalog/calendar scenario; exit 0. No external runtime was started because the task forbids services and database/provider execution. |
| Rollback boundary | Revert `apps/api/src/tus/calendar/`, `apps/api/src/tus/adapters/prisma-calendar.ts`, catalog/Prisma/router/composition/application changes, and `tests/integration/tus/catalog-booking.test.mjs`; preserve Phase 0–2 and unrelated changes. |

## Static and External Evidence

- `git diff --check`: passed.
- API typecheck: blocked by pre-existing `@factory/errors` module resolution errors in Phase 2 middleware; no Phase 3/4 type errors remained after correction.
- Existing backend foundation test: blocked at import by the same pre-existing `@factory/errors` resolution error.
- PostgreSQL, backup/restore, migration, seed, provider, browser/mobile, deployment, and live production evidence: not run and not claimed.

## Known Risks / Follow-up

- The current `TusBooking` Prisma model has one tenant column and does not yet persist a separate customer-tenant/owner-tenant relation; the adapter therefore needs the approved additive schema decision before live booking compatibility can be claimed.
- Prisma calendar reads reconstruct service duration and policy defaults because those fields are not represented in the existing calendar tables; live persistence requires the additive schema contract before activation.
