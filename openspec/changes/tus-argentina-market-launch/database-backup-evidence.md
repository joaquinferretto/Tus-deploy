# Database Backup Evidence: TUS Argentina Market Launch

## Result

- `status`: `blocked`
- `executive_summary`: The authorized development backup pass used only the repository-root `.env` `DATABASE_URL` under `NODE_ENV=development` with explicit development confirmation. Both bounded custom-format `pg_dump` attempts failed before a valid dump was produced; no partial file was retained.
- `source_used`: repository-root `.env` `DATABASE_URL` only; no alternate URL, package environment, deployment environment, or printed target was used.
- `development_context`: `NODE_ENV=development`; explicit development confirmation context supplied internally; target value redacted and not persisted.

## Backup Tool

The requested `bin` paths were absent in the installed package directory. The installed user-local executables were present and used from their actual package-root paths:

- `pg_dump`: `C:\Users\mmmau\AppData\Local\Temp\opencode\postgresql-client-16.2\pg_dump.exe`
- `pg_restore`: `C:\Users\mmmau\AppData\Local\Temp\opencode\postgresql-client-16.2\pg_restore.exe`
- Requested paths `...\postgresql-client-16.2\bin\pg_dump.exe` and `...\bin\pg_restore.exe`: absent; no substitute tool was used.

Options passed to `pg_dump` were custom format, `--no-owner`, and `--no-privileges`. The process-level connection/backup bound was 60,000 ms per attempt.

## Connection Attempts

```yaml
count: 2
timeout_ms_per_attempt: 60000
retry_count: 1
max_attempts: 2
attempts:
  - attempt: 1
    pg_dump: failed
    nonzero_file: false
    pg_restore_list_format: not-run
  - attempt: 2
    pg_dump: failed
    nonzero_file: false
    pg_restore_list_format: not-run
```

Failure diagnostics were not retained or emitted because they could contain connection details. No third attempt was made.

## Backup Verification

```yaml
status: blocked
backup_handle_redacted: null
dump_created: false
nonzero_size: false
pg_restore_list_format: not-run
contents_read: false
file_preserved: false
```

Because neither `pg_dump` attempt produced a nonzero dump, `pg_restore --format=custom --list` was not run and no restorable-backup claim is made.

## Database Effects

```yaml
database_connections_or_backup_attempts: 2
database_writes: 0
ddl: 0
dml: 0
provider_calls: 0
database_mutation: none
```

The operation was backup-only. No migration, seed, DDL, INSERT, UPDATE, DELETE, reset, truncate, cascade, provider, or deployment operation occurred.

## Cleanup

- The temporary dump path was unique to this run and was removed after each failed attempt.
- No partial dump was preserved.
- No helper process owned by this run remains.
- No backup handle is available for the next migration phase.
- The root `.env` and all secret-bearing values remain unchanged and undisclosed.

## Risks and Next Step

- Additive PostgreSQL migration remains blocked because a verified restorable custom-format backup is unavailable.
- Re-run a new separately bounded development backup pass after correcting the installed-tool path contract; preserve the successful dump handle for the migration phase.
- Do not proceed to DDL, migration, seed, or restore claims from this result.

## Skill Resolution

- `sdd-apply`: `C:\Users\mmmau\.config\opencode\skills\sdd-apply\SKILL.md`
- `_shared`: `C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md`
- `work-unit-commits`: `C:\Users\mmmau\.config\opencode\skills\work-unit-commits\SKILL.md`
- Mode: Strict TDD contract was active for the change; this external backup evidence pass had no source-code task or RED test applicable.
- CodeGraph: `.codegraph` existed, but the upstream CLI was unavailable; no structural fallback was needed for this bounded external operation.

## Correct-Path Retry Result

- `status`: `blocked`
- `executive_summary`: The requested retry could not start because the two exact PostgreSQL client paths supplied for this pass are absent in the current filesystem. The previously discovered package-root executables were not used as substitutes.
- `backup_tool`: `pg_dump` and `pg_restore` exact `...\\postgresql-client-16.2\\bin\\*.exe` paths verified absent; no other executable path was invoked.
- `backup_handle_redacted`: `null`
- `connection_attempts`: `0`; no PostgreSQL connection was opened and no retry was started because the required executables were unavailable.
- `backup_verification`: `not-run`; no dump was created, so nonzero-size and `pg_restore --list`/format checks were impossible.
- `database_effects`: no connection, backup attempt, read, write, DDL, DML, migration, seed, provider call, or deployment effect.
- `cleanup_state`: Complete; the approved output path was absent before this pass and remains absent. No partial file or helper process was created by this pass; the prior failed-attempt artifact was not deleted.
- `risks`: The exact-path contract remains unresolved in the current environment. The additive PostgreSQL migration must remain blocked until those exact tools are available and a nonzero custom-format dump passes `pg_restore --format=custom --list`.
- `next_recommended`: Make the supplied `bin` executable paths available, then run a new bounded development backup pass using only those exact paths; do not use the package-root executables as a substitute.

