# Proposal: TUS Final Hardening

## Intent

Close the six concrete product-quality gaps identified by the TUS final audit so validation is deterministic, runtime activation is fail-closed, and the Argentina-first MVP readiness claim matches recorded evidence. This is a bounded hardening slice, not a new product surface.

## Scope

### In Scope
- Correct six failing tests and stale schema assertions to the canonical 98-schema contract without weakening coverage.
- Remove the Node 22 strip-only parameter-property incompatibility in WhatsApp TypeScript and make marketplace client/tests use the canonical versioned API path; retain server compatibility aliases only where needed.
- Repair root Turbo/package typecheck and lint commands/configuration so repeated validation is non-interactive and deterministic.
- Enforce `evaluateTusReadiness`/`reconcileReadinessDecision` consistently at runtime mutation routes and jobs, with fail-closed activation and no side effects on denied decisions.
- Add durable PostgreSQL HTTP smoke with restart/replay evidence when authorized local infrastructure is available; record unavailable runs explicitly.
- Reconcile stale SDD/docs claims and publish a truthful evidence/readiness matrix.

### Out of Scope
- External providers, cloud, browser, screen-reader, physical-device, POS pilot, legal/tax/KYC/KYB, or production evidence.
- Global launch, rentals, regulated verticals, financing, custody/escrow, open driver bidding, mature dispatch, warehouse automation, or unbounded AI authority.
- Changes to Argentina-first boundaries, financial authority, tenant authority, or provider activation claims.

## Capabilities

### New Capabilities
- `tus-validation-hardening`: clean, repeatable tests, contracts, typecheck, and lint gates.
- `tus-runtime-readiness-enforcement`: canonical readiness guards for routes and jobs.
- `tus-durable-http-evidence`: PostgreSQL-backed HTTP restart/replay proof and evidence labeling.
- `tus-mvp-readiness-truthfulness`: synchronized documentation and evidence status.

### Modified Capabilities
- None; no authoritative `openspec/specs/` capabilities currently exist.

## Approach

Use strict TDD: reproduce each failure, implement the smallest fix, and retain regression assertions. Standardize the versioned marketplace contract, centralize readiness guards at the application/runtime boundary, define an explicit root validation matrix, and make PostgreSQL smoke conditional on authorized infrastructure. Publish one traceable readiness matrix using the canonical `local-deterministic`, `local-postgresql-http`, `authorized-external`, and `deferred` classes. Local or partial evidence never promotes deferred live gates or emits a production-readiness claim.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `tests/foundation/`, `packages/contracts/`, `apps/api/src/tus/whatsapp/` | Modified | Test/schema/runtime compatibility fixes. |
| `apps/web/src/lib/tus-client.ts`, `apps/api/src/tus/http/`, `apps/api/src/tus/` | Modified | Canonical API versioning and readiness enforcement. |
| Root `package.json`, `turbo.json`, package configs | Modified | Deterministic typecheck/lint orchestration. |
| `tests/integration/tus/`, `docs/`, `openspec/changes/` | Modified | Durable evidence and truthful claims. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Guard placement misses a route/job | Medium | Enumerate mutation entry points and test denied side effects. |
| Local PostgreSQL is unavailable | Medium | Keep smoke conditional and report `deferred`, never fake success. |
| Compatibility cleanup breaks consumers | Medium | Canonicalize client/tests while retaining a tested server alias. |

## Rollback Plan

Revert only this change's tests, runtime guards, client/versioning edits, root validation configuration, smoke harness, and documentation. Disable guarded actions and quarantine/drain affected jobs; preserve commitments, audit/evidence, ledger, outbox, and migrations. Restore the prior compatibility alias if required.

## Dependencies

- Existing canonical readiness contracts and runtime composition.
- Node 22, pnpm/Turbo, and authorized `TUS_POSTGRES_URL` for live local smoke.
- No external provider or cloud credentials.

## Success Criteria

- [ ] `pnpm test` passes with zero unexplained failures and reports 98 schemas.
- [ ] `pnpm typecheck` and `pnpm lint` pass twice without prompts or task-discovery errors.
- [ ] Route/job tests prove missing, expired, revoked, conflicting, and out-of-scope readiness denies side effects.
- [ ] PostgreSQL HTTP smoke proves persistence across restart and replay when infrastructure permits; otherwise evidence is explicitly deferred.
- [ ] Docs and SDD artifacts state local evidence accurately and preserve all deferred external gates and MVP non-goals.

The final criterion is documentation truthfulness, not a production approval: PostgreSQL, provider, cloud, browser, device, legal, tax, KYC/KYB, POS-pilot, and production-operations evidence remains deferred or disabled until separately supplied by its owner.
