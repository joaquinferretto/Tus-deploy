# Mercado Pago Payment Evidence: TUS Argentina Market Launch

## Scope

Phase 6 implements deterministic payment, webhook, reconciliation, and five-day settlement boundaries. It does not claim Mercado Pago sandbox or production conformance.

## Implemented Boundaries

- Payment intents are correlated to the tenant-owned commitment/order and optional POS operation. The record explicitly identifies TUS as the intermediary merchant-of-record boundary for the configured five-day policy; this is not a custody, legal, tax, KYC/KYB, payout, or provider-approval claim.
- Exact monetary inputs are non-negative safe minor units at the TypeScript boundary, with `Money { currency, minor: bigint }` validation and BigInt basis-point calculations. Persistent Prisma fields remain BIGINT in the additive launch shape.
- Provider state is separate from commercial settlement state. Pending, approved, rejected, expired, cancelled, refunded, provider-error, and charged-back outcomes cannot silently become commercial completion.
- Webhooks use the Mercado Pago manifest shape, constant-time HMAC comparison, five-minute freshness, tenant/payment/reference checks, event idempotency, and provider-event timestamps to ignore stale out-of-order regressions.
- Refunds are append-only compensations with cumulative remaining-amount checks. Full refunds and chargebacks freeze or close release; reconciliation mismatches quarantine and append a linked recovery entry without rewriting the original ledger.
- Provider retries are bounded. Timeout/unavailable exhaustion freezes the payment with a redacted diagnostic code. Provider-disabled mode holds intake and makes no provider call.
- Optional five-day enforcement holds release until `releaseAt`; release still requires completion evidence, confirmation/approved policy, and no active freeze. The production composition remains unavailable until readiness evidence passes.

## TDD Cycle Evidence

| Task | Test file | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| 6.1 | `tests/integration/tus/finance-webhook.test.mjs` | ✅ Missing finance money, policy, webhook, transition, refund, and retry behavior failed | ✅ 5/5 passed with pinned Node runner | ✅ Five-day gate, signed/fresh/replayed/out-of-order events, terminal states, compensation, mismatch quarantine, retry, disabled provider | ✅ 5/5 after boundary and persistence cleanup |

### Recovery corrections

The recovery pass found and corrected two narrow implementation gaps before re-marking the slice complete:

- The finance-domain HMAC verifier now requires the signature `ts=` field to equal the event timestamp; a valid HMAC with a mismatched signed timestamp is rejected.
- The Prisma finance adapter now converts `releaseAt` and nullable `providerEventAt` to `Date` values before writing `DateTime` columns.

Both corrections followed RED/GREEN evidence in the same focused file:

| Correction | RED | GREEN | REFACTOR |
|---|---|---|---|
| Signed timestamp binding | ✅ Mismatched `ts=` was processed | ✅ 7/7 focused tests passed | ✅ Existing freshness/replay/order tests stayed green |
| Prisma DateTime boundary | ✅ Number values caused row conversion failure | ✅ 7/7 focused tests passed | ✅ Nullable event timestamp preserved |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused tests | `C:\Users\mmmau\AppData\Local\nvm\v22.22.2\node.exe scripts/test-runner.mjs tests/integration/tus/finance-webhook.test.mjs`; exit 0; 7 passed, 0 failed. `tests/foundation/p9-finance.test.mjs`; exit 0; 7 passed, 0 failed. |
| Runtime harness | N/A: the user explicitly prohibited starting services, databases, browsers, Docker, deployment, or Mercado Pago requests. Deterministic in-memory and Prisma persistence-boundary fakes ran only. |
| Rollback boundary | Revert the Phase 6 finance domain/persistence/router/schema/migration/test files listed in apply-progress; preserve earlier commerce/POS work. |

## Provider / Database Effects

- Provider effects: none. No credentials or live/sandbox provider evidence were accessed; no funds claim is authorized.
- Database effects: none. No PostgreSQL connection, DDL, migration, seed, backup, restore, or write was performed.
- Evidence classes: `deterministic`, `external-blocked`; not `provider` or `real-PostgreSQL`.

## Remaining Gates

- Mercado Pago intermediary agreement, Argentine legal/tax treatment, KYC/KYB, custody/segregation, payout authority, and exact five-day policy approval remain external gates.
- Sandbox smoke for payment creation, signed webhooks, refunds, chargebacks, reconciliation, and release must be run later with existing safe credentials and redacted receipts.
- PostgreSQL additive migration requires the existing target, schema, and restorable-backup gates.

## Recovery Validation Limits

- `tests/foundation/p8-tus-finance.test.mjs` remains 7/8: its authenticated HTTP smoke cannot start because the pre-existing `@factory/errors` workspace module is unresolved. The seven deterministic finance assertions pass.
- The `@repo/mercado-pago` package test could not run because its nested `pnpm run build` cannot find pnpm and package-local dependencies are absent. Repository `node` and `pnpm` are absent from PATH; the pinned absolute Node runner was used for the passing finance suites.
- Recovery produced no provider or database effects. No live/sandbox Mercado Pago call, credential, migration, seed, DDL, or PostgreSQL write occurred.
