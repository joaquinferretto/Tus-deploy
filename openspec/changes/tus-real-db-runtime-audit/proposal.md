# Proposal: TUS Real Database and Runtime Audit

## Intent

Turn deterministic/static hardening into bounded, truthful PostgreSQL-backed runtime evidence. Existing evidence proves fail-closed contracts, but target identity/disposable proof is missing; the prior run recorded zero database side effects. The user explicitly confirms that the root `.env` `DATABASE_URL` identifies their owned remote free-tier development database. Close that gap without overstating external success.

## Scope

### In Scope
- Keep the user-confirmed root `.env` `DATABASE_URL` as the sole URL source for the owned remote free-tier development database; do not add six `TUS_TEST_*` metadata variables or any alternate URL, and never print secrets.
- Audit/harden schema, additive migrations, constraints, indexes, tenant isolation, product/service POS sales, audit/outbox, replay, and recovery.
- After the existing safety proof passes, migrate/preflight, run the idempotent, non-destructive seed twice, and verify redacted target metadata, identity, counts, duplicates, and targeted cleanup.
- Audit real API/web/mobile/POS flows with bounded Playwright/Chrome DevTools and secret-free screenshots; prepare local, Render, and Vercel contracts.

### Out of Scope / Non-goals
- `Goldenrepo-js_py`, unrelated changes, provider capture/settlement/payout, production activation, hardware, compliance, credentials, or any database URL/metadata alternatives beyond the explicit development confirmation.
- Database actions before proof; reset, truncate, untagged deletion, broad cleanup, unbounded processes, review lifecycle, `sdd-verify`, or archive.

## Capabilities

### New Capabilities
- `postgres-runtime-audit`: schema, migration, seed, tenant, and evidence gates.
- `pos-durability-runtime`: product/service atomicity, idempotency, audit/outbox, replay, recovery.
- `tus-runtime-conformance`: bounded API/web/mobile/POS flows and screenshots.
- `tus-environment-deployment`: normalized local/Render/Vercel contracts.

### Modified Capabilities
- None; no main specs currently exist.

## Approach

Six bounded phases: profile/static inventory; schema/migration audit; safe PostgreSQL migration and explicit two-run seed; authenticated POS/recovery; browser/mobile/POS audit; deployment/environment reconciliation. Connection/start attempts are bounded to 60 seconds with exactly one retry. `NODE_ENV=development` plus explicit `--confirm-development-target` is an operator attestation permitting the owned remote development target, not an automatic production-safety claim; production always refuses. The seed is idempotent and non-destructive, secrets are never printed, and redacted target metadata is recorded. Tag live evidence `real-postgres` only after actual successful proof; otherwise classify it `external-blocked`/deferred. No six `TUS_TEST_*` variables or alternate URL source is introduced. Preserve evidence classes `deterministic`, `browser/mobile`, and `deployment` for the remaining scope.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/prisma`, `apps/api/src`, `scripts`, `tests/integration/tus` | Modified | DB/POS audit and evidence |
| `apps/web`, `apps/mobile`, deployment manifests, env/runbooks | Modified | Runtime/deployment conformance |
| `openspec/changes/tus-real-db-runtime-audit` | New | Proposal and later artifacts |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Unsafe/unknown target | High | Fail closed; preserve zero-side-effect evidence |
| Free-tier slowness, lock, or outage | High | 60s + one retry; cleanup and deadline evidence |
| False production confidence | Med | Separate evidence classes and external blocks |

## Rollback Plan

Revert only this change’s code, migrations, tagged fixtures, tests, and artifacts. Never delete untagged data or alter unrelated work; stop and retain redacted evidence on any bound failure.

## Dependencies and Operational Deadlines

- Existing canonical safety proof and root `.env`; no secret values in artifacts.
- DB attempt budget: 120s total; HTTP/browser actions: 30s each; each phase: 15 minutes. Single PR, approved size exception, review budget `99999`.

## Success Criteria

- [ ] Every phase has finite execution, cleanup, and classified evidence.
- [ ] With proof: migration, two-run seed, no-duplicate checks, tenant/POS/replay/recovery pass with zero provider calls.
- [ ] Without proof: exact existing denial reasons remain and all DB side-effect counts stay zero.
- [ ] Local/Render/Vercel variables and contracts are normalized without secrets or unsupported production claims.

## Proposal question round

Correct or skip before specs: mandatory authenticated product/service journeys; audit/outbox retention window; approved non-production Render/Vercel target; overall deadline if proof remains unavailable.
