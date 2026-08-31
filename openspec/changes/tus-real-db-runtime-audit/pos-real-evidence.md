# POS Real PostgreSQL Evidence

status: external-blocked
executive_summary: "Retry recorded separately from the prior confirmation-gated failure. The corrected HTTP harness propagated --confirm-development-target, used only the repository-root .env DATABASE_URL with NODE_ENV=development, passed Prisma schema validation, and connected to real PostgreSQL twice within the bounded retry budget. Both retry attempts stopped before fixtures and API startup because the required POS migrations are not applied. No POS flow success or real-postgres conformance is claimed."

connection_attempts:
  policy:
    connection_timeout_ms: 60000
    startup_timeout_ms: 60000
    request_timeout_ms: 60000
    shutdown_timeout_ms: 60000
    retry_count: 1
    max_attempts: 2
    third_attempt: prohibited
  prior_failed_attempt:
    status: external-blocked
    boundary: "PostgreSQL target safety"
    confirmation_propagated: false
    connection_attempts: 0
    preserved_from_previous_record: true
  retry:
    confirmation_flag: "--confirm-development-target"
    node_env: development
    target_source: "repository-root .env DATABASE_URL only"
    target_classification: remote-development-attested
    target_metadata: redacted
    prisma_schema_validation: passed
    attempts:
      - attempt: 1
        connection: { status: passed, timeout_ms: 60000 }
        post_connection_schema_gate: deferred
        boundary: "PostgreSQL schema migrations"
        reason: "Required PostgreSQL migrations are not applied"
      - attempt: 2
        connection: { status: passed, timeout_ms: 60000 }
        post_connection_schema_gate: deferred
        boundary: "PostgreSQL schema migrations"
        reason: "Required PostgreSQL migrations are not applied"

flows:
  product_sale:
    status: deferred
    classification: external-blocked
    boundary: "PostgreSQL schema migrations"
    detail: "No authenticated API or fixture path was entered."
  service_sale:
    status: deferred
    classification: external-blocked
    boundary: "PostgreSQL schema migrations"
    detail: "No authenticated API or fixture path was entered."
  retry_idempotency:
    status: deferred
    classification: external-blocked
    boundary: "PostgreSQL schema migrations"
    detail: "No POS operation was created, replayed, or conflict-checked."
  version_conflict_concurrency:
    status: deferred
    classification: external-blocked
    boundary: "PostgreSQL schema migrations"
    detail: "No version conflict was exercised; the existing harness has no separate simultaneous-request assertion."
  transaction_rollback:
    status: deferred
    classification: external-blocked
    boundary: "PostgreSQL schema migrations"
    detail: "No forced transaction rollback was exercised; the existing harness only models append-only conflict rollback."
  tenant_isolation:
    status: deferred
    classification: external-blocked
    boundary: "PostgreSQL schema migrations"
    detail: "No tenant-scoped authenticated POS request was entered."
  receipt_operation_persistence:
    status: deferred
    classification: external-blocked
    boundary: "PostgreSQL schema migrations"
    detail: "No operation, receipt, or durable response was written."
  audit_outbox_atomicity:
    status: deferred
    classification: external-blocked
    boundary: "PostgreSQL schema migrations"
    detail: "No audit/outbox write path was entered; existing coverage is count-based and has no failure-injection atomicity assertion."
  restart_replay_recovery:
    status: deferred
    classification: external-blocked
    boundary: "PostgreSQL schema migrations"
    detail: "No owned API child was started, restarted, replayed, or recovered."
  provider_interaction:
    status: passed
    provider_calls: 0
    settlement_claims: 0
    detail: "The pre-API boundary prevented provider interaction."

side_effects:
  retry_database_connections: 2
  successful_connection_attempts: 2
  schema_validation_operations: 2
  migration_invocations: 0
  fixture_invocations: 0
  writes: 0
  deletes: 0
  provider_calls: 0
  settlement_claims: 0
  owned_children_started: 0
  owned_children_remaining: 0

cleanup_state:
  status: verified
  api_process: not-started
  tracked_pid: null
  tracked_cwd: "apps/api"
  tracked_argv: not-started
  api_port: 3101
  port_3101_listener_remaining: false
  owned_process_remaining: false
  unknown_processes_killed: 0
  protected_pids_touched: 0

artifacts:
  - path: "openspec/changes/tus-real-db-runtime-audit/pos-real-evidence.md"
    status: updated
    note: "Prior failed confirmation-gated attempt preserved; corrected retry recorded separately."
  - path: "openspec/changes/tus-real-db-runtime-audit/postgres-seed-evidence.md"
    status: preserved
  - path: "openspec/changes/tus-real-db-runtime-audit/apply-progress.md"
    status: preserved
  - command: "NODE_ENV=development node --input-type=module -e <redacted bounded HTTP harness> -- --confirm-development-target"
    result: "connected twice; deferred at required PostgreSQL schema migration gate"
  - target_source: "repository-root .env DATABASE_URL only"
    target_metadata: redacted
    live_conformance: false
  - harness_correction: "runTusPostgresHttpSmoke confirmation reaches the canonical root target resolver"
  - prisma_validation_execution: "installed API Prisma CLI invoked without emitting stdout/stderr; no secret persisted"

