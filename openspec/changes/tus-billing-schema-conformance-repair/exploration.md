# Exploration: TUS Billing Schema Conformance Repair

status: success
executive_summary: The fresh metadata evidence proves that all ten Prisma billing table objects are absent. The bounded correction is therefore a new forward-only additive unit that creates those ten tables empty, with their exact source-derived columns, primary keys, unique constraints, and indexes. It requires only the present launch and POS markers, selects `20260915160000_tus_billing_schema_conformance_repair` as its own marker, preserves both absent historical markers, and makes no production-readiness claim.
artifacts:
  - `openspec/changes/tus-billing-schema-conformance-repair/exploration.md`
  - Engram topic attempted: `sdd/tus-billing-schema-conformance-repair/explore` (unavailable; not persisted)
next_recommended: `sdd-propose` for the bounded empty-table creation unit, subject to the listed operational prerequisites.
risks:
  - Any partially existing or incompatible billing table is a hard-stop; this unit must never rebuild, alter, or infer its shape.
  - The absent prior conformance marker and historical additive marker must remain absent; lineage must not be fabricated.
  - Metadata/aggregate-only evidence does not establish runtime behavior, data correctness, or production readiness.
skill_resolution: paths-injected — loaded the three exact user-specified paths: `C:\Users\mmmau\.config\opencode\skills\sdd-explore\SKILL.md`, `C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md`, and `C:\Users\mmmau\.config\opencode\skills\typescript\SKILL.md`. CodeGraph was attempted twice after confirming `.codegraph/`, but its database reported a malformed image; targeted filesystem inspection was used as the documented fallback. Engram save was unavailable in this execution surface and is reported as a fallback risk rather than claimed as persisted.

## Current State

The current root `.env` `DATABASE_URL` diagnostic was metadata-only, read no row
values, and performed no writes. It confirmed the following bounded state:

- The launch/POS catalog subset is `62/62` entries present (`58` unique names),
  with all `22` named POS indexes and all `3` POS constraints exact.
- The ten billing tables are absent: `TusBillingAccount`,
  `TusSubscriptionPlan`, `TusBillingRefund`, `TusBillingLedger`,
  `TusBillingIdempotency`, `TusBillingAudit`, `TusBillingOutbox`,
  `TusBillingDunning`, `TusBillingNumberSequence`, and
  `TusAccountingExport`.
- The three failed money declarations are therefore missing table objects, not
  merely missing columns: `TusSubscriptionPlan.amountMinor`,
  `TusBillingRefund.amountMinor`, and `TusBillingLedger.amountMinor`.
- Ten billing primary keys are absent. The launch marker
  `20260909090000_tus_argentina_market_launch` and POS marker
  `20260911120000_tus_pos_index_constraint_repair` are present exactly once.
  The prior conformance marker
  `20260911130000_tus_live_schema_conformance_repair` is absent and is not a
  prerequisite for this correction. The historical
  `20260831180000_tus_additive_migration_repair` marker is also absent and
  remains intentionally unreconstructed.
- The diagnostic used one read-only `REPEATABLE READ` session, read zero row
  values, and made zero schema/data/marker writes. It stopped at
  `missing-money-table`; seed, POS runtime, providers, deployment, and review
  lifecycle were not run.

The prior conformance change was designed for existing billing tables with
missing money columns/primary keys and for fourteen incorrect POS indexes. The
fresh evidence changes the immediate problem: all ten billing table objects must
be created from the source contract. The fourteen index repairs must not be
replayed because the fresh target evidence says the `22` POS indexes are already
exact. The new correction marker supersedes the prior operational gap for this
bounded billing repair, but does not assert that the absent prior marker ever
existed.

## Exact Contract

### Source and physical type rules

The contract is derived from `apps/api/prisma/schema.prisma`, cross-checked
against the historical billing SQL only as a read-only reference. Prisma
PostgreSQL mappings are `String -> TEXT`, `BigInt -> BIGINT`, `Int -> INTEGER`,
`Boolean -> BOOLEAN`, `DateTime -> TIMESTAMP(3)`, `Json -> JSONB`, and
`String[] -> TEXT[]`. A field without `?` is `NOT NULL`; a field without a
Prisma default has no database default. The only defaults in these ten models
are the explicit defaults shown below.

There are no billing enum declarations, no `@db.*` provider-specific types, and
no extension dependency. All ten models have no `@relation`; consequently they
have no source-derived foreign keys, including no database FK from `tenantId`
to `TusTenant`. Textual IDs such as `invoiceId`, `paymentId`, `orderId`, and
`subscriptionId` are application-level references in this source contract.
The existing `TusInvoiceLine -> TusInvoice` composite FK is outside these ten
models and is not a dependency of their creation.

