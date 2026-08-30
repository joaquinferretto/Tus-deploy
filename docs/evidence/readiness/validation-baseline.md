# TUS validation baseline

## Truth boundary

This baseline covers Work Unit 1.1 / PR1 only. It makes local validation
repeatable and classifies the 19 audited failures recorded by the TUS production
completion audit. `local-deterministic` is limited to provider-free tests and
static checks. PostgreSQL HTTP, browser, device, provider, legal, cloud, and
pilot evidence is never inferred from these results.

Unknown failures block a completion claim. A known environmental failure is
reported with its cause and isolated rerun; it is not converted into a pass.

## Runner contract

`pnpm test` discovers deterministic suites in sorted order and starts one Node
22 strip-only test process per file with the repository's JavaScript-to-TypeScript
specifier loader and `--test-concurrency=1`. A file has a default
`120000ms` timeout, configurable with `TEST_FILE_TIMEOUT_MS`. A requested file
may be run directly with:

```text
pnpm test -- tests/foundation/p9-validation-baseline.test.mjs
```

The runner continues after a failed file so the full baseline reports all
known failures. A timeout, worker-init failure, or memory exhaustion is
classified as `environmental`; an unrecognized failure is `unexplained` and
blocks completion.

## Audited failure register

The initial audit recorded 361 tests, 342 passes, and 19 failures. The rows
below preserve that register while recording the corrective disposition and an
isolated rerun command for each item. Rows marked `resolved` must be rerun by
the current serial runner before they are used as completion evidence.

| ID | Baseline failure | Disposition | Owner | Isolated rerun |
|---|---|---|---|---|
| F01 | P1 auth lifecycle expected 81 schemas | resolved | contracts validation | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p1-auth-lifecycle.test.mjs` |
| F02 | P1 MFA/passkey/OAuth expected 81 schemas | resolved | contracts validation | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p1-mfa-passkeys-oauth-linking.test.mjs` |
| F03 | P4 AI capability expected 81 schemas | resolved | contracts validation | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p4-ai-capability.test.mjs` |
| F04 | P4 AI governance expected 81 schemas | resolved | contracts validation | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p4-ai-governance.test.mjs` |
| F05 | P5.4 reference-client worker initialization under concurrent load | resolved | validation runner / host resources | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p5-neutral-reference.test.mjs` |
| F06 | P5.5 neutral scan treated TUS contracts as neutral core | resolved | neutral reference boundary | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p5-fallback-boundaries.test.mjs` |
| F07 | P5.6 contamination scan inherited the same scope drift | resolved | neutral reference boundary | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p5-reference-validation.test.mjs` |
| F08 | P5.6 parity failed because contamination was invalid | resolved | neutral reference boundary | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p5-reference-validation.test.mjs` |
| F09 | P6.9 referenced the archived change at its former path | resolved | platform traceability | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p6-final-traceability.test.mjs` |
| F10 | P6.6 portability inherited contamination failure | resolved | profile portability | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p6-portability.test.mjs` |
| F11 | P6.6 profile-divergence subprocess exhausted worker resources | resolved | validation runner / host resources | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p6-portability.test.mjs` |
| F12 | TUS delivery/POS scenario exhausted memory | resolved | validation runner / host resources | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p8-tus-delivery-pos.test.mjs` |
| F13 | TUS finance provider-boundary scenario exhausted memory | resolved | validation runner / host resources | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p8-tus-finance.test.mjs` |
| F14 | TUS operations WhatsApp scenario exhausted memory | resolved | validation runner / host resources | `pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p8-tus-operations.test.mjs` |
| F15 | Historical API/build child exit `3221226505` | resolved | validation runner / host resources | `pnpm test -- tests/foundation/api-build-regression.test.mjs` |
| F16 | Historical resource contention during API build | resolved | validation runner / host resources | `pnpm test -- tests/foundation/api-build-regression.test.mjs` |
| F17 | Historical concurrent TypeScript/esbuild worker failure | resolved | validation runner / host resources | `pnpm test -- tests/foundation/api-build-regression.test.mjs` |
| F18 | Historical concurrent Prisma/esbuild worker failure | resolved | validation runner / host resources | `pnpm test -- tests/foundation/api-build-regression.test.mjs` |
| F19 | Historical test-process resource termination | resolved | validation runner / host resources | `pnpm test -- tests/foundation/p9-validation-baseline.test.mjs` |

The five historical resource rows are retained because the original audit
reported the process-level signature without stable per-test labels. They are
not silently discarded; the serial rerun either resolves them or produces a
new file-specific record. Any new signature is `unexplained` until triaged.

## Evidence record

| Check | Command | Result | Evidence class |
|---|---|---|---|
| Focused baseline tests | `pnpm test -- tests/foundation/p9-validation-baseline.test.mjs` | Exit 0; 14 tests, 14 passed, 0 failed, 0 skipped | `local-deterministic` |
| Full deterministic runner | `pnpm test` | Exit 0; 435 tests, 435 passed, 0 failed, 0 skipped across 73 files | `local-deterministic` |
| Build | `pnpm build` | Exit 0; Turbo reports 4 successful build tasks across 18 packages in scope | `local-deterministic` |
| Lint | `pnpm lint` | Exit 0; serial Turbo lint completed without interactive configuration or task-discovery errors | `local-deterministic` |
| Contract validation | `pnpm contracts:validate` | Exit 0; validated 98 JSON Schema contracts; Ajv emitted existing unknown-format warnings | `local-deterministic` |
| Security | `pnpm run security:scan` | Exit 0; tracked-secret scan completed with no findings | `local-deterministic` |
| PostgreSQL HTTP smoke | `pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs` | Deferred unless an authorized `TUS_POSTGRES_URL` and later authenticated harness are supplied | `local-postgresql-http` / `deferred` |

The smoke boundary is intentionally separate from the default deterministic
runner. A fake transport, in-memory composition, or unavailable database is
not labeled `local-postgresql-http` success.

## Rollback boundary

Revert only the validation runner/library and Node 22 loader, baseline tests, smoke-boundary test,
contamination-scope correction, stale contract assertions, archived
traceability reference correction, and this evidence document. No Prisma
migration, application behavior, provider activation, or durable data is
changed by Work Unit PR1.
