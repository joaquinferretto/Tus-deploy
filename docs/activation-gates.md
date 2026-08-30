# Provider Activation Gates

This document is the activation boundary for paid or live provider execution.
Local development and CI use deterministic fakes or injected transports only.
No adapter discovers credentials, reads `.env`, calls a cloud SDK, or silently
falls back to a paid service. The deterministic evaluator in
`scripts/activation/index.mjs` and `scripts/activation/tus-readiness.mjs` are
provider-free enforcement points for these decisions; they accept evidence,
never discover it.

## Required evidence

An AWS AI adapter is **gated** until every requirement below is true for the
selected product profile:

| Gate             | Required evidence                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Credits          | The owning AWS account has an approved credit/budget allocation for the capability.                                        |
| Credentials      | A scoped secret-store reference and least-privilege credentials are approved; values never enter code, logs, or artifacts. |
| Region           | The configured AWS region has approved service/model availability. An empty or unapproved region is denied.                |
| Quota            | Service Quotas and tenant/product hard limits are configured with an exhaustion and rollback plan.                         |
| Owner approval   | The capability owner approves the profile, data/retention policy, cost boundary, and live smoke scope.                     |
| Live conformance | An authorized, evidence-backed smoke test passes through the injected adapter boundary.                                    |

The gate is fail-closed: setting a feature flag or supplying a transport does
not bypass missing evidence. A denied activation preserves the local fake and
returns a redacted unavailable result. Rollback disables the adapter while
leaving neutral contracts and replayable durable work intact.

## Deterministic activation contract

`evaluateActivation({ target, mode, evidence })` has three provider-free modes:

| Mode                         | Result                                                | Live conformance            |
| ---------------------------- | ----------------------------------------------------- | --------------------------- |
| `fake`                       | `available`, `local-fake`, `deterministic-local-fake` | `false`                     |
| `live` with any missing gate | `unavailable`, `denied`, `unavailable-deferred`       | `false`                     |
| `live` with every gate       | `active`, `active`, `authorized-live`                 | `true` for that target only |

The unavailable result includes the exact missing gate keys, the redacted reason,
and `localFake: preserved`. It is an explicit unavailable/deferred disposition,
not a successful smoke result. The evaluator has no environment, filesystem,
cloud SDK, database, or credential access.

The six required evidence keys are `credits`, `credentials`, `region`, `quota`,
`ownerApproval`, and `liveConformance`. A blank region or any false/missing
boolean denies activation. Supplying an injected transport does not waive the
gate.

Every paid/live AWS, SES, and provider smoke uses the same gate. The scoped
targets are:

- `bedrock`
- `bedrock-guardrails`
- `transcribe`
- `polly`
- `textract`
- `rekognition`
- `translate`
- `ses`
- `s3`
- `sqs`
- `eventbridge`
- `lambda`
- `cloudwatch`
- `iam`
- `kms`
- `cloudtrail`
- `guardduty`
- `security-hub`
- `inspector`
- `backup`
- `budgets`
- `service-quotas`
- `aws`
- `provider-smoke`

The target list is intentionally explicit so a new paid/live smoke cannot be
treated as an implicit exception. An unlisted live target returns
`unavailable-deferred` with `target-policy` and `liveConformance: false`.
Bedrock Agents and Flows remain excluded.

## AWS AI adapter catalog

| Adapter                       | Port / deterministic local fake                              | Live state before evidence | Owner boundary        |
| ----------------------------- | ------------------------------------------------------------ | -------------------------- | --------------------- |
| Bedrock models and multimodal | `BedrockAdapter` / `DeterministicBedrockFake`                | Gated                      | AI Platform / Runtime |
| Bedrock Guardrails            | `BedrockGuardrailsAdapter` / `DeterministicGuardrailsFake`   | Gated                      | AI Safety / Runtime   |
| Transcribe                    | `BedrockTranscribeAdapter` / `DeterministicTranscribeFake`   | Gated                      | AI Platform / Runtime |
| Polly                         | `BedrockPollyAdapter` / `DeterministicPollyFake`             | Gated                      | AI Platform / Runtime |
| Textract                      | `BedrockTextractAdapter` / `DeterministicTextractFake`       | Gated                      | AI Platform / Data    |
| Rekognition labels/moderation | `BedrockRekognitionAdapter` / `DeterministicRekognitionFake` | Gated                      | AI Safety / Runtime   |
| Translate                     | `BedrockTranslateAdapter` / `DeterministicTranslateFake`     | Gated                      | AI Platform / Runtime |

Bedrock Agents and Flows are excluded. Rekognition facial identity is excluded
by default. LangGraph remains the sole orchestration authority.

## Current provider disposition

