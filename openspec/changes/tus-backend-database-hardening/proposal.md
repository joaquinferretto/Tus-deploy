# Proposal: TUS Backend and Database Hardening

## Intent

Make the PostgreSQL-backed TUS backend safe to start, schema-aware, durable across retries/restarts, and honest about unverified integrations. Verified target facts: only `TusHardeningFixture` (one row), no migration ledger/POS tables, and destructive SQL in the historical backlog. Prior development seed succeeded; broader POS did not run. This proposal authorizes no database or process action.

## Scope

### In Scope
- **Phase 1 — Boot:** root `.env` `DATABASE_URL`; 60-second DB start/connect with exactly one retry; bounded lifecycle, readiness, shutdown, and explicit development seed confirmation.
- **Phase 2 — Schema:** additive-only repair/ledger for the selected surface, shape checks, backup/restore gate, and no historical replay.
- **Phase 3 — Durability:** tenant/POS invariants, idempotency, atomic receipt/audit/outbox, claim fencing, recovery, and failure injection.
- **Phase 4 — Controls:** auth/revocation, tenant enforcement, redacted errors, correlation, CORS, request/rate limits, and observability.
- **Phase 5 — Operations:** worker/provider isolation, env/deployment normalization, runbooks, and separated evidence.

### Out of Scope
- `Goldenrepo-js_py`, unrelated changes, production activation, provider/device/hardware claims, and unverified cloud/production evidence.
- Destructive historical replay, `migrate reset`, `db push`, broad cleanup, or untagged deletion.

## Capabilities

### New Capabilities
- `tus-backend-database-hardening`: safe lifecycle, additive PostgreSQL repair/readiness, durable tenant/POS operations, security, and evidence.

### Modified Capabilities
- None (no main capabilities exist under `openspec/specs/`).

## Approach

Use strict TDD in phase order. Before live DDL require verified operator backup/restore, target/schema/data preflight, additive SQL review, and a forward-only ledger strategy; a custom marker is not historical lineage reconciliation. Seed only in development with explicit confirmation; ambiguous/production targets fail closed. `/ready` is non-mutating and schema-aware. Provider calls remain zero until separately evidenced.

## Affected Areas

| Area | Impact |
|---|---|
| `apps/api`, Prisma/pg, auth/tenancy, TUS/POS, jobs/worker | Lifecycle, schema, durability, security, ownership |
| `scripts`, tests, runbooks, manifests/docs | Gates, evidence, deployment, recovery |

## Risks

| Risk | Mitigation |
|---|---|
| Missing lineage/unsafe DDL | Stop before writes; require backup/restore and additive review |
| Cross-tenant/duplicate effects | Composite scope, atomic claims, fences, concurrency tests |
| False readiness/secrets | Schema-aware readiness, redaction, cleanup, evidence classes |

## Rollback Plan

Rollback application/config by phase. Never reverse with destructive SQL; restore only from the verified point under the runbook, preserving ledgers, outboxes, audit, and recovery records.

## Dependencies

- Disposable development target, backup/restore tooling, approved schema boundary, and separately supplied provider/cloud/device access for future external proof.

## Success Criteria

- [ ] Boot stops after two bounded DB attempts; readiness is schema-compatible and shutdown bounded.
- [ ] Additive repair preserves rows; no destructive replay; seed confirmation is explicit/idempotent.
- [ ] Tenant/POS retry, conflict, audit/outbox, recovery, auth, and provider-zero paths pass real PostgreSQL or are `external-blocked`.
- [ ] Redacted evidence is classified `deterministic`, `real-PostgreSQL`, `browser/mobile`, `deployment`, or `external-blocked`; no unsupported production/provider/device claim.
- [ ] High review workload uses phase slices targeting ≤400 authored changed lines; generated evidence is excluded.

## Proposal question round

Assumptions to confirm before specs: first activation is the API’s minimum schema, development-only seed is the sole seed mode, and integrations stay disabled. No harness/runtime question is required now.