### Table-by-table contract

| Table | Columns (physical type; nullability; default) | Primary key | Foreign keys | Unique/check constraints | Indexes |
|---|---|---|---|---|---|
| `TusBillingAccount` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `billingAccountId TEXT NOT NULL`; `partyId TEXT NOT NULL`; `role TEXT NOT NULL`; `status TEXT NOT NULL`; `createdAt TIMESTAMP(3) NOT NULL`; `updatedAt TIMESTAMP(3) NOT NULL` | `TusBillingAccount_pkey` on `(id)` | None | `TusBillingAccount_tenantId_billingAccountId_key` unique `(tenantId,billingAccountId)`; no checks | `TusBillingAccount_tenantId_partyId_status_idx` non-unique `(tenantId,partyId,status)` |
| `TusSubscriptionPlan` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `planId TEXT NOT NULL`; `name TEXT NOT NULL`; `amountMinor BIGINT NOT NULL`; `currency TEXT NOT NULL`; `interval TEXT NOT NULL`; `status TEXT NOT NULL`; `createdAt TIMESTAMP(3) NOT NULL`; `updatedAt TIMESTAMP(3) NOT NULL` | `TusSubscriptionPlan_pkey` on `(id)` | None | `TusSubscriptionPlan_tenantId_planId_key` unique `(tenantId,planId)`; no checks | `TusSubscriptionPlan_tenantId_status_idx` non-unique `(tenantId,status)` |
| `TusBillingRefund` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `refundId TEXT NOT NULL`; `invoiceId TEXT NOT NULL`; `paymentId TEXT NOT NULL`; `orderId TEXT NOT NULL`; `posOperationId TEXT NULL`; `currency TEXT NOT NULL`; `amountMinor BIGINT NOT NULL`; `reason TEXT NOT NULL`; `status TEXT NOT NULL`; `createdAt TIMESTAMP(3) NOT NULL` | `TusBillingRefund_pkey` on `(id)` | None | `TusBillingRefund_tenantId_refundId_key` unique `(tenantId,refundId)`; no checks | `TusBillingRefund_tenantId_invoiceId_idx` non-unique `(tenantId,invoiceId)` |
| `TusBillingLedger` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `entryId TEXT NOT NULL`; `invoiceId TEXT NOT NULL`; `entryType TEXT NOT NULL`; `amountMinor BIGINT NOT NULL`; `currency TEXT NOT NULL`; `linkedEntryId TEXT NULL`; `creditNoteId TEXT NULL`; `refundId TEXT NULL`; `paymentId TEXT NOT NULL`; `orderId TEXT NOT NULL`; `posOperationId TEXT NULL`; `immutable BOOLEAN NOT NULL DEFAULT TRUE`; `createdAt TIMESTAMP(3) NOT NULL` | `TusBillingLedger_pkey` on `(id)` | None | `TusBillingLedger_tenantId_entryId_key` unique `(tenantId,entryId)`; no checks | `TusBillingLedger_tenantId_invoiceId_createdAt_idx` non-unique `(tenantId,invoiceId,createdAt)` |
| `TusBillingIdempotency` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `key TEXT NOT NULL`; `requestHash TEXT NOT NULL`; `response JSONB NOT NULL`; `createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` | `TusBillingIdempotency_pkey` on `(id)` | None | `TusBillingIdempotency_tenantId_key_key` unique `(tenantId,key)`; no checks | `TusBillingIdempotency_tenantId_createdAt_idx` non-unique `(tenantId,createdAt)` |
| `TusBillingAudit` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `auditId TEXT NOT NULL`; `actorId TEXT NOT NULL`; `correlationId TEXT NOT NULL`; `action TEXT NOT NULL`; `resourceId TEXT NOT NULL`; `outcome TEXT NOT NULL`; `reason TEXT NULL`; `createdAt TIMESTAMP(3) NOT NULL` | `TusBillingAudit_pkey` on `(id)` | None | `TusBillingAudit_tenantId_auditId_key` unique `(tenantId,auditId)`; no checks | `TusBillingAudit_tenantId_correlationId_createdAt_idx` non-unique `(tenantId,correlationId,createdAt)` |
| `TusBillingOutbox` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `eventId TEXT NOT NULL`; `correlationId TEXT NOT NULL`; `eventType TEXT NOT NULL`; `aggregateId TEXT NOT NULL`; `payload JSONB NOT NULL`; `status TEXT NOT NULL`; `attempts INTEGER NOT NULL`; `availableAt TIMESTAMP(3) NOT NULL`; `createdAt TIMESTAMP(3) NOT NULL` | `TusBillingOutbox_pkey` on `(id)` | None | `TusBillingOutbox_tenantId_eventId_key` unique `(tenantId,eventId)`; no checks | `TusBillingOutbox_tenantId_status_availableAt_idx` non-unique `(tenantId,status,availableAt)` |
| `TusBillingDunning` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `dunningId TEXT NOT NULL`; `subscriptionId TEXT NOT NULL`; `attempt INTEGER NOT NULL`; `reason TEXT NOT NULL`; `status TEXT NOT NULL`; `retryAt TIMESTAMP(3) NULL`; `createdAt TIMESTAMP(3) NOT NULL` | `TusBillingDunning_pkey` on `(id)` | None | `TusBillingDunning_tenantId_dunningId_key` unique `(tenantId,dunningId)`; no checks | `TusBillingDunning_tenantId_subscriptionId_createdAt_idx` non-unique `(tenantId,subscriptionId,createdAt)` |
| `TusBillingNumberSequence` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `nextNumber INTEGER NOT NULL` | `TusBillingNumberSequence_pkey` on `(id)` | None | single-column unique `(tenantId)` from Prisma `@unique` (historical SQL expresses it inline as `UNIQUE`); no checks | No secondary index; the single-column unique index is the uniqueness enforcement |
| `TusAccountingExport` | `id TEXT NOT NULL`; `tenantId TEXT NOT NULL`; `exportId TEXT NOT NULL`; `invoiceIds TEXT[] NOT NULL`; `ledgerEntryIds TEXT[] NOT NULL`; `externalApprovalReference TEXT NOT NULL`; `status TEXT NOT NULL`; `postedExternally BOOLEAN NOT NULL DEFAULT FALSE`; `createdAt TIMESTAMP(3) NOT NULL` | `TusAccountingExport_pkey` on `(id)` | None | `TusAccountingExport_tenantId_exportId_key` unique `(tenantId,exportId)`; no checks | `TusAccountingExport_tenantId_createdAt_idx` non-unique `(tenantId,createdAt)` |

