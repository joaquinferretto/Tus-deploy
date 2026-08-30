# Runtime Profile Matrix

| Concern | Native local | Render-native | AWS Terraform | Owner | Contract | Fake / fixture | Security/data/cost gate | Evidence |
|---|---|---|---|---|---|---|---|---|
| API | `backend` wrapper → `apps/api` | native API service | ECS/Fargate boundary | Platform | HTTP/lifecycle | local API fixture | root `.env` key reference; PostgreSQL owner; quota | `native-smoke` health/readiness |
| Web | `frontend` wrapper → `apps/web` | native web service | CloudFront/compute boundary | Web platform | UI/API contracts | local web fixture | no policy in client; profile URL | `native-smoke` reference smoke |
| Mobile | support only; not a native dependency | client release process | client release process | Mobile platform | client contracts | headless support fake | no credentials in bundle | `native-smoke` limitation |
| Python runtime | optional/disabled worker | native background worker | ECS/Fargate worker | Runtime | workflow schemas | deterministic graph fake | no live provider; run ledger | `native-smoke` declared state |
| PostgreSQL | required via `DATABASE_URL` | Neon | RDS/Aurora decision adapter | Data | repository/ledger ports | local database fixture | single source of truth; budget | `native-smoke` or cloud class |
| MongoDB | deterministic fake or disabled | managed MongoDB | Atlas/DocumentDB decision adapter | Data | document ports | local session fake | explicit ownership; budget | profile-specific boundary evidence |
| Redis/jobs | deterministic fake or disabled | managed Redis | ElastiCache/SQS+DLQ | Runtime | claim/ack contract | in-memory/local fake | transport not ledger owner | profile-specific boundary evidence |
| Object storage | deterministic object fake | B2 | B2 + transient encrypted S3 | Storage | asset/lineage schemas | local object fake | retention and residency | profile-specific boundary evidence |
| Telemetry | redacted local ports | OTel export | OTel/CloudWatch-compatible | Operations | telemetry ports | redaction fixture | metadata only; sampling | `native-smoke` or cloud class |
| Secrets | schema-only `.env.example`; no values | Render secret store | Secrets Manager/approved bootstrap | Security | config contract | fictitious references | rotate/revoke procedure | redacted scan gate |
| Terraform | not selected | profile shape | capability modules | IaC | module inputs/outputs | no-resource plan | region/tags/encryption/retention/quota | `cloud-plan-validation` |
| Live AI/providers | disabled | explicitly authorized | explicitly authorized | Provider | provider ports | deterministic fake | credits, region, quota, owner approval | `authorized-cloud-smoke` or `unavailable-deferred` |

Render is native deployment and does not advertise production Docker. Native
local is a developer profile, not production or full integration. AWS resources
are not created by P0; capability flags default to disabled and no credentials
or provider calls are required for local validation.

## Deferred Compose profile

Compose is retained as an optional future integration profile. It is deferred,
unchecked, and non-blocking in this change. Its files are not changed to claim
completion, and an active native/cloud profile must never silently fall back to
Compose.

| Profile | Status | Evidence | Completion gate |
|---|---|---|---|
| Local Compose | Deferred / unchecked | `deferred` only; no runtime claim | Separate P0.6b RED/GREEN/runtime slice |

## Active cloud-native profile contract

`render-native` and `aws-terraform` are the only active integration/deployment
profiles. Selection is explicit; an active profile must not silently fall back to Compose
or substitute an undeclared managed service. Every profile declares the same
managed boundary contract for
the same five boundary contracts: PostgreSQL, MongoDB, Redis, object storage,
and queues. Each boundary records its configuration reference, single owner,
rollback path, managed/fake/disabled mode, and activation gate.

| Profile | Infrastructure authority | Managed boundaries | Missing live resources | Rollback evidence | Evidence classes |
|---|---|---|---|---|
| Render-native | Render native service/worker model | PostgreSQL, MongoDB, Redis, object storage, queues | Deterministic fake or disabled; `unavailable-deferred` | Last passing service configuration, ledger/outbox/DLQ replay, health evidence | `cloud-plan-validation`, `authorized-cloud-smoke`, `unavailable-deferred` |
| AWS Terraform | Terraform only; no parallel CDK | PostgreSQL, MongoDB, Redis, object storage, queues | Deterministic fake or disabled; `unavailable-deferred` | Versioned Terraform/profile state, ledger/outbox/DLQ replay, health evidence | `cloud-plan-validation`, `authorized-cloud-smoke`, `unavailable-deferred` |

Plan/validation evidence proves declared shape only. Authorized cloud smoke is a
separate gate and is the only evidence class that can claim live conformance.
These are profile-specific evidence classes and cannot be substituted across
native local, Render-native, AWS Terraform, or deferred Compose.