## Successful Database Backup Pass

- `status`: `success`
- `executive_summary`: Created a nonzero PostgreSQL custom-format backup from only the repository-root `.env` `DATABASE_URL` under `NODE_ENV=development` with explicit development confirmation. The dump passed `pg_restore --format=custom --list` verification and was preserved for the next migration phase.
- `source_used`: repository-root `.env` `DATABASE_URL` only; the value was loaded internally and was not emitted, persisted, or logged.
- `development_context`: `NODE_ENV=development`; explicit development confirmation context supplied internally; target value redacted and not persisted.

## Backup Tool

- `pg_dump`: `C:\Users\mmmau\Tools\postgresql-client-16.2\bin\pg_dump.exe` (PostgreSQL 16.2)
- `pg_restore`: `C:\Users\mmmau\Tools\postgresql-client-16.2\bin\pg_restore.exe` (PostgreSQL 16.2)
- `pg_dump` options: custom format, `--no-owner`, `--no-privileges`; one 60,000 ms process bound per attempt.
- No alternate executable, provider, service, Docker, deployment, migration, seed, or schema command was used.

## Backup Handle and Preservation

```yaml
backup_handle_redacted: file:tus-argentina-market-launch-backup.dump
output_path: C:\Users\mmmau\AppData\Local\Temp\opencode\tus-argentina-market-launch-backup.dump
file_preserved: true
nonzero_size: true
size_bytes: 3052
```

The output is outside the repository and remains preserved for the next migration phase. Its contents were not read or returned.

## Connection Attempts

```yaml
count: 1
timeout_ms_per_attempt: 60000
retry_count_allowed: 1
retries_used: 0
max_attempts: 2
attempts:
  - attempt: 1
    pg_dump: passed
    pg_dump_exit_code: 0
    nonzero_file: true
    pg_restore_list_format: passed
    pg_restore_exit_code: 0
```

The first attempt succeeded, so no retry was made. No third attempt was possible or performed.

## Backup Verification

```yaml
status: passed
dump_created: true
nonzero_size: true
pg_restore_list_format: passed
contents_read: false
file_preserved: true
```

`pg_restore --format=custom --list` completed successfully against the preserved file without returning or inspecting archive contents.

## Database Effects

```yaml
database_connections_or_backup_attempts: 1
database_reads: backup_only
database_writes: 0
ddl: 0
dml: 0
provider_calls: 0
database_mutation: none
```

This was a backup-only operation. No migration, seed, DDL, INSERT, UPDATE, DELETE, reset, truncate, cascade, provider, service, browser, Docker, or deployment operation occurred.

## Cleanup State

- No partial output required cleanup after the successful verification.
- The verified dump was intentionally preserved at the approved output path.
- No helper process owned by this run remains.
- The root `.env` and all secret-bearing values remain unchanged and undisclosed.

## Risks and Next Step

- The custom-format archive passed structural `pg_restore --list` verification; a full restore rehearsal was not performed in this backup-only pass.
- Preserve the redacted handle and output path for the authorized additive migration phase. Continue to prohibit historical destructive replay, reset, `db push`, truncate, cascade, and untagged deletes.

## Skill Resolution

- `sdd-apply`: `C:\Users\mmmau\.config\opencode\skills\sdd-apply\SKILL.md`
- `_shared`: `C:\Users\mmmau\.config\opencode\skills\_shared\SKILL.md`
- `work-unit-commits`: `C:\Users\mmmau\.config\opencode\skills\work-unit-commits\SKILL.md`
- Mode: Strict TDD was active for the change; this external backup-only work unit had no source-code RED test applicable.

### Database Backup Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | N/A — external backup-only work unit with no source-code task; exact PostgreSQL client versions were verified as 16.2 and the backup archive was structurally verified. |
| Runtime harness command/scenario and exact result | One bounded `pg_dump` attempt using the supplied exact executable path; exit 0, nonzero custom-format file created; `pg_restore --format=custom --list` exit 0. |
| Rollback boundary | Remove only the appended successful-backup evidence sections from this file and `apply-progress.md`; preserve the dump handle/output and all prior implementation/evidence artifacts. |
