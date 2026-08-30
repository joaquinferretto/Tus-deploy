# TUS Work Unit 7 deployment evidence

## Truth boundary

This is deterministic repository evidence for Work Unit 7. No live provider,
legal, database, browser, device, POS, or production smoke was available or
claimed. `liveConformance` is `false` for the provider-free profile checks;
unavailable evidence remains `unavailable-deferred` and fail-closed.

## Executed checks

| Evidence | Command / exact result | Class |
| --- | --- | --- |
| WU7 focused contract | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-deployment.test.mjs` — exit 0; 7 passed, 0 failed, 0 skipped | deterministic-test-only |
| Full test runner | `pnpm test` — exit 1; 361 total, 352 passed, 9 failed. The 9 failures are pre-existing P5.5/P5.6/P6.6/P6.9 traceability, contamination, and portability failures outside WU7; all 7 WU7 tests passed | deterministic-test-only |
| Build | `pnpm build` — exit 0; Turbo completed 4 build tasks successfully, including API and web | deterministic build |
| Contracts | `pnpm contracts:validate` — exit 0; 90 JSON Schema contracts validated. Existing AJV unsupported-format warnings for `date-time`, `uri`, and `email` remain | deterministic contract |
| API build | `DATABASE_URL=postgresql://user:password@localhost:5432/tuscompras pnpm --filter @factory/api build` — exit 0; Prisma generation and TypeScript compilation passed | deterministic build |
| Cloud profile validation | `pnpm exec node scripts/validation/cloud-native/validate-plan.mjs` — exit 0; Render and AWS fixtures valid, provisioned=false, cloudCalls=false, liveConformance=false | cloud-plan-validation |
| HTTP/runtime harness | `pnpm exec node --experimental-strip-types --test tests/foundation/p8-tus-operations.test.mjs` — exit 0; 7 passed, 0 failed, 0 skipped through the in-process authenticated Express harness | deterministic-test-only |
| Security scan | `pnpm run security:scan` — exit 0 | deterministic policy |
| Policy validation | `node scripts/security/validate-policy.mjs` — exit 0 | deterministic policy |

## Readiness result

`pnpm exec node scripts/activation/tus-readiness.mjs render-native` returns
`status: not-production-ready`, `disposition: unavailable-deferred`,
`liveConformance: false`, and base API/web/worker flags only. TUS routes,
provider actions, release jobs, and fleet jobs remain disabled because no
authorized evidence was supplied.

## Deferred evidence

The following are intentionally not attached or inferred: Argentina legal and
tax approval, KYC/KYB, Mercado Pago/provider smoke, AWS/Groq approval,
PostgreSQL/managed-service smoke, browser/PWA smoke, physical-device/POS
pilot, and production operational smoke. These gates must be supplied as
separate scoped, current, owner-authorized records before activation.

## Rollback boundary

Revert only Work Unit 7 deployment flags, readiness evaluator/report, CI build
step, web deployment mode, evidence documentation, runbook additions, and the
WU7 test. Preserve Work Units 1–6, TUS migrations and contracts, commitments,
ledger, audit, outbox, DLQ, and unrelated profile state.
