# Native Smoke Evidence

## Scope and boundary

This receipt records the current Docker-free, provider-free local evidence only.
It is deterministic verification, not production-readiness, browser/device, POS
pilot, PostgreSQL durability, provider, cloud, compliance, or production evidence.
The Docker Compose gate is **open/unverified** and is not closed by this receipt.
The current repository-wide attempt is `pnpm test`: **exit 0; 498 passed, 0
failed, 0 skipped across 88 isolated suites** on Node 22. This is local
deterministic evidence only and does not authorize any deferred external gate.

## Current execution record

| Check | Command / exact result | Boundary |
|---|---|---|
| Full deterministic suite | `pnpm test` — **exit 0; 498 passed, 0 failed, 0 skipped across 88 isolated suites** | `local-deterministic`; provider-free serial runner; verified locally |
| Focused readiness/activation evidence | `pnpm test -- tests/foundation/p9-activation.test.mjs tests/foundation/p9-tus-runtime-readiness.test.mjs` — **exit 0; 2 suites, 17 passed, 0 failed** | `local-deterministic`; provider-free readiness fixture |
| Contracts | `pnpm contracts:validate` — **exit 0; 98 JSON Schema contracts validated**; AJV ignored `date-time`, `uri`, and `email` format warnings | `local-deterministic`; schema validation only |
| Typecheck | `pnpm typecheck` — **exit 0; 8 Turbo tasks successful** | `local-deterministic`; workspace type safety |
| Build | `pnpm build` — **exit 0; 4 Turbo tasks successful**; mobile has no build script | `local-deterministic`; local compilation only |
| Lint | `pnpm lint` — **exit 1; 3 tasks successful, 1 task blocked** because `@factory/mobile` lints the generated `dist/_expo` bundle outside its TypeScript project; 6 warnings also remain | `local-deterministic`; static analysis is blocked by generated output, not by this slice |
| Secret scan | `pnpm security:scan` — **exit 0; no tracked-secret findings** | `local-deterministic`; no credentials or provider calls |
| Policy | `node scripts/security/validate-policy.mjs` — **exit 0** | `local-deterministic`; policy structure only |
| Cloud plans | `pnpm exec node scripts/validation/cloud-native/validate-plan.mjs` — **exit 0; Render and AWS profiles valid, plan-only, provisioned=false, cloudCalls=false, liveConformance=false** | `local-deterministic`; synthetic plan shape, no provisioning |
| PostgreSQL HTTP smoke boundary | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` — **exit 0; 20 deferred-boundary tests pass; TUS_POSTGRES_URL and DATABASE_URL unavailable** | `local-postgresql-http` boundary is deferred; no authenticated PostgreSQL durability was executed |
| Render activation | `node scripts/activation/tus-readiness.mjs render-native` — **not-production-ready; unavailable-deferred; deferred; liveConformance=false**; TUS routes/providers/release jobs/fleet jobs disabled | `deferred`; no credentials or external calls |
| AWS activation | `node scripts/activation/tus-readiness.mjs aws-terraform` — **not-production-ready; unavailable-deferred; deferred; liveConformance=false**; TUS routes/providers/release jobs/fleet jobs disabled | `deferred`; no credentials or external calls |

All local rows above are supporting evidence only. A passing local check cannot
be relabeled `authorized-external` or used to claim production readiness.

## Deferred external evidence

The following boundaries remain unavailable or deferred and keep activation
fail-closed: PostgreSQL authenticated durability and managed-service recovery;
Mercado Pago, WhatsApp, AWS, Groq, and other provider smoke; cloud runtime
conformance; browser and screen-reader conformance; physical-device and POS
pilot evidence; legal, tax, KYC, and KYB approval; and production operations.
These boundaries require current, owner-authorized, profile-scoped evidence and
are not exercised by this local receipt.

The activation result remains `status: not-production-ready`,
`disposition: unavailable-deferred`, `evidenceClass: deferred`, and
`liveConformance: false`. No credentials, provider payloads, cloud resources, or
production traffic were accessed. Excluded MVP scopes remain disabled.

## Superseded history

The following statements are historical and **superseded**, not current proof:

- The earlier `29/29` and `466 passed, 1 failed, 0 skipped across 87 isolated
  suites` snapshots are superseded by the current `498 passed, 0 failed, 0
  skipped across 88 isolated suites` attempt. The older all-green `464` snapshot
  is historical and does not override the current receipt.
- The earlier blocked secret-scan statement is superseded by the current
  `pnpm security:scan` exit-zero result; no historical scan status overrides it.

## Rollback boundary

Revert this receipt and the PR5 evidence assertions in
`tests/foundation/p9-activation.test.mjs` and
`tests/foundation/p0-native-boundaries.test.mjs` to remove only the current
evidence-refresh documentation checks. Do not change activation gates,
provider-disabled defaults, durable state, or any PR1–PR4 implementation. If a
deferred gate later fails, stop intake, drain or quarantine affected work,
preserve audit/evidence/ledger/outbox/DLQ state, and replay only after new
authorized evidence.
