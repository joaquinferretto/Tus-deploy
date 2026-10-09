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

TUS production publication, provider actions, settlement, service payments,
fleet operations, and release jobs are separate capabilities. Each capability is disabled until its
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
| `legal` | Legal and Compliance | All production TUS capabilities (service payments included) | Approved Argentina operating model and policy reference |
| `kyc` | Trust and Safety / Identity | Provider actions, settlement, service payments, fleet, and release jobs | Actor/provider identity verification reference |
| `kyb` | Marketplace Operations / Compliance | Publication and all money-moving capabilities | Merchant business verification reference |
| `tax` | Finance and Tax | Publication and all money-moving capabilities | Country tax and invoicing approval reference |
| `mercadoPago` | Payments / Provider Operations | Provider actions, settlement, service payments, and release jobs | Approved account/product/contract validation |
| `posPilot` | POS Product and Operations | Fleet and release jobs; settlement only for an operation processed through the POS (never service payments) | Authorized hardware and operational pilot evidence |
| `aws` | AI Platform / Runtime | Provider actions and settlement, only when the process runs with the AWS deployment profile (never service payments) | Approved AWS target/provider evidence |
| `groqMigration` | AI Platform / Runtime | No capability asks for it today (PROVIDER-ACTIONS-GATES-01): nothing gated runs a model | Transitional parity, fallback, and retirement backlog |
| `runtimeProvider` | Runtime Operations | Publication and all operational capabilities | Runtime/provider readiness and smoke evidence |

Every readiness evidence record preserves `owner`, `scope`, `evidenceType`,
`evidenceRef`, `policyVersion`, `expiresAt`, and `revoked` status. Evaluation
records the exact evidence IDs and failed gate reasons. Missing, out-of-scope,
expired, or revoked evidence fails closed; it never falls back to a deployment
boolean, provider credential, or client claim.

### Technical enablement vs. public launch readiness (PAGOS-HABILITACION-TECNICA-01)

Two different questions, answered apart since 2026-10-07:

