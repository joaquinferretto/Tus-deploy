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

## Follow-up Conformance Session: 2026-09-14

The follow-up `tus-live-schema-conformance-repair` session created a fresh
custom-format archive with official PostgreSQL 16.2 tooling. Nonzero-size and
`pg_restore --format=custom --list` exit `0` passed without reading archive
contents. The isolated restore gate then failed: one scratch was created, the
first restore did not complete within the bounded process window, and a
diagnostic retry against the partial scratch returned exit `1`. The scratch is
retained for owner cleanup. No current target restore, repair, migration, seed,
provider, or runtime operation followed; `liveConformance: false` remains.

## Fresh Bounded Schema-Only Restore Diagnostic: 2026-09-14

The same external custom-format archive passed `pg_restore --format=custom
--list` with exit `0` and 265 TOC entries. One new scratch database was created
from the root `.env` `DATABASE_URL` server credentials, and exactly one official
`pg_restore` invocation ran with explicit `--dbname`, `--schema-only`,
`--no-owner`, `--no-acl`, `--exit-on-error`, and `--verbose` flags under a
60-second bound. The restore completed without a categorized error.

Read-only scratch metadata verification returned 59 tables, 608 columns, 59
primary keys, 126 indexes, and 95 constraints. No row values were read. The
root target received no restore, DDL, or DML; the scratch remains intentionally
retained. Diagnostic logs and client processes were cleaned up. This evidence
does not authorize current-target repair, seed, providers, deployment,
browser/device, Docker, or review lifecycle work.
