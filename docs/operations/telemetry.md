# Telemetry and Governance Evidence

This runbook defines the provider-neutral evidence contract for traces, metrics,
audit events, security findings, budgets, quotas, and alerts. It applies to the
native deterministic harness and to the explicitly selected `aws-terraform`
profile. The Terraform modules are contract-only by default: they do not
provision resources or claim live conformance.

## Evidence contract

The shared TypeScript package `@factory/observability` emits the
`factory.operations.v1` record. Every record keeps these channels separate but
correlated:

| Channel          | Evidence                                                                        | Cloud-native destination                                                 | Required redaction                             |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| Trace            | trace/span IDs, parent relationship, status, timing, correlation, tenant, actor | OTel-compatible collector and CloudWatch-compatible export               | payloads, credentials, authorization headers   |
| Metric           | name, value, bounded dimensions, timestamp                                      | CloudWatch metrics                                                       | payloads, user content, secret-like dimensions |
| Audit            | action, outcome, tenant, actor, correlation, details                            | CloudTrail management/data-event evidence and the application audit sink | tokens, keys, passwords, provider payloads     |
| Security finding | source, finding ID, severity, status, summary                                   | GuardDuty, Security Hub, Inspector                                       | raw evidence payloads and credentials          |
| Budget/quota     | limit, used, remaining, status, threshold alert                                 | AWS Budgets and Service Quotas                                           | account secrets and unbounded identifiers      |
| Alert            | stable name, status, redacted reason                                            | CloudWatch alarms and owner-scoped routing                               | secret values and raw provider errors          |

The deterministic implementation uses injected time and IDs. A normal local
run may use runtime IDs, while evidence fixtures must inject a fixed clock and
ID prefix so repeated runs produce the same trace and metric records.

## Redaction rules

1. Never include `.env` contents, credentials, authorization headers, tokens,
   passwords, private keys, provider request bodies, or model/user payloads.
2. Redact by sensitive key (`authorization`, `token`, `secret`, `password`,
   `apiKey`, `credential`, and `privateKey`) before a record is emitted.
3. Redact secret-like strings even when a caller uses a non-sensitive key.
4. Keep tenant, actor, request, correlation, and trace identifiers only as
   bounded context fields needed for isolation and diagnosis.
5. Findings and alerts contain a stable category/reason, never the matched
   secret or raw provider response.

The expected replacement marker is `[REDACTED]`. Scanners and tests must report
only paths, categories, or stable IDs; they must never print a matched value.

## Profile evidence classes

| Class                    | Meaning                                                                  | Live claim                  |
| ------------------------ | ------------------------------------------------------------------------ | --------------------------- |
| `native-smoke`           | Deterministic package and local profile behavior                         | No                          |
| `cloud-plan-validation`  | Terraform/module shape, metadata, and policy validation                  | No                          |
| `authorized-cloud-smoke` | Owner-authorized execution against provisioned resources                 | Only with matching evidence |
| `unavailable-deferred`   | Missing credentials, quota, resource, owner approval, or provider access | No                          |

Plan validation is not a deployment and is not a substitute for CloudWatch,
CloudTrail, GuardDuty, Security Hub, Inspector, Budgets, or Service Quotas live
evidence. Missing or expired cloud evidence keeps readiness non-production-ready
while deterministic local/fake verification remains valid.

## Threshold and alert behavior

- A budget is `ok` below its warning threshold, `warning` at or above the
  threshold, and `exhausted` at or above its limit.
- A quota follows the same states and must be evaluated per tenant/product
  scope where the capability is tenant-scoped.
- `budget.warning`, `budget.exhausted`, `quota.warning`, and
  `quota.exhausted` are stable alert names.
- Exhaustion is fail-closed for the affected operation. It must not silently
  switch providers or bypass the ledger.
- Alert routing is owner-scoped and reversible. Disablement preserves the last
  evidence record and the durable application ledger.

## Cloud control mapping

The Terraform service catalogs declare one owner, configuration reference,
rollback reference, security policy, data policy, cost policy, and deterministic
fake for every control. The default activation is
`disabled-until-approved`; the profile flag is the only activation decision.

- `observability`: OTel compatibility, CloudWatch logs/metrics/alarms, and
  redacted trace/metric evidence.
- `security`: IAM/STS/KMS, CloudTrail, GuardDuty, Security Hub, Inspector, and
  normalized security findings.
- `governance`: AWS Budgets, Service Quotas, and owner-scoped alerts.

No CDK, provider block, backend, credential, or resource is introduced by this
contract slice. Terraform remains the sole IaC authority.

## Rollback and incident handling

1. Stop or drain traffic before disabling a failing exporter or threshold
   profile.
2. Revert to the last passing module/profile configuration and record version,
   reason, operator, and redacted health evidence.
3. Preserve the PostgreSQL ledger, outbox, and DLQ; replay only through the
   existing idempotent recovery path.
4. If a secret may have entered telemetry, follow
   `docs/security/incident-response.md`: revoke, rotate in the approved secret
   store, remove without reproducing the value, assess audit access, and record
   the returned evidence gate.

## Deterministic verification

Run the focused test and then the full suite:

```text
node --experimental-strip-types --test tests/foundation/p6-observability.test.mjs
pnpm test
```

If the Terraform CLI is available, additionally run `terraform fmt -check` and
`terraform validate` independently in each environment. If it is unavailable,
record deterministic static catalog validation and do not claim Terraform
execution or live cloud conformance.