1. **Can a service payment be charged?** Only the real controls of the payment
   engine decide (`PoliticaCobroPersistida.disponibilidad`): the platform
   switch, `TUS_MERCADOPAGO_ENABLED`, the Mercado Pago environment, every
   credential and setting, the webhook secret and its https notification URL,
   the real provider adapter, a valid commission policy, the verified identity
   of the provider, and somebody able to collect (the provider's account or
   TUS's own). Idempotency, reconciliation, verified notifications and the
   single obligation per part are untouched.
2. **Is TUS ready to open payments to the public?** The six approvals recorded
   as evidence under `service-payments` (`legal`, `kyc`, `kyb`, `tax`,
   `mercadoPago`, `runtimeProvider`). They are reported as
   `public-launch-readiness`, each `pending`, `current` or `expired`, and they
   **do not block** a payment. This allows a closed test with real, low-amount
   payments without declaring TUS ready for launch.

The evidence stays stored under the `service-payments` key (nothing was
migrated or deleted); `public-launch-readiness` is the name it is exposed with
in `GET /tus/v1/admin/payments/status` (`technicallyEnabled`,
`publicLaunchReadiness`) and in Admin -> Pagos. The global `kyc` approval never
stands in for the identity of a provider: that one is checked per provider and
is still required to accept a priced turno and to collect earnings.

Where the deposit is chargeable, a service needs a published price to take a
turno (`SERVICE_PRICE_REQUIRED`). Before this change production without the
approvals fell back to "no deposit" and such a turno was confirmed for free.

### Service payments capability (`service-payments`)

`settlement` is the money gate of the general marketplace (products, delivery,
POS). It is **not** the gate of service payments. The deposit of a turno
(TURNOS-SENA-01) and the deposit and balance of a request-born work (W09-05),
charged through Mercado Pago Checkout Pro with Split 1:1, are authorized by
their own capability: `service-payments`.

| Capability | Required gates |
| --- | --- |
| `settlement` | `legal`, `kyc`, `kyb`, `tax`, `mercadoPago`, `runtimeProvider`; plus `aws` on the AWS runtime and `posPilot` for a POS operation (SETTLEMENT-GATES-01) |
| `service-payments` | `legal`, `kyc`, `kyb`, `tax`, `mercadoPago`, `runtimeProvider` |

Conditional gates of `settlement` (SETTLEMENT-GATES-01):

- `aws` is required only when the deployment profile of the process
  (`TUS_DEPLOYMENT_PROFILE`) is `aws-terraform`. On any other runtime it is
  reported as "not required in this runtime". The day TUS runs on AWS it is
  required again, with valid evidence, without anybody switching anything.
- `posPilot` is required only for an operation whose readiness request says
  `flow: 'pos'`. The POS itself is gated by `fleet`, where the pilot is always
  required.
- `groqMigration` is not a requirement of `settlement`: the assistant cannot
  block charges, commissions or settlements.

`provider-actions` (PROVIDER-ACTIONS-GATES-01) guards payment intents and
evidence of the legacy marketplace, the legacy provider webhooks and the
deterministic WhatsApp actions. None of them runs a model, so its core is
`legal`, `kyc`, `kyb`, `tax`, `mercadoPago`, `runtimeProvider`; `aws` is
conditional on the AWS deployment profile, exactly as in `settlement`, and
`groqMigration` is not asked. The assistant reports its own state (`/ready`).

Gates that do not apply to `service-payments`, and why:

- `posPilot`: no POS hardware or operator takes part in a service payment.
- `aws`: no AWS target is in the money path (API on Hostinger, Web on Vercel).
- `groqMigration`: the assistant never decides amounts, payments or states; a
  model-provider migration is unrelated to charging a deposit.

Rules:

- Evidence is recorded per capability. A `settlement` record never authorizes
  `service-payments`, and a `service-payments` record never authorizes
  `settlement`.
- The decision is evaluated for the platform tenant
  (`TUS_PLATFORM_ADMIN_TENANT_ID`, or `tus-platform` when unset), scope
  `argentina-stage-1`, and the deployment profile (`TUS_DEPLOYMENT_PROFILE`,
  default `render-native`).
- Evidence must be real and owner-authorized (`authorized-external`, current,
  unrevoked, one record per gate). No environment variable, feature flag or
  boolean replaces it. Writing rows by hand to simulate an approval is
  forbidden.
- Sandbox (`MERCADO_PAGO_ENVIRONMENT=sandbox`) moves no real money: the gate is
  reported but does not block, so the whole flow can be tested without
  production authorization. Production requires a valid decision before any
  charge; without it the reason is `PRODUCTION_NOT_AUTHORIZED`, no checkout
  is created, and a priced turno cannot be accepted
  (`SERVICE_PAYMENTS_NOT_AUTHORIZED`): it is never confirmed without its
  deposit. A turno without a price has no deposit and is unaffected.
- `GET /tus/v1/admin/payments/status` reports both gates under `readiness`
  (`servicePayments` and `settlement`, each with `authorized` and the
  `gate:reason` list it still lacks) and names the one being enforced
  (`readiness.gate = "service-payments"`).

Meaning of the identity gates for `service-payments`:

- `kyc` is the owner-approved record that provider identity verification is
  operating (IDENTITY-NOSIS: DNI, name and CUIL of the person). It is a
  platform-level record. Since 2026-10-09 no per-provider identity
  check is made on a charge: a provider is paid with its Mercado Pago linked
  (`PROVIDER_ACCOUNT_NOT_CONNECTED` otherwise).
- `kyb` is "merchant business verification". It is **not** met by identity
  data: a verified DNI, a valid CUIL or a linked Mercado Pago account do not
  amount to KYB, and nothing in the code treats them as such.

#### KYB for individual providers: what the domain holds today, and the gap

| Model | What it represents | Commercial verification? |
| --- | --- | --- |
| `verificaciones_identidad` (IDENTITY-NOSIS) | A natural person: DNI, name and a CUIL validated against the DNI | No. It proves who the person is, not their commercial or fiscal standing |
| `prestadores` | Operational record of a provider: cohort, location, status `approved`/`suspended` | No. `approved` is an operational status with no legal form or fiscal data behind it |
| `perfiles_publicos_prestador` | Public profile: name, trade, zone, services, prices | No |
| `cuentas_cobro_prestador` | The linked Mercado Pago account (account id, scopes, encrypted tokens) | No. Whatever Mercado Pago verified about its user is not recorded by TUS |
| `perfiles_fiscales` (billing) | Fiscal profile of a party: fiscal identity, fiscal category, status, evidence reference, external authority (`ARCA/AFIP-external`), external approval reference | It is the right shape, but nothing writes it for a provider: no onboarding step, no review, no link to `prestadores`, and no charge depends on it |

So the domain represents a **verified natural person**, not a **commercially
verified individual provider**. Missing, to represent the latter:

1. The provider's declared fiscal condition and fiscal identity as provider data
   (for an individual: the tax registration category and its tax id).
2. A verification status of that declaration, with who verified it, when,
   against which external authority and under which evidence reference.
3. A backend gate on charging that reads that status per provider, next to the
   existing identity gate.

Minimal modification proposed (**not implemented**; it depends on the
decisions below): reuse `perfiles_fiscales`, which already has those columns,
with the provider as the party (`parte_id` = the provider) instead of adding
tables; add a provider onboarding step that records the declaration, a
platform-admin review that sets its status, and a per-provider reason
(for example `PROVIDER_COMMERCIAL_PROFILE_NOT_VERIFIED`) in the availability
of the charge. The identity model and the existing gates stay as they are.

Decisions the repository cannot make, left to the owner with legal and tax
advice, and kept out of the code:

- Which document or external check constitutes KYB evidence for an individual
  provider, and for a company.
- Whether Stage 1 admits only individuals, and which fiscal categories.
- Who verifies it and how often it must be renewed.
- What the platform-level `kyb` record of `service-payments` must reference
  (the approved policy and the proof that the process is operating).

Until those are decided and recorded, `kyb` stays unmet and production
service payments stay blocked. The registry below can store the reference to
that evidence once it exists; it does not decide what the evidence is.

### Recording readiness evidence

Readiness evidence of the platform tenant is recorded through the payment
administration, never by writing rows by hand:

| Route | What it does |
| --- | --- |
| `GET /tus/v1/admin/payments/readiness/evidence` | Lists, per capability (`service-payments`, `settlement`), the required gates and every record with its status (`current`, `revoked`, `expired`, `not_yet_valid`) |
| `POST /tus/v1/admin/payments/readiness/evidence` | Records one reference for one requirement of one capability |
| `POST /tus/v1/admin/payments/readiness/evidence/:evidenceId/revoke` | Revokes a record, with a reason |

The Web shows the same in *Administración → Pagos → Evidencias de habilitación*.

- Authority: `tus:payments:admin`, which only an allowlisted, verified account
  gets and only an MFA-elevated session keeps, plus the platform tenant when
  `TUS_PLATFORM_ADMIN_TENANT_ID` is set. Checked on every request.
- The request may only say: `capability`, `gate`, `owner`, `evidenceType`,
  `evidenceRef`, `policyVersion`, and optionally `issuedAt` (not in the
  future) and `expiresAt` (in the future, or null). Any other field is refused
  (`UNTRUSTED_EVIDENCE_FIELDS`). Tenant, scope, profile, source
  (`authorized-external`), actor, identifiers and the revoked flag are set by
  the server.
- Only the capabilities evaluated for the platform tenant can be recorded
  (`service-payments`, `settlement`), and only with a gate that capability
  requires.
- A record holds a **reference** to the document its owner keeps (a minutes
  number, a file id, a document location). It never holds the document, a
  secret, a token, a credential, a provider payload or personal data: values
  with those shapes are refused (`SENSITIVE_EVIDENCE_VALUE`) and never echoed.
  That check is defense in depth; the administrator remains responsible for
  what is typed.
- One current record per requirement: a second one is refused
  (`EVIDENCE_ALREADY_CURRENT`) until the first is revoked or expires, and a
  reference is never reused for the same requirement
  (`EVIDENCE_REFERENCE_ALREADY_USED`). Records are never deleted.
- Every registration and revocation is written with its audit event
  (`readiness.evidence_registered`, `readiness.evidence_revoked`: actor,
  correlation id, capability, gate, reference, reason) in the same transaction.
- Renewal, **for `service-payments` only**: a revoked or expired record is
  history. Exactly one current authorized record satisfies its gate even when
  older revoked or expired records exist for it. Any other record next to it
  (deterministic, deferred, not yet valid, or a second current one) still
  blocks.
- `settlement` and every other capability keep the original rule, unchanged:
  any revoked or expired record of a gate blocks that gate, even next to a
  current one. Renewing `settlement` evidence after a revocation or an expiry
  is therefore not possible today; changing that is an owner decision.

Recording a reference does not make the evidence real: the administrator who
records it attests that the document exists and was approved by its owner.

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
