# Delta for tus-backend-database-hardening

## MODIFIED Requirements

### Requirement: Canonical configuration and seed safety

The system MUST use only the repository-root `.env` `DATABASE_URL`; it MUST NOT add or honor new URL variables. Development seed MUST require explicit confirmation, preserve the user-owned remote-development target, be idempotent, and fail closed for ambiguous or production targets. The schema-conformance repair MUST additionally require `NODE_ENV=development` and `--confirm-development-target`, and seed/provider/POS runtime MUST remain disabled until metadata acceptance.
(Previously: Seed safety governed the canonical root target but did not explicitly gate this repair or pre-acceptance runtime.)

#### Scenario: Confirmed versus unsafe seed
- GIVEN a confirmed user-owned development target, or an ambiguous/production target
- WHEN seed is requested
- THEN the first case is idempotent; the second stops before connection or writes

#### Scenario: Repair target confirmation
- GIVEN the root `.env` target is not explicitly confirmed as development
- WHEN conformance repair is requested
- THEN it stops before DDL and runtime activity

### Requirement: Bounded database-aware lifecycle

Database start/connect MUST be bounded to 60 seconds per attempt, with exactly one retry after closing the failed pool. Startup, `/ready`, and shutdown MUST be bounded; readiness MUST be non-mutating and schema/dependency aware. The repair DDL and its metadata receipt MUST remain within one transaction/session boundary as applicable, with no third attempt.
(Previously: Lifecycle bounds covered startup/readiness but not the repair transaction and acceptance boundary.)

#### Scenario: Failed or incompatible database
- GIVEN connection fails twice or required schema is incompatible
- WHEN startup/readiness runs
- THEN the process stops after the second bounded attempt or reports not-ready without advertising a usable listener

#### Scenario: Repair timeout
- GIVEN a repair attempt times out
- WHEN retry handling completes
- THEN cleanup is recorded, at most one retry occurs, and no third attempt or unbounded DDL occurs

### Requirement: Additive schema, lineage, and backup gates

Schema repair MUST be target-scoped and additive-only. Live DDL requires verified backup/restore, target/schema/data preflight, reviewed SQL, and a forward-only ledger strategy; a custom marker MUST NOT reconcile historical lineage. This repair MUST require an isolated restore verification, empty affected money tables, null/duplicate-free affected identifiers, compatible PK absence, exact index-alias availability, and the exact launch/POS/new-marker lineage. It MUST never use defaults/backfill, drops, historical replay, or restore-over-current.
(Previously: Additive repair required general gates but did not define these exact catalog and lineage gates.)

#### Scenario: Authorized repair versus unsafe backlog
- GIVEN all gates pass, or historical SQL is destructive/lineage is absent
- WHEN repair or backlog replay is requested
- THEN only the selected additive shape may apply in the first case; the second stops before writes

#### Scenario: Post-commit mismatch
- GIVEN a committed repair fails fresh metadata verification
- WHEN rollback is evaluated
- THEN the result is restore-required into an isolated target; no down migration or restore-over-current occurs

### Requirement: Observability and evidence truth

Lifecycle, readiness, retries, transactions, claims, conflicts, shutdown, and provider calls MUST produce correlated redacted structured evidence. Results MUST be classified `deterministic`, `real-PostgreSQL`, `browser/mobile`, `deployment`, or `external-blocked`; unsupported production claims are forbidden. Conformance acceptance MUST include exact 62-table, 26-money, 68-PK, 22-index, and 3-constraint results, marker counts, `rowValuesRead=0`, and truthful `liveConformance`/NO-GO fields.
(Previously: Evidence classification and redaction existed without this exact conformance receipt.)

#### Scenario: Missing external access
- GIVEN real integration access is unavailable
- WHEN verification records the result
- THEN it records `external-blocked` and MUST NOT promote deterministic evidence to production proof

#### Scenario: Incomplete receipt
- GIVEN any exact count, lineage, redaction, or zero-row-value condition is missing
- WHEN acceptance is finalized
- THEN `liveConformance=false` and NO-GO remain

### Requirement: Worker and provider isolation

Worker PostgreSQL/Redis ownership and contracts MUST be explicit. Mercado Pago, WhatsApp, external AI, cloud, hardware, settlement, payout, seed, POS runtime, and production activation MUST remain disabled or `external-blocked` until separately evidenced; none may run before conformance metadata acceptance.
(Previously: Provider and runtime boundaries were deferred but did not name the repair acceptance gate.)

#### Scenario: Unverified provider boundary
- GIVEN a workflow reaches an unverified provider
- WHEN it is processed
- THEN no provider call occurs and the boundary is recorded safely

#### Scenario: Pre-acceptance runtime
- GIVEN schema metadata acceptance has not passed
- WHEN seed, POS, or provider execution is requested
- THEN execution is denied and the repair remains NO-GO