Groq remains active as the configured provider where its existing activation and
injected transport are configured. The local fake remains the default
provider-free path. In the evaluator, Groq's `active` mode requires only its explicitly
configured injected transport and reports `active-provider`; it does not claim
AWS live conformance. AWS credits or live credentials are not assumed, and no
live conformance claim is made by local tests.

## Denied activation disposition

When any gate is absent, the result must remain equivalent to:

```json
{
  "status": "unavailable",
  "activation": "denied",
  "disposition": "unavailable-deferred",
  "liveConformance": false,
  "localFake": "preserved"
}
```

The result is deterministic and safe to persist as evidence. It must name the
missing gate(s), never include secret values or provider payloads, and never be
reclassified as live conformance by a plan, feature flag, fake, or injected
transport.

## Rollback

Disable the affected adapter flag, preserve the run ledger/outbox and local
fake, and replay only explicitly eligible work after a new conformance record.
Never enable a broader credential or delete neutral contracts as a rollback.

## TUS Argentina Stage 1 readiness

TUS production publication, provider actions, settlement, fleet operations, and
release jobs are separate capabilities. Each capability is disabled until its
required evidence is valid, scoped to the tenant and Argentina Stage 1 pilot,
unexpired, and not revoked. Deterministic tests can exercise the evaluator but
are always `deterministic-test-only`; they never authorize production activity.

### Canonical TUS evidence taxonomy

TUS readiness reports use exactly four evidence classes:

| Class | Boundary | Production meaning |
| --- | --- | --- |
| `local-deterministic` | Provider-free Node 22 tests, builds, contracts, policy, and plan shape | Supporting evidence only; never live authorization |
| `local-postgresql-http` | An actually executed authorized local PostgreSQL HTTP restart/replay smoke | Local durability only; never managed-service or production conformance |
| `authorized-external` | Current owner-authorized evidence for one profile, tenant, capability, and scope | May satisfy only that exact live gate |
| `deferred` | Missing, unavailable, expired, revoked, malformed, unauthorized, or out-of-scope evidence | Hard blocker; no live or production-readiness claim |

The complete current status is maintained in
[`docs/evidence/readiness/tus-matrix.md`](evidence/readiness/tus-matrix.md).
When PostgreSQL, provider, cloud, browser, device, legal, tax, KYC/KYB, POS
pilot, or production-operations evidence is missing, the activation output MUST
remain `not-production-ready`, `unavailable-deferred`, and
`liveConformance: false`. A deterministic check, Terraform/Render plan, local
fake, or partial authorized record cannot promote the overall report.

### Evidence ownership

| Gate | Evidence owner | Applies to | Required record |
| --- | --- | --- | --- |
| `legal` | Legal and Compliance | All production TUS capabilities | Approved Argentina operating model and policy reference |
| `kyc` | Trust and Safety / Identity | Provider actions, settlement, fleet, and release jobs | Actor/provider identity verification reference |
| `kyb` | Marketplace Operations / Compliance | Publication and all money-moving capabilities | Merchant business verification reference |
| `tax` | Finance and Tax | Publication and all money-moving capabilities | Country tax and invoicing approval reference |
| `mercadoPago` | Payments / Provider Operations | Provider actions, settlement, and release jobs | Approved account/product/contract validation |
| `posPilot` | POS Product and Operations | Settlement, fleet, and release jobs | Authorized hardware and operational pilot evidence |
| `aws` | AI Platform / Runtime | Provider actions and settlement | Approved AWS target/provider evidence |
| `groqMigration` | AI Platform / Runtime | Provider actions and settlement | Transitional parity, fallback, and retirement backlog |
| `runtimeProvider` | Runtime Operations | Publication and all operational capabilities | Runtime/provider readiness and smoke evidence |

Every readiness evidence record preserves `owner`, `scope`, `evidenceType`,
`evidenceRef`, `policyVersion`, `expiresAt`, and `revoked` status. Evaluation
records the exact evidence IDs and failed gate reasons. Missing, out-of-scope,
expired, or revoked evidence fails closed; it never falls back to a deployment
boolean, provider credential, or client claim.

### Rollback boundary

Revoking evidence or requesting pilot rollback disables the affected TUS
capability and its provider/release/fleet actions. The readiness decision keeps
the evidence IDs and audit references readable, and any financial correction is
an append-only compensating entry. Neutral factory contracts and unrelated
capabilities remain untouched.

## PR10 activation report

Run the provider-free report without credentials or network access:

```bash
node scripts/activation/tus-readiness.mjs render-native
node scripts/activation/tus-readiness.mjs aws-terraform
```