risks:
  - "The real development target is reachable, but the required POS migrations are absent; applying them would be a separate database-changing operation and was not started within this bounded retry."
  - "All requested authenticated POS, persistence, rollback, tenant, conflict, and replay flows remain unexercised."
  - "The existing HTTP harness does not independently prove concurrent-request behavior or failure-injection atomicity; those subcases remain uncovered even after schema readiness."
  - "The default filtered pnpm Prisma validation wrapper is unavailable in this checkout; the installed Prisma CLI performed the same schema gate with the canonical URL and redacted diagnostics."

next_recommended: "After explicit approval to perform the required additive migration as a separate bounded operation, rerun the HTTP harness once with the same root .env source, NODE_ENV=development, --confirm-development-target, 60-second connection/start limits, one retry, fixed owned port 3101, and finally cleanup."

skill_resolution:
  shared: "C:\\Users\\mmmau\\.config\\opencode\\skills\\_shared\\SKILL.md"
  typescript: "C:\\Users\\mmmau\\.config\\opencode\\skills\\curated\\typescript\\SKILL.md"

---

# Bounded Additive Migration Operation

migration_operation:
  status: external-blocked
  operation: tus-real-db-runtime-audit
  execution_boundary: "Static destructive-SQL gate before any database-changing command"
  operator_intent:
    node_env: development
    confirmation_flag: "--confirm-development-target"
    target_source: "repository-root .env DATABASE_URL only"
    url_output: redacted
  connection_attempts:
    policy:
      timeout_ms_per_attempt: 60000
      retry_count: 1
      max_attempts: 2
    prisma_migrate_status:
      attempt_1: { status: failed, exit_code: 1, classification: pending }
      attempt_2: { status: failed, exit_code: 1, classification: pending }
      pending_count_observed: 25
    aggregate_schema_probe:
      attempt_1: { status: passed, timeout_ms: 60000 }
      retry_used: false
  migration_result:
    status: blocked_by_static_sql_gate
    target_migration_ledger: absent
    applied_count: 0
    already_applied_names: []
    pending_count: 25
    pending_names:
      - 20260823120000_identity_persistence
      - 20260823130000_refresh_rotation
      - 20260823140000_p2_database_ownership
      - 20260824100000_p2_run_ledger_request_hash
      - 20260824110000_p2_outbox_claim_lease
      - 20260824150000_p3_embeddings_pgvector
      - 20260824160000_p4_ai_registry
      - 20260826090000_tus_readiness
      - 20260826100000_tus_commerce_api
      - 20260826110000_tus_marketplace
      - 20260826120000_tus_finance
      - 20260826130000_tus_delivery_pos
      - 20260827090100_tus_canonical_readiness
      - 20260827090200_tus_identity_tenant
      - 20260827090300_tus_marketplace
      - 20260827090400_tus_commitments
      - 20260827090500_tus_finance
      - 20260827090600_tus_delivery_pos
      - 20260827090700_tus_support_reporting
      - 20260828120000_tus_final_hardening_readiness_metadata
      - 20260828120000_tus_runtime_readiness_audit
      - 20260829120000_tus_pos_runtime_correction
      - 20260829140000_tus_operations_wiring
      - 20260830100000_tus_product_hardening
      - 20260831170000_tus_real_db_runtime_audit
    required_pos_hardening_missing:
      - 20260826130000_tus_delivery_pos
      - 20260827090600_tus_delivery_pos
      - 20260829120000_tus_pos_runtime_correction
      - 20260830100000_tus_product_hardening
      - 20260831170000_tus_real_db_runtime_audit
    static_sql_gate:
      status: rejected
      destructive_statement_count: 19
      destructive_tokens: [CASCADE, DROP]
      destructive_migration_names:
        - 20260823120000_identity_persistence
        - 20260823130000_refresh_rotation
        - 20260823140000_p2_database_ownership
        - 20260824100000_p2_run_ledger_request_hash
        - 20260824160000_p4_ai_registry
        - 20260826110000_tus_marketplace
        - 20260827090500_tus_finance
      comment_only_token_observed:
        migration: 20260829120000_tus_pos_runtime_correction
        token: drop
        executable_sql: false
      truncate_statements: 0
      untagged_delete_statements: 0
    selected_apply_path: none
    migration_invocations: 0
    forbidden_commands_not_run: ["prisma migrate reset", "prisma migrate dev"]
  schema_verification:
    status: incomplete
    output_classification: redacted_aggregate_only
    migration_ledger_present: false
    hardening_fixture_table_present: false
    required_pos_hardening_table_count: 15
    present_required_table_count: 1
    missing_required_table_count: 14
    present_required_column_count: 10
  side_effects:
    read_only_status_and_metadata_queries: true
    migration_writes: 0
    seed_invocations: 0
    fixture_writes: 0
    deletes: 0
    provider_calls: 0
    api_web_mobile_browser_docker_watchers_started: 0
  cleanup_state:
    status: verified
    status_processes_remaining: 0
    metadata_pool_closed_in_finally: true
    owned_children_remaining: 0
    listeners_created: 0
  risks:
    - "All 25 repository migrations are pending because the target has no Prisma migration ledger."
    - "The pending backlog contains destructive SQL, so replaying it with prisma migrate deploy is prohibited by the static gate."
    - "Required POS and hardening schema metadata is incomplete; no POS runtime or seed evidence was claimed."
    - "The target is remote-development-attested only; the confirmation flag is operator intent, not ownership or production-safety proof."
  next_recommended: "Prepare and statically validate a target-specific additive-only migration path that does not replay the destructive historical backlog; rerun this bounded operation only after the pending set contains no rejected SQL."
