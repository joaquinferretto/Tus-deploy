# Design: TUS Real Database and Runtime Audit

## Technical Approach

Keep the existing five phase boundaries: (1) canonical hardening/profile inventory, (2) additive PostgreSQL and safe seed, (3) durable tenant POS, (4) owned runtime and browser/mobile evidence, and (5) canonical environment/deployment evidence. Phase 2 owns migration and tagged fixture writes; any later bounded runtime harness uses the same root `.env` target gate before transport and never broadens fixture scope. The approved remote free-tier database is allowed as a development target only when the operator supplies exact `NODE_ENV=development` and `--confirm-development-target`; the seed additionally requires the explicit `seed` command.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| URL authority | Read `DATABASE_URL` only from repository-root `.env`; ignore ambient, runner, CLI, legacy, and `TUS_TEST_*` URLs. | URL precedence or duplicate metadata variables | Prevents target drift and secret duplication. |
| Target gate | Refuse production unconditionally before URL parsing/connection. Permit the approved remote target only for exact development `NODE_ENV` plus explicit seed confirmation. The flag is user authorization, not proof of ownership, non-production, disposability, or production safety. | Hostname heuristics, profile labels, or confirmation as safety proof | Makes the approved operator action possible without converting attestation into a false safety claim. |
| Bounded execution | Bound every connection/start attempt to 60s, allow exactly one retry, close failed pools before retry, and never permit a third attempt. | Unbounded waits/retries | Controls free-tier outages and produces finite evidence. |
| Safe persistence | Use additive migrations; tagged/versioned/run-scoped upserts twice; verify stable identity, aggregate counts, zero duplicates, tenant isolation, and targeted cleanup only. | Reset, truncate, cascade, broad or untagged deletion | Preserves unrelated data and makes reruns idempotent. |
| Evidence | `real-postgres` is emitted only after an actual successful connection and seed proof. Gate failures and incomplete runs are `external-blocked`; deterministic, `browser/mobile`, and `deployment` evidence remain separate. | Promoting mocks or intent to live proof | Prevents unrun database behavior and production confidence from being inferred. |
| Process ownership | Preserve `OwnedChild` exact PID/cwd/argv validation and `finally` cleanup, including timeout, interruption, SIGTERM/SIGKILL escalation, and no-orphan verification. Unknown processes are never killed. | Name/port-based termination | Prevents collateral shutdown and orphaned helpers. |

## Data Flow

```text
root .env DATABASE_URL + explicit development attestation
→ production/refusal gate → 60s connect/start × 2 max
→ additive preflight/migrate → tagged seed twice → safe aggregates/tenant checks
→ POS durability/audit/outbox/replay/recovery → bounded browser/runtime/deploy phases
→ finally cleanup → redacted, separately classified evidence
```

## File Changes

| Paths | Action | Description |
|---|---|---|
| `scripts/test-runner-lib.mjs`, `scripts/postgres-seed.mjs` | Modify | Root-only URL resolution, remote development attestation gate, bounded retry, seed verification, redaction. |
| `scripts/dev/native-profile.mjs`, `scripts/audit/tus-runtime-audit.mjs` | Modify | Preserve exact owned-process lifecycle and phase receipts. |
| `apps/api/prisma/**`, `apps/api/src/tus/**`, `tests/integration/tus/**` | Modify | Additive schema, tagged fixtures, POS atomicity, isolation, replay, and recovery coverage. |
| Env examples, runbooks, manifests, evidence artifacts | Modify | Canonical consumers and static-vs-live deployment claims without secrets. |

## Interfaces / Contracts

```ts
type SeedInvocation = { command: 'seed'; nodeEnv: 'development'; confirmed: true }
type EvidenceTag = 'deterministic' | 'real-postgres' | 'browser/mobile' | 'deployment' | 'external-blocked'
type RedactedTarget = { source: 'root-dotenv-DATABASE_URL'; environment: 'development'; target: '<redacted>' }
```

The URL, credentials, tokens, cookies, PII, raw child output, and screenshot paths never enter receipts. Fixture cleanup accepts only the exact tag/version/run ID.

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit/contract | Root authority, exact development/flag gate, unconditional production refusal, redaction, retry count | Mocks; denied paths assert zero DB actions. |
| Integration | Additive migration, two-run aggregates, tenant isolation, product/service atomicity, audit/outbox replay/recovery, targeted cleanup | Approved remote development target only after the gate; provider calls remain zero. |
| Process/runtime | Ownership mismatch, deadlines, interruption, escalation, `finally` cleanup, browser/mobile/runtime receipts | Owned child fixtures and bounded Playwright/CDP actions. |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | Planned RED tests |
|---|---|---|---|
| Shell/process integration | Applicable | Exact ownership; 60s per attempt; one retry; timeout/interruption fails closed; cleanup verifies no owned PID remains. | PID/cwd/argv mismatch; timeout; interruption; SIGTERM/SIGKILL escalation. |
| Documentation-like paths | N/A — no executable-file classification changes. | N/A | None |
| Git repository selection | N/A — no Git automation. | N/A | None |
| Commit state | N/A — no commit automation. | N/A | None |
| Push state | N/A — no push automation. | N/A | None |
| PR commands | N/A — no PR automation. | N/A | None |

## Migration / Rollout

No destructive migration. Preflight precedes migration; any failure stops with redacted evidence and targeted cleanup only. Preserve POS/Postgres durability, browser/runtime/deployment phases, provider-zero behavior, and all exclusions: no provider capture/settlement/payout, production activation, hardware, compliance, credentials, alternate URL/metadata sources, cloud ownership proof, production success claim, review lifecycle, `sdd-verify`, or archive.

## Open Questions

None for the design; live evidence still requires the operator to intentionally execute the guarded command against the approved development target.