The report is `tus.activation-report.v1`. It is a plan-only composition report:
`provisioned: false`, `cloudCalls: false`, and `liveConformance: false` until
the complete applicable evidence envelope is supplied as input by an
owner-controlled process. With missing external evidence it uses the canonical
`deferred` class and says **no live authorization and no production readiness**
rather than inferring authorization from a flag, credential reference, Terraform
plan, local test, or fake transport.

## Independent TUS activation gates

The following gates are evaluated independently. A valid record for one gate
does not enable another gate, and a deployment profile cannot turn any of them
on by configuration alone:

| Gate | Required owner-controlled evidence | Default |
| --- | --- | --- |
| `mercadoPago` | Authorized account/product contract and provider smoke | Disabled |
| `whatsapp` | Authorized sender, callback, consent, and provider smoke | Disabled |
| `aws` | Approved AWS target, credentials reference, quota, and smoke | Disabled |
| `render` | Approved Render service/resource and authorized smoke | Disabled |
| `cloud` | Profile-specific cloud conformance and rollback evidence | Disabled |
| `legal` | Argentina operating model and policy approval | Disabled |
| `tax` | Tax/invoicing and country-specific approval | Disabled |
| `kyc` | Actor/provider identity verification | Disabled |
| `kyb` | Merchant business verification | Disabled |
| `postgresql` | Authorized endpoint, backup, migration, and HTTP restart/replay smoke | Disabled |
| `browser` | Authorized browser matrix and production-like UI smoke | Disabled |
| `device` | Authorized mobile/device matrix and recovery smoke | Disabled |
| `posPilot` | Authorized hardware, operator, receipt, and pilot evidence | Disabled |
| `productionOperations` | On-call, monitoring, incident, rollback, and runbook sign-off | Disabled |

The deployment composition flags `tusRoutes`, `providers`, `releaseJobs`, and
`fleetJobs` remain disabled unless every gate required by that capability is
current and authorized. Publication, payment, WhatsApp, AWS, PostgreSQL,
browser/device, POS, release, and fleet decisions are therefore separate
failure domains rather than one broad production switch.

## Evidence ownership, expiry, and revocation

Each activation record MUST include all of the following fields:

```json
{
  "evidenceId": "evidence-<gate>",
  "approved": true,
  "approvalStatus": "approved",
  "profile": "render-native or aws-terraform",
  "scope": "tus-stage-1-pilot",
  "owner": "accountable team or role",
  "evidenceType": "authorized-smoke or approval record",
  "evidenceRef": "owner-controlled reference; never a secret value",
  "policyVersion": "tus-activation.v1",
  "issuedAt": "ISO-8601 timestamp",
  "expiresAt": "ISO-8601 timestamp or null",
  "revoked": false,
  "source": "authorized-external"
}
```

An issued-in-the-future, expired, revoked, malformed, deterministic, deferred,
unauthorized, or out-of-profile record fails closed. Expiry is checked at every
activation decision, not only when a report is generated. Evidence references,
owners, expiry, and revocation state may be audited; secret values, provider
payloads, tokens, and personal data MUST NOT be copied into reports or logs.
Conflicting current records are a blocker and require owner reconciliation.

## Safe disablement, drain, and quarantine

When evidence is revoked, expires, or a pilot rollback is requested:

1. Stop new intake for the affected capability and set its activation flag to
   `false`; do not silently substitute another provider or Compose.
2. Keep unrelated tenant and provider paths isolated.
3. Drain safe in-flight work; quarantine unsafe, ambiguous, or failed work with
   a redacted reason and correlation identifier.
4. Preserve PostgreSQL business state, audit records, evidence history, the
   transactional outbox, run ledger, retry metadata, and DLQ.
5. Reconcile before replay. Financial corrections are append-only compensating
   entries; destructive ledger rollback and destructive down-migrations are
   forbidden.
6. Re-enable only after a new current owner-approved record and the relevant
   deterministic, security, policy, and authorized smoke checks pass.

The activation report includes a rollback plan with `stopIntake`, `drain`,
`quarantine`, preserved `audit/evidence/ledger/outbox/dlq`, and
`destructiveRollback: false`. Excluded scopes remain disabled permanently for
this MVP: `global-launch`, `rentals`, `regulated-healthcare`,
`financing-credit`, `custody-escrow`, `open-driver-bidding`, `mature-dispatch`,
`warehouse-automation`, and `unbounded-ai-authority`.

## Provider-free deployment plans

`render.yaml`, `infra/terraform/environments/render/main.tf`, and
`infra/terraform/environments/aws/main.tf` declare the API, web, workers, TUS
routes, providers, release jobs, fleet jobs, and all independent activation
switches. Their safe plan defaults keep external actions disabled while native
Render or Terraform AWS shape can be validated. A plan is not provisioning,
connectivity, authorized cloud smoke, legal approval, POS pilot, PostgreSQL
production evidence, browser/device evidence, or live provider authorization.
