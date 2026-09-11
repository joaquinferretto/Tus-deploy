# Backup Evidence

status: passed
source_used: "Implemented resolver returned `ready` for repository-root `.env` `DATABASE_URL` only under development authorization; no alternate URL source was used."
backup_tool: "Official PostgreSQL 16.2 pg_dump/pg_restore; source checksum matched binaries in the user-owned client path."
backup_handle_redacted: "external-temp-custom-archive"
connection_attempts:
  count: 0
  timeout_ms_per_attempt: 60000
  retry_count: 1
  max_attempts: 2
  result: "Backup verification completed before repair; connection retry policy remained available to the repair runner."
backup_verification:
  status: passed
  dump_created: true
  nonzero_size: true
  list_test: passed
  contents_read: false
  reason: "Custom-format archive passed pg_restore --format=custom --list; contents were not read."
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
  temporary_dump_created: true
risks:
  - "Additive migration repair remains blocked until a restorable custom-format PostgreSQL backup can be created."
  - "No database reachability or backup integrity claim was made."
next_recommended: "Do not rerun repair in this session; resolve the post-apply schema-verification blocker before any new bounded attempt."
skill_resolution:
  shared: "C:\\Users\\mmmau\\.config\\opencode\\skills\\_shared\\SKILL.md"
  typescript: "C:\\Users\\mmmau\\.config\\opencode\\skills\\curated\\typescript\\SKILL.md"
  resolver: "scripts/test-runner-lib.mjs"
  mode: "read-only backup preflight"

## Current Backup Verification

- Source: official `get.enterprisedb.com/postgresql` PostgreSQL 16.2 Windows x64
  binaries; archive SHA-256 and `pg_dump`/`pg_restore` executable hashes matched
  the user-owned persistent client path.
- Archive: custom format, nonzero size, owner/ACL exclusion enabled, external to
  the repository, and preserved after verification.
- `pg_restore --format=custom --list` exited `0`; backup contents were not read.
- The exact backup artifact used by the repair is kept as an external redacted
  handle. No URL, credential, row value, PII, or backup content is recorded.
