# AWS Terraform deployment profile

AWS is an active cloud-native profile whose single infrastructure authority is
Terraform. CDK is not introduced in parallel, and this profile never silently
falls back to Compose or substitutes an undeclared service.

## Profile shape and parity

The selectable profile id is `aws-terraform`. Its Terraform environment is
`infra/terraform/environments/aws`, and its shape is the counterpart to the
Render-native Node API/web/Python-worker profile: PostgreSQL, MongoDB, Redis,
object storage, and queues remain independently owned managed boundaries. AWS
uses Terraform-managed VPC/ECS/ECR/RDS-or-Aurora/ElastiCache/S3/SQS controls;
Render uses its native service model with Neon, managed MongoDB, Redis, B2, and
native workers. The shared contract, ownership, rollback, fake/disabled state,
and activation-gate requirements are identical.

## Profile contract

| Boundary       | Configuration source                                 | Owner         | Rollback                                              | Fake/disabled state                  | Activation gate                                                     |
| -------------- | ---------------------------------------------------- | ------------- | ----------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| PostgreSQL     | AWS Secrets Manager reference                        | Data Platform | Last passing schema and verified backup               | Disabled until endpoint is available | Endpoint, secret reference, backup, quota, authorized smoke         |
| MongoDB        | AWS secret-store/approved decision-adapter reference | Document Data | Restore or rebuild projections with reconciliation    | Deterministic document fake          | Owner, network, retention, backup, authorized smoke                 |
| Redis          | AWS Secrets Manager reference                        | Runtime Jobs  | Disable consumers and replay the PostgreSQL ledger    | Deterministic cache/queue fake       | Retry, quota, secret reference, authorized smoke                    |
| Object storage | Terraform S3 output reference                        | Assets        | Revert adapter and reconcile versioned objects        | Deterministic object fake            | Policy, encryption, lifecycle, authorized smoke                     |
| Queues         | Terraform SQS/DLQ output reference                   | Runtime Jobs  | Stop intake and replay ledger/outbox/DLQ idempotently | Deterministic transport fake         | Queue policy, retry, IAM, secret reference, quota, authorized smoke |

## Evidence and activation

Use the non-provisioning dry-run fixture check from the repository root:

```text
node scripts/validation/cloud-native/validate-plan.mjs
```

The check validates only the declared profile shape and synthetic references;
it performs no Terraform apply, provider call, or `.env` read. The resulting
`cloud-plan-validation` class proves shape only. `authorized-cloud-smoke` is
separate and requires credentials, resources, quotas, region, owner approval,
and explicit smoke authorization. Otherwise the result is
`unavailable-deferred`, with the deterministic fake or disabled mode retained.
If Terraform is unavailable, `terraform validate`/`plan` are recorded as
unavailable and the deterministic fixture result remains the only evidence;
no live conformance is claimed.

The plan-only result never claims live conformance; `authorized-cloud-smoke` is
recorded only after explicit authorization. Missing credentials or resources
remain `unavailable-deferred`; live conformance is not claimed.

Terraform rollback uses the last passing versioned profile/state, stops intake
before partial serving, preserves the PostgreSQL ledger/outbox/DLQ, and records
the drift or failure, operator, version, reason, and health evidence. Managed
data sources are never duplicated silently.
