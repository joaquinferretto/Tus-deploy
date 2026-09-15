# Exact Money Evidence: TUS Argentina Market Launch

## Contract

- Internal monetary values use `{ currency, minor: bigint }`.
- Persisted monetary columns use PostgreSQL `BIGINT`; rates use integer basis points.
- JSON boundaries serialize minor units as decimal strings and deserialize only canonical integer strings.
- Currency codes are normalized to uppercase three-letter ISO-4217 codes.
- Currency scale is explicit; ARS, USD, and EUR currently use scale 2 in the shared contract helper.
- The finance persistence boundary validates unknown row fields and rejects unsafe BigInt-to-number conversion; the broader finance domain remains safe-integer-number based for compatibility.

## Static Implementation Evidence

| Area | Result |
|---|---|
| Prisma schema | No monetary `Float` fields remain in the checked schema |
| Launch migration | Monetary columns are `BIGINT`; commission rate is integer `rateBps` |
| Repair migration | POS `amount` columns changed from `DOUBLE PRECISION` to `BIGINT` |
| Currency constraints | Additive baselines reject non-uppercase three-letter currency values |
| Backfill safety | Approval identifier, backup/restore verification, development attestation, currency validation, fractional-precision rejection, and signed-64-bit overflow checks are required |
| JSON boundary | `serializeMoney`, `deserializeMoney`, and bigint-safe JSON stringify helpers are exported from `@factory/contracts` |
| Finance persistence boundary | BigInt-to-number conversion is explicit and rejects values outside the safe integer boundary |
| Historical floats | Not rewritten; they remain blocked inventory until an explicitly approved lossless conversion |

## Verification Boundary

No PostgreSQL connection, migration, DDL, DML, backup, restore, provider call,
or live runtime was performed for this correction. The current database record
contains only `TusHardeningFixture`, so no application monetary rows were
converted.

The finance domain still exposes safe integer numbers for backwards
compatibility; a follow-up structural slice is required to make every runtime
domain contract use `bigint` end-to-end.

The focused migration-repair suite was updated with exact-money SQL and JSON
assertions. The pinned NVM runner executed it successfully: exit 0, 18 passed,
0 failed. The default `node` command remains unavailable on `PATH`.

## Rollback Boundary

Revert only the exact-money contract helpers/exports, migration SQL constraint
and type changes, migration repair safety-gate changes, and the focused
migration-repair assertions. Preserve unrelated working-tree changes.

## Conformance Repair Static Gate: 2026-09-14

```yaml
status: passed
selected_migration: 20260911130000_tus_live_schema_conformance_repair
exact_money_sql: passed
amount_minor_bigint_not_null_no_default: 3
historical_replay: false
destructive_sql: false
untagged_update: false
live_acceptance: not-run_after_isolated_restore_gate
row_values_read: 0
liveConformance: false
noGo: true
```

The static repair gate passed, but the current target was not changed because
isolated restore verification failed before preflight. No billing money column,
default, backfill, or money value was added, inferred, read, or emitted.
