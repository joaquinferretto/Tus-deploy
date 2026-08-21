# Runtime Profile Matrix

| Concern | Local Compose | Render-native | AWS Terraform | Owner | Contract | Fake / fixture | Security/data/cost gate | Evidence |
|---|---|---|---|---|---|---|---|---|
| API | Node API container | native API service | ECS/Fargate boundary | Platform | HTTP/lifecycle | local API | secret store; PostgreSQL owner; quota | health/readiness |
| Web | Next.js support | native web service | CloudFront/compute boundary | Web platform | UI/API contracts | local web | no policy in client; profile URL | reference smoke |
| Mobile | mobile support process + device build | client release process | client release process | Mobile platform | client contracts | headless support fake | no credentials in bundle | lifecycle test |
| Python runtime | provider-free worker | native background worker | ECS/Fargate worker | Runtime | workflow schemas | deterministic graph fake | no live provider; run ledger | worker smoke |
| PostgreSQL | local container | Neon | RDS/Aurora decision adapter | Data | repository/ledger ports | local database | single source of truth; budget | ownership test |
| MongoDB | local container | managed MongoDB | Atlas/DocumentDB decision adapter | Data | document ports | local session fake | explicit ownership; budget | reconciliation test |
| Redis/jobs | local Redis | managed Redis | ElastiCache/SQS+DLQ | Runtime | claim/ack contract | in-memory/local fake | transport not ledger owner | retry/DLQ test |
| Object storage | deterministic fake | B2 | B2 + transient encrypted S3 | Storage | asset/lineage schemas | local object fake | retention and residency | lineage test |
| Telemetry | in-memory/console ports | OTel export | OTel/CloudWatch-compatible | Operations | telemetry ports | redaction fixture | metadata only; sampling | correlation test |
| Secrets | `.env.example` schema only | Render secret store | Secrets Manager/approved bootstrap | Security | config contract | fictitious local values | rotate/revoke procedure | scan gate |
| Terraform | plan-only module fixtures | profile shape | capability modules | IaC | module inputs/outputs | no-resource plan | region/tags/encryption/retention/quota | `terraform validate` |
| Live AI/providers | disabled | explicitly authorized | explicitly authorized | Provider | provider ports | deterministic fake | credits, region, quota, owner approval | activation gate |

Render is native deployment and does not advertise production Docker. AWS
resources are not created by P0; capability flags default to disabled and no
credentials or provider calls are required for local validation.