The historical migration also contains append-only trigger/function DDL for
some billing tables. Those triggers are not represented by the Prisma model
contract and the historical file is explicitly inventory-only for this change.
They are explicitly deferred to a separate, separately reviewed policy change;
this correction must not replay that migration wholesale or silently add
trigger-equivalent behavior.

### Dependency order and empty-creation analysis

The ten tables are independent in the declared schema: there are no foreign-key
edges between them or to existing tables. The deterministic creation order is
source order:

1. `TusBillingAccount`
2. `TusSubscriptionPlan`
3. `TusBillingRefund`
4. `TusBillingLedger`
5. `TusBillingIdempotency`
6. `TusBillingAudit`
7. `TusBillingOutbox`
8. `TusBillingDunning`
9. `TusBillingNumberSequence`
10. `TusAccountingExport`

For each table, define the exact columns first, then its source-derived primary
key, unique contract, and secondary index where listed. The whole ordered unit
is one bounded transaction after all read-only preflight gates pass. No table
depends on the absent prior conformance marker or on the historical additive
marker.

All ten tables can be safely created empty under the current contract. Empty
creation supplies no money, tenant, invoice, or sequence values and therefore
does not invent business data. `amountMinor` remains `BIGINT NOT NULL` with no
default on the three affected tables; `currency` also has no default. The
tables are only safe to populate later after tenant-scoped application rules,
money-unit validation, and independent runtime gates are proven.

Tenant isolation is only structurally supported by the `tenantId`-prefixed
unique/index shapes. Because the source has no tenant foreign keys, the repair
must not claim database-enforced tenant existence or cross-tenant safety. The
repair must preserve exact text IDs and never synthesize IDs, timestamps, money,
currencies, sequence numbers, or JSON payloads.

## Proposed Scope

Create one new, forward-only, additive billing correction unit that:

1. Uses only the repository-root `.env` `DATABASE_URL`, requires
   `NODE_ENV=development` and explicit target confirmation, and rejects
   alternate/shared/production targets before a repair connection.
2. Requires a fresh hash/size-bound custom-format backup and a successful
   isolated PostgreSQL 16.2 schema-only restore proof with metadata-only
   verification (`rowValuesRead=0`). The proof must be revalidated before DDL.
