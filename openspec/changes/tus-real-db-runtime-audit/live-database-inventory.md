# Live Database Inventory

schema: `gentle-ai.postgres-live-database-inventory/v1`
change: `tus-real-db-runtime-audit`
executed_at: `2026-08-31`
status: `passed`
evidence_class: `real-postgres`

## Executive Result

The authorized read-only PostgreSQL inventory completed against the repository
root `.env` `DATABASE_URL` only. The existing safe resolver classified the
target as `remote-development-attested` under process `NODE_ENV=development`
and the explicit development operation context. No URL, host, credential,
token, PII, payload, or raw identity was printed or persisted.

The target is reachable and the fixture is present and idempotent, but the
live schema is not POS-ready: only `TusHardeningFixture` is present among the
focused product/service/POS/audit/outbox contract tables.

## Connection Attempts

```yaml
connection_attempts:
  - attempt: 1
    timeout_ms: 60000
    status: passed
retry_policy:
  retry_budget: 1
  retry_used: false
  third_attempt: prohibited
```

The existing bounded retry helper was used. The first connection and read-only
probe passed, so no retry was needed.

## Redacted Identity

```yaml
redacted_identity:
  target_classification: remote-development-attested
  host: masked
  server_address: masked
  database: sha256:693fe5919fc229a2
  user: sha256:6f198191100386e1
  postgresql_major: "16"
  current_schema: public
  effective_search_path: [public]
  configured_search_path: redacted
  transaction_read_only: true
```

Database and user values are truncated SHA-256 classifications, not names.

## Schema Inventory

The inventory query read relation metadata from `information_schema` and
catalog metadata only. Relation names were retained only for the known,
non-sensitive TUS/platform allowlist.

```yaml
information_schema:
  relation_counts:
    tables: 1
    views: 0
    other: 0
  non_sensitive_relation_names:
    - TusHardeningFixture
known_tus_table_row_counts:
  TusHardeningFixture:
    status: measured
    rows: 1
indexes:
  - table: TusHardeningFixture
    name: TusHardeningFixture_pkey
    primary: true
    unique: true
    columns: [id]
  - table: TusHardeningFixture
    name: TusHardeningFixture_tag_version_runId_key
    primary: false
    unique: true
    columns: [tag, version, runId]
  - table: TusHardeningFixture
    name: TusHardeningFixture_tenantId_tag_version_idx
    primary: false
    unique: false
    columns: [tenantId, tag, version]
constraints:
  primary_keys:
    - TusHardeningFixture_pkey
  unique_constraints: []
  foreign_keys: []
  check_constraints: []
tenant_related_objects:
  - table: TusHardeningFixture
    column: tenantId
```

The unique fixture identity is represented by a unique index rather than a
separate PostgreSQL unique constraint.

## Migration State

```yaml
migration_state:
  ledger_presence:
    _prisma_migrations:
      present: false
      applied_migrations: 0
    schema_migrations:
      present: false
      applied_migrations: 0
    SequelizeMeta:
      present: false
      applied_migrations: 0
    knex_migrations:
      present: false
      applied_migrations: 0
  applied_migration_count: null
  repository_migration_replay: not-run
```

No migration command, DDL, migration repair, or historical migration replay
was run. Because no ledger exists, an applied migration count is unavailable,
not zero.

## Seed Fixture State

```yaml
seed_fixture_state:
  status: measured
  exists: true
  total_rows: 1
  distinct_identities: 1
  distinct_fixture_keys: 1
  duplicate_aggregate: 0
  one_stable_identity: true
```

This is an aggregate verification only. No fixture identity, tag, version,
run ID, tenant ID, actor ID, or listing ID was persisted.

## POS Schema State

This focused contract covers the required product/service listing, POS core,
audit, and outbox tables. Product and service are represented by the shared
`TusListing` table in the repository schema.

```yaml
pos_schema_state:
  status: measured
  required_table_count: 10
  present_table_count: 0
  missing_table_count: 10
  presence:
    product_service:
      TusListing: false
    pos_core:
      TusPosOperation: false
      TusPosVersion: false
      TusPosReceipt: false
      TusPosDevice: false
      TusPosSession: false
      TusPosConflict: false
    audit:
      TusPosAudit: false
    outbox:
      TusPosOutbox: false
      TusDeliveryOutbox: false
```

The broader prior evidence retains its 15-table POS/hardening readiness
baseline; this inventory reports the requested focused contract explicitly.

## Side Effects

```yaml
side_effects:
  read_only_transaction: true
  transaction: BEGIN REPEATABLE READ READ ONLY, then ROLLBACK
  connections: 1
  read_queries: 7
  transaction_commands: 8
  writes: 0
  ddl: 0
  migrations: 0
  seed_invocations: 0
  deletes: 0
  provider_calls: 0
  services_started: 0
  api_web_mobile_browser_docker_watchers_started: 0
```

The runner used the existing API-local `pg` driver, a single client, bounded
statement and lock timeouts, and catalog/aggregate queries only. No API, web,
mobile, browser, Docker, watcher, provider, or cleanup operation was started.

## Cleanup State

```yaml
cleanup_state: closed
owned_children_started: 0
owned_children_remaining: 0
listeners_created: 0
```

The PostgreSQL pool was ended after `ROLLBACK`; the finite Node process exited
without an owned child or listener.

## Risks

- Remote development access is operator-attested only; it is not automated ownership or production-safety proof.
- No migration ledger is present, so the live applied migration count is unavailable.
- The required POS product/service/audit/outbox tables are absent from the live target.
- This run measured metadata and existing fixture aggregates only; it did not exercise POS writes, tenant isolation, audit/outbox durability, replay, recovery, or provider behavior.
- Existing historical migrations remain outside this read-only inventory and were not replayed because prior evidence identified destructive SQL in the pending backlog.

## Next Recommended

Do not run historical migrations. Review this inventory and, only under a
separately authorized database-changing operation, prepare an additive-only
repair path for the missing POS schema. Keep the root `.env`
`DATABASE_URL`, `NODE_ENV=development`, explicit attestation, and the 60-second
single-retry boundary.

## Artifacts

```yaml
artifacts:
  current: openspec/changes/tus-real-db-runtime-audit/live-database-inventory.md
  prior_evidence_preserved:
    - openspec/changes/tus-real-db-runtime-audit/postgres-evidence.md
    - openspec/changes/tus-real-db-runtime-audit/postgres-seed-evidence.md
    - openspec/changes/tus-real-db-runtime-audit/pos-real-evidence.md
```

## Skill Resolution

```yaml
skill_resolution:
  sdd_verify: C:\Users\mmmau\.config\opencode\skills\sdd-verify\SKILL.md
  typescript: C:\Users\mmmau\.config\opencode\skills\curated\typescript\SKILL.md
```
