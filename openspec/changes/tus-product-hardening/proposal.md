# Proposal: TUS Product Hardening

## Intent

Make the implemented TUS product reproducible and evidence-based across PostgreSQL, API, web, mobile, and POS workflows. Address durable POS gaps, environment drift, process leaks, and overstated provider/cloud/compliance claims. Only `Goldenrepo-js-py` is in scope; the empty `Goldenrepo-js_py` scaffold is excluded.

## Scope

### In Scope
- Load root `.env` `DATABASE_URL` internally; require explicit local/test intent before any connection, migration, or write.
- Add explicit idempotent fixtures; harden Prisma schema/migrations, tenant constraints/indexes, state transitions, product/service POS transactions, audit/outbox, replay, and recovery.
- Map environment consumers before normalization; bound child cleanup; audit real API/web/mobile/POS behavior with bounded browser tooling/screenshots; prepare local, Render, and Vercel paths.

### Out of Scope
- Destructive reset, unapproved/shared/production writes, secret emission, provider activation, cloud provisioning, compliance approval, or unsupported production claims.
- Physical hardware/native-device certification, broad redesign, unproven-unused variable removal, or edits to unrelated OpenSpec changes.

## Capabilities

### New Capabilities
- `tus-product-hardening`: Safe persistence, fixtures, lifecycle cleanup, evidence, and deployment reproducibility.

### Modified Capabilities
- None; `openspec/specs/` contains no existing capability specifications.

## Approach

Deliver one PR through gated phases:
1. **Safety:** map consumers, validate manifests/startup, load root `.env` without logging it, refuse production profiles, and require existing local/test intent plus explicit seed intent.
2. **Durability:** seed explicitly; validate additive migrations/tenant isolation; prove atomic product/service POS, idempotency, conflicts, audit/outbox, transitions, restart/replay, and recovery on approved PostgreSQL.
3. **Runtime:** expand bounded API smoke and child cleanup; exercise authenticated web/mobile/POS with Playwright/Chrome DevTools/screenshots; classify unavailable hardware/device evidence.
4. **Deployment:** reproduce local startup and validate Render/Vercel build/start contracts; keep external gates fail-closed.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/prisma`, `apps/api/src/tus` | Modified | Schema, tenancy, POS, audit/outbox, recovery |
| `scripts`, `tests/integration/tus` | Modified | Env safety, smoke, cleanup |
| `apps/web`, `apps/mobile`, manifests/docs | Modified | Journeys and reproducible startup |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `DATABASE_URL` is unsafe | High | Fail closed until disposable ownership is proven |
| Migration/transaction regression | Med | Additive validation, checkpoints, real PostgreSQL evidence |
| One-PR review overload | High | Independently verifiable phases, evidence index, requested 99999-line budget |

## Rollback Plan

Revert by phase; never reset. Restore prior artifacts, stop owned children in `finally`, quarantine/delete only tagged fixtures, and use backups or migration-specific recovery for an approved target. Preserve audit/evidence records.

## Success Criteria

- [ ] Unsafe targets produce zero side effects and no secret leakage.
- [ ] PostgreSQL evidence proves fixtures, tenant isolation, product/service POS durability, audit/outbox, replay, recovery, and cleanup.
- [ ] Evidence is tagged `deterministic`, `real-postgres`, `browser/mobile`, `deployment`, or `external-blocked`; claims remain fail-closed.
- [ ] Local and Render/Vercel startup is reproducible with no orphaned processes.