3. Runs a read-only catalog preflight. Each billing table must be absent or
   already exactly conformant; any partial, incompatible, or conflicting
   existing table/object is a hard-stop before DDL. The observed target is the
   simple all-absent case. Existing exact tables are idempotent no-ops only.
4. Creates only the ten absent tables from the contract above, including their
   exact columns, explicit source defaults, ten primary keys, unique contracts,
   and listed indexes. It must not alter the already-exact `22` POS indexes or
   `3` POS constraints.
5. Records the selected new explicit marker
   `20260915160000_tus_billing_schema_conformance_repair` exactly once only
   after the transaction commits. The marker is collision-checked before DDL.
6. Is idempotent: an already exact table/object is a no-op, a completed new
   marker plus exact catalog is a no-op, and a marker/catalog mismatch is a
   restore-required failure rather than a repair opportunity.
7. Uses one bounded transaction, a 60-second operation bound, and at most one
   retry after full cleanup. An uncertain commit is never retried. Pre-commit
   failure rolls back; post-commit mismatch is handled only by owner-approved
   restore into an isolated target, never by a down migration or restore over
   the current target.

This is a separate billing repair, not a replay or modification of
`20260909170000_tus_billing/migration.sql`. The historical SQL remains a
read-only contract reference. No source, test, existing migration, database, or
deployment is changed during exploration.

## Non-goals

- Do not replay `20260909170000_tus_billing` or any historical migration.
- Do not insert or reconstruct `20260831180000_tus_additive_migration_repair`.
- Do not assume that `20260911130000_tus_live_schema_conformance_repair` was
  applied: fresh evidence reports its count as zero. It is not required by this
  correction and must not be fabricated.
- Do not repair the fourteen formerly incorrect POS indexes; fresh evidence
  reports all `22` indexes exact.
- No `migrate deploy`, `migrate dev`, `db push`, reset, drop, truncate, rebuild,
  destructive delete/update, default/backfill, or row-value read.
- No money values, IDs, timestamps, currencies, JSON payloads, sequence values,
  seed data, or tenant records.
- No triggers, append-only behavior, backfills, inferred defaults, tenant
  foreign keys, non-negative/currency/money checks, enums, extensions, or other
  behavior not represented by the Prisma source contract.
- No seed, provider, durable POS, browser/device, deployment, cloud, or
  production-readiness activity.
- No production-readiness or overall live-conformance claim follows from this
  exploration or from empty-table creation.
- Do not add foreign keys, checks, enums, extensions, or historical trigger
  behavior that is not explicitly approved as part of the source-derived
  correction.

## Dependencies

- `apps/api/prisma/schema.prisma` is the canonical logical contract.
- `apps/api/prisma/migrations/20260909170000_tus_billing/migration.sql` is a
  read-only physical-shape/reference document only; it must not be executed.
- Existing launch marker `20260909090000_tus_argentina_market_launch` and POS
  marker `20260911120000_tus_pos_index_constraint_repair` must be verified
  exactly once before apply. The absent prior conformance marker is not a gate.
- New marker `20260915160000_tus_billing_schema_conformance_repair` must be
  absent before apply and exactly once after a successful commit.
- Historical marker `20260831180000_tus_additive_migration_repair` must remain
  absent; it is neither a dependency nor an apply target.
- The previous conformance repair's runner/acceptance rules, especially its
  root-target, backup, retry, redaction, and metadata-only boundaries, should be
  reused only where they do not assume billing tables already exist.
- The current target's fresh metadata receipt is diagnostic evidence, not an
  authorization to mutate it.
- A verified operator backup, isolated restore, target identity, reviewed SQL,
  and owner-approved rollback/restore procedure are execution prerequisites.
- The target must be re-preflighted immediately before any authorized apply;
  the observed all-absent state is evidence, not authorization.

## Data Risks

- The prior conformance design assumes missing columns in existing tables; using
  it unchanged would fail closed on the current stronger `missing-money-table`
  condition or risk unsafe partial creation.
- A partially existing billing table could contain data or an incompatible
  shape. It must be inspected by metadata and permitted aggregates only; any
  partial or incompatible state is a hard-stop before DDL. No table rebuild or
  automatic conversion is safe.
- A missing table has no readable row count. For present affected tables, counts
  may be obtained only as permitted aggregates; no row values may be selected,
  emitted, or used to synthesize columns. Empty creation is safe because it
  creates no business data.
