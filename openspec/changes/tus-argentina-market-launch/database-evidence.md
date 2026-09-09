# Database Evidence: TUS Argentina Market Launch

## Scope

This evidence covers static implementation checks only. No live database, seed, migration, provider, or deployment operation was executed.

## Checks

| Check | Result |
|---|---|
| Launch migration inventory | 27 migration files present; launch migration added as the selected forward-only shape |
| Required table declarations | 56 required launch/POS tables found in the launch migration |
| Destructive SQL scan | Passed; no `DROP`, `TRUNCATE`, `CASCADE`, or `DELETE FROM` tokens in the launch migration |
| Exact money scan | Passed; monetary migration columns use `BIGINT`; commission rate uses integer basis points |
| Prisma money scan | Passed statically; no `Float` fields remain in `apps/api/prisma/schema.prisma` |
| Formatting | `git diff --check` passed |
| Focused tests | Not run; Node.js and pnpm are unavailable |
| Restorable backup | Not verified; `pg_dump`, `pg_restore`, and `psql` are unavailable |

## Safety Boundary

The database gate remains closed until a real focused test run, target/schema/data preflight, and restorable backup verification are available. Historical migrations are inventory input only and were not replayed or modified.

## Open Decision

Existing historical tables such as `TusListing`, `TusMarketplaceCommitment`, and related financial records may have legacy floating-point columns. An approved additive backfill/conversion policy is still required before claiming runtime compatibility for those existing rows.
