# Neutral Reference Validation Evidence

P5.6 records deterministic, provider-free evidence that the neutral reference boundary
remains reusable across the API, web, mobile, and Python runtime surfaces.

## Commands

```text
node --experimental-strip-types --test tests/foundation/p5-reference-validation.test.mjs
node apps/api/node_modules/tsx/dist/cli.mjs scripts/validation/reference-parity.ts
node --experimental-strip-types scripts/validation/contamination.ts
```

The validation harness uses only the in-memory neutral API, deterministic reference
clients, local cloud plan fixtures, and the Python worker's local contract path. It
does not read `.env`, call cloud/provider/database services, or use credentials.

## Evidence classes

| Surface or gate            | Result                                                                             | Evidence             |
| -------------------------- | ---------------------------------------------------------------------------------- | -------------------- |
| API contract client        | Pass                                                                               | `parity.json`        |
| Web contract client        | Pass                                                                               | `parity.json`        |
| Mobile contract client     | Pass                                                                               | `parity.json`        |
| Python runtime             | Pass when local runtime dependencies are available; otherwise unavailable/deferred | `parity.json`        |
| Render-native plan fixture | Pass, shape only                                                                   | `parity.json`        |
| AWS Terraform plan fixture | Pass, shape only                                                                   | `parity.json`        |
| Authorized cloud smoke     | Unavailable/deferred                                                               | `parity.json`        |
| Contamination scan         | Pass, zero findings                                                                | `contamination.json` |

Cloud plan/validation is not live conformance. Missing credentials, quotas, or managed
resources must remain an explicit unavailable/deferred disposition.

## Scenario coverage

- Cross-tenant search returns no foreign records and cross-tenant update is
  denied.
- Invalid verification fails without changing state.
- Retrying an idempotent notification produces no duplicate effect.
- A bad reference release is restored to the last passing state without
  removing neutral contracts.
- Client modules delegate to the neutral API and do not contain policy stores,
  provider calls, environment loading, or fallback imports.