- `BIGINT` preserves exact integer minor units, but the schema has no currency or
  non-negative checks. Adding such rules would be a separate contract change;
  this repair must not invent them.
- Tenant prefixes improve query/index discipline but do not enforce that a
  tenant exists. Application authorization and tenant-scoped repository rules
  remain required.
- Historical append-only triggers may be operationally important but are not
  encoded in Prisma. Omitting them could leave a runtime policy gap; adding them
  without a separately reviewed contract would broaden this correction.
- Marker lineage is ambiguous if a future acceptance requires the absent prior
  conformance marker. Fabricating either that marker or the historical additive
  marker would create false migration history.

## Verification Plan

1. **Static source contract:** independently parse the Prisma models and compare
   the proposed SQL against every field, type, nullability, default, PK, unique
   shape, and index. Assert no destructive tokens, defaults/backfills for money,
   historical replay, or invented values.
2. **Backup/isolated restore gate:** verify the custom archive fingerprint and
   size, perform one bounded schema-only isolated restore, verify the scratch
   metadata read-only with zero row values, and retain only redacted proof.
3. **Target gate:** verify root `.env` source, development profile, explicit
   confirmation, target identity, launch/POS marker counts exactly once,
   new-marker absence, prior-conformance-marker absence without requiring it,
   historical-marker absence, and no unexpected object collisions.
4. **Preflight:** metadata-only check that all ten tables are absent or exact;
   for existing tables, verify columns/defaults/PK/unique/index shapes and use
   only permitted aggregate counts without reading business rows. Any partial,
   incompatible, or conflicting state blocks. The all-absent case is eligible
   for empty creation.
5. **Apply/idempotency:** in a later authorized execution, create only the
   absent source-derived tables in the stated deterministic order, commit one
   new marker, and verify a second invocation produces no duplicate DDL or
   marker. Existing exact tables are no-ops; partial/incompatible tables never
   become repair candidates.
6. **Acceptance receipt:** under fresh read-only `REPEATABLE READ`, prove the
    existing `62/62` launch/POS entries remain exact, the ten billing tables are
    present, all `26/26` money declarations and `68/68` PK contracts are exact,
    `22/22` indexes and `3/3` constraints remain exact, launch/POS/new marker
    counts match the approved lineage, both absent historical markers are
    reported absent as intended, and `rowValuesRead=0`.
7. **Gating:** do not seed or run durable POS/runtime actions before the billing
   metadata receipt is accepted. Even after it, seed/POS/provider/deployment and
   production gates remain independent; failed or incomplete evidence stays
   NO-GO and must not be promoted to production proof.

## Marker Lineage

The fresh evidence establishes this current lineage and the selected correction
lineage:

```text
20260909090000_tus_argentina_market_launch                 exactly once
  -> 20260911120000_tus_pos_index_constraint_repair       exactly once
  -> 20260915160000_tus_billing_schema_conformance_repair selected new marker
```

The new billing marker must identify only the billing-table correction. It must
require only the present launch and POS markers, and must not insert, rewrite,
or reconcile the absent prior conformance marker. The old conformance marker
cannot be described as already applied while the fresh count is zero; this new
marker supersedes its operational gap only for this explicit billing correction,
not its historical identity. The historical additive marker remains
intentionally absent in every outcome and is never replayed.

## Remaining Operational Prerequisites

- A verified custom-format backup and successful isolated PostgreSQL 16.2
  schema-only restore proof, with owner-controlled cleanup of retained scratch
  resources.
- Confirmation that the root `.env` development target and explicit target
  confirmation remain valid immediately before apply; alternate/shared/
  production targets are prohibited.
- Reviewed SQL/runner design and an owner-approved isolated-restore procedure
  for post-commit mismatch; no down migration or restore-over-current rollback.
- A fresh metadata-only preflight confirming the ten tables are still absent or
  already exact, with any present-table counts limited to permitted aggregates.
- After acceptance, independent operational gates remain for seed, providers,
  durable POS/runtime, deployment, and production evidence.

## Unresolved Questions

None within the exploration scope. The marker prerequisites, selected marker,
historical-marker treatment, ten-table source contract, dependency order,
empty-creation rule, hard-stop policy for partial/incompatible tables, and
metadata/aggregate-only evidence boundary are resolved above. The remaining
items are execution prerequisites, not open scope decisions.

## Ready for Proposal

Yes. The proposal should treat this as a new additive billing-table creation
unit, not a rerun of the prior conformance repair or historical billing
migration. No production-readiness claim is supported.
