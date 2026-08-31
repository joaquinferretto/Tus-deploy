# Backup Evidence

status: blocked
source_used: "Implemented resolver returned `ready` for repository-root `.env` `DATABASE_URL` only under development authorization; no alternate URL source was used."
backup_tool: "pg_dump custom format unavailable; pg_restore unavailable"
backup_handle_redacted: null
connection_attempts:
  count: 0
  timeout_ms_per_attempt: 60000
  retry_count: 1
  max_attempts: 2
  result: "Not attempted because the required backup tool was unavailable."
backup_verification:
  status: blocked
  dump_created: false
  nonzero_size: false
  list_test: not-run
  contents_read: false
  reason: "pg_dump is unavailable; no non-restorable substitute was created."
side_effects:
  database_connections: 0
  database_writes: 0
  database_deletes: 0
  providers_called: 0
  processes_started: 0
  uploads: 0
cleanup_state:
  status: complete
  owned_temporary_children_remaining: 0
  temporary_dump_created: false
risks:
  - "Additive migration repair remains blocked until a restorable custom-format PostgreSQL backup can be created."
  - "No database reachability or backup integrity claim was made."
next_recommended: "Make `pg_dump` and `pg_restore` available, then rerun the same bounded backup procedure using only the implemented development resolver."
skill_resolution:
  shared: "C:\\Users\\mmmau\\.config\\opencode\\skills\\_shared\\SKILL.md"
  typescript: "C:\\Users\\mmmau\\.config\\opencode\\skills\\curated\\typescript\\SKILL.md"
  resolver: "scripts/test-runner-lib.mjs"
  mode: "read-only backup preflight"
