# Native Smoke Evidence

## Scope

This document records only the Docker-free native API/web smoke. It is not
production-readiness evidence and it does not close the Docker Compose gate.

## Execution record

| Check | Command / result |
|---|---|
| API wrapper | `cd backend && pnpm run dev` — PASS; native process served on port 3001 |
| Web wrapper | `cd frontend && pnpm run dev` — PASS; native page returned HTTP 200 on port 3000 |
| API health/readiness | `/health` HTTP 200; `/ready` HTTP 200 |
| PostgreSQL | `required/ready`; connectivity verified by native readiness; URL omitted |
| Dependency reports | MongoDB `disabled/ready`; Redis `disabled/ready`; Python worker `disabled/ready`; mobile support `fake/ready`; external providers `disabled/ready` |
| Secret boundary | PASS; diagnostics report only `database-configured=true`; no URL value or copied `.env` recorded |
| Required focused tests | `pnpm test -- foundation` — PASS, 29/29; this forwards the `foundation` argument to the same `scripts/test-runner.mjs` that enumerates all foundation tests |
| Foundation alias comparison | `pnpm test:foundation` — PASS, 29/29; equivalent result and test set to `pnpm test -- foundation` |
| Full tests | `pnpm test` — PASS, 29/29 |
| Secret scan | `pnpm security:scan` — BLOCKED by pre-existing secret-like content in `apps/api/backendFiles/FRONTEND_GROQ_MODULES.md`; value not reproduced |
| Rollback | PASS; deterministic local scenario stops traffic before partial serving, preserves replayable ledger/outbox/DLQ records, restores the last passing version, and records version/reason/health evidence |

## Deterministic rollback evidence

The provider-free scenario is executed with:

```text
node --experimental-strip-types --test tests/foundation/p0-native-rollback.test.mjs
```

Result: **PASS, 3/3 tests**. The scenario records this ordered contract:

1. `native-p0.6a-failing` reports `ready=false` for `postgres-unavailable`.
2. Traffic is stopped before partial serving; zero requests are accepted while
   the failing version is active.
3. The committed ledger record, pending transactional outbox record, and eligible
   DLQ record are preserved and remain replayable; the input records are unchanged.
4. `native-p0.6a-last-pass` is restored and health is verified as `ready=true`.
5. Traffic resumes only after health verification.

The evidence record includes deployed/restored version, rollback reason, operator,
timestamp, and both failing/restored health reports. This is local scenario
evidence, not Compose or production traffic evidence.

## Acceptance status

Native evidence is accepted only for developer smoke. **Compose gate: open/unverified.**
Docker Compose acceptance is separate until its own config, startup, and readiness
commands run successfully.
