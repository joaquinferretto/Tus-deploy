# Proposal: Product Factory Core

## Intent

Turn `Goldenrepo-js-py` from a contaminated, partially wired boilerplate into a neutral product factory: every generated product receives real, reusable, configured, documented, locally tested platform capabilities rather than empty interfaces or copied vertical code. The business outcome is faster, safer product delivery with consistent identity, tenancy, CRUD, data ownership, AI workflows, provider integration, and operations. No production-readiness claim is valid until the evidence gates below pass.

## Proposal question round

The supplied corrections and later decisions supersede the exploration questions: OAuth/OIDC is included; Render→AWS uses an env-held minimum bootstrap credential limited to STS `AssumeRole`; AWS is the principal AI platform; RAG is mandatory; Mercado Pago and WhatsApp are V1 adapters; AI data retention is consent-governed; and paid/live choices are implementation gates, not proposal uncertainty. Region, quota, retention, and provider-availability values remain implementation-time configuration/owner approvals, not proposal blockers.

## Scope

### In Scope

- A complete dependency-ordered roadmap: foundation; identity/tenancy; data/platform CRUD; durable LangGraph runtime; complete AI catalog; neutral reference app; provider adapters; operational hardening.
- Product-neutral universal modules: users/accounts/credentials, email/password, verification/recovery, sessions/refresh/device management, MFA, passkeys, OAuth/OIDC, organizations/workspaces, memberships, roles/permissions, tenant authorization, per-product superadmin, audit/security events, generic CRUD/search, notifications, assets/uploads, feature flags/config, idempotency/outbox, jobs/events, quotas/rate limits, privacy/retention/deletion, i18n/time zones/currencies, contracts, health/readiness/shutdown, telemetry, and admin surfaces.
- PostgreSQL/Neon as relational source of truth; MongoDB for explicitly owned document/read-model workloads; Prisma for ordinary CRUD and parameterized raw SQL for atomic, aggregate, idempotency, outbox, and hot paths.
- ACID transactions inside PostgreSQL and MongoDB; no distributed 2PC; cross-system workflows use transactional outbox, idempotency keys, sagas, compensating actions, a durable run ledger, and explicit reconciliation.
- Python/LangGraph as the only orchestration authority; Bedrock as the planned principal AI provider; Groq as the currently active provider until AWS credits exist; retained Groq LLM/STT/TTS adapters; B2 assets; Redis-local and SQS+DLQ production jobs; a Docker-free native local development profile; and cloud-native Render and Terraform-managed AWS profiles as the active integration/deployment path. Docker Compose/P0.6b is deferred and non-blocking.
- Terraform as the single IaC source of truth; no parallel CDK implementation. AWS service activation is profile-driven, not an assertion that every service is always enabled.
- Complete AI contracts and real implementations for LLM/chat, structured output, tools/permissions, agents/subgraphs/supervisors, memory, sessions/checkpoints, durable runs/HITL, prompt/model registry, routing/retry/circuit breaking, usage/cost/quotas, guardrails/privacy, evaluations, RAG, hybrid retrieval/reranking/citations, STT/TTS, translation, vision, OCR, moderation, recommendations, streaming, image generation/editing, and video generation/editing.
- Neutral configurable adapters for email/SES, Mercado Pago, WhatsApp, AWS services, Groq, B2, databases, Redis, and SQS. `gated` means implemented, wired, configured, documented, and locally tested, then disabled until credentials/resources and owner-approved live conformance exist; never an empty stub.
- Isolated neutral reference application and tusservicios-inspired fallback scenarios only where a universal use case cannot prove a capability; no vertical logic in core.
- Absolute secret prevention: expanded ignore rules, fictitious `.env.example` only, pre-commit/CI scanning and blocking, tracked-secret detection, and immediate rotation incident procedure.

### Out of Scope

- Versioned generator implementation, product billing, vertical domains, central shared admin, GraphQL/CQRS/event sourcing/Kubernetes/multi-region, automatic cross-region AWS, production Docker, or hidden live-provider tests.
- Production-readiness claims for the native local profile, completing Docker Compose/P0.6b in this change, or requiring provider credentials for local development. Removing existing Compose files is explicitly not a goal; Compose remains an optional future integration task.
- Google/Vertex, Bedrock Agents/Flows, Cognito, Pinpoint, Forecast, Fraud Detector, new X-Ray SDKs, unjustified default OpenSearch/SNS adoption, facial identity, and unsupported/unverified AWS model names. EventBridge remains available only through the explicit AWS profile and a concrete capability use case.
- Modifying either auth source; they remain read-only evidence: `C:\Users\mmmau\vialovers-worktrees\alqui-full-product\apps\server\auth-kit` and `C:\Users\mmmau\auth-kit-standalone`.

## Capabilities

### New Capabilities

- `platform-foundation`: contracts, configuration, lifecycle, security defaults, observability, DX, CI, and test harness.
- `identity-tenancy`: successor authentication, OAuth/OIDC, tenant isolation, RBAC/ABAC, superadmin, audit, and privacy.
- `data-platform-crud`: PostgreSQL/Mongo ownership, universal CRUD/search, assets, notifications, flags, quotas, idempotency, outbox, jobs, and events.
- `durable-langgraph-runtime`: cross-runtime contracts, checkpoints, durable runs, HITL, workers, Redis/SQS/DLQ, and streaming.
- `ai-capability-catalog`: all AI capabilities listed in scope, including recommendations and media generation/editing.
- `rag-knowledge`: B2 ingestion, parsing/chunking/deduplication/lineage, AWS embeddings, PGVector, tenant filters, hybrid retrieval/reranking/citations, update/delete/reindex, evals, and optional Bedrock Knowledge Bases retrieval.
- `provider-adapters`: B2, AWS, Groq, email, Mercado Pago, WhatsApp, databases, cache, and queues with fakes/conformance.
- `neutral-reference-app`: end-to-end neutral proof plus isolated fallback scenarios.
- `operational-hardening`: Render, IAM/KMS, STS identity, budgets/quotas, CloudTrail, OTel/CloudWatch, retention, scanning, runbooks, and rollback.

### Modified Capabilities

- `platform-foundation`: add a separate Docker-free native local profile, explicit optional/fake dependency behavior, root `.env` loading by path/key, canonical `backend`/`frontend` wrappers, cloud-native profile governance, and split native-versus-cloud evidence; defer Compose/P0.6b independently.

## Approach

Choose a neutral core with always-on platform modules and fully implemented, configurable adapters. This preserves reusable value while removing contamination, avoids an all-in monolith’s coupling and cost, and avoids split repositories’ duplicated governance. Use Clean/Hexagonal boundaries, contract-first cross-runtime schemas, explicit configuration/fail-fast startup, dependency inversion, OTel middleware, deterministic local fakes, and bounded slices. Preserve working mobile, JSON Schema, LangGraph, OTel, and Groq primitives; adapt or rewrite only where contamination, duplication, broken claims, or unsafe behavior prevents neutral reuse. Use the native profile for API/web development and cloud-native Render/AWS profiles for active integration and deployment; do not block contracts, governance, IaC, or reference work on Docker.

### Native local development amendment

The native profile remains a developer loop for API/web work, not a production claim. Add source-free canonical wrappers at `backend/` and `frontend/` so the exact commands `cd backend && pnpm run dev` and `cd frontend && pnpm run dev` delegate to `apps/api` and `apps/web` without copying source or secrets. The API wrapper MUST resolve the repository-root `.env` by explicit path, consume the existing `DATABASE_URL` key without printing its value, and start the API with PostgreSQL as the required local dependency. MongoDB and Redis readiness MUST be explicit optional, disabled, or deterministic-fake states under the native profile; other provider-backed capabilities use documented fakes/disabled states. No provider credentials are required.

Native acceptance records separate evidence: both exact wrapper commands run, API/web health succeeds, PostgreSQL connectivity uses `DATABASE_URL`, optional dependencies report their declared fake/disabled state, and logs/scans show no secret values or copied `.env`. Cloud-native acceptance is the active integration/deployment path: Render-native and AWS Terraform plans/validation, configured managed PostgreSQL/MongoDB/Redis/object storage/queues, deterministic fakes, and explicit activation gates are recorded separately. Authorized provider/resource smoke is recorded only where credentials and resources exist. Compose/P0.6b is deferred, non-blocking, not completed or validated, and remains a future optional integration task; existing Compose files are retained.

### Consistency and persistence policy

PostgreSQL and MongoDB each provide ACID transactions within their own database boundary. The factory MUST NOT use distributed two-phase commit. Any workflow spanning databases, object storage, queues, payments, messaging, or AI providers MUST use a transactional outbox, idempotency keys, sagas, compensating actions, a durable run ledger, and explicit reconciliation with observable failure states.

| Workflow | Consistency contract |
|---|---|
| Auth refresh rotation | One PostgreSQL transaction locks the token family, verifies the hash, rotates/revokes atomically, records the security event, and emits follow-up work through the outbox; retries are idempotent. |
| Orders/payments | The order state and payment-intent record commit atomically in PostgreSQL; provider calls occur after outbox publication; webhook/retry handlers use idempotency keys, saga transitions, compensation, and reconciliation. |
| Inventory/reservations | Row locks or serializable/atomic SQL protect concurrent availability and reservation claims; expiry/release is durable and compensating, never a cross-database transaction. |
| Jobs | The business/run ledger and outbox commit together; Redis-local or SQS+DLQ delivery is at-least-once, with claim/ack/retry/idempotency and reconciliation for stuck runs. |
| Webhooks | Raw receipt metadata and deduplication key commit before processing; signature verification, state transition, retries, compensation, and provider reconciliation are explicit and auditable. |

### ORM, query, and dependency-inversion policy

Prisma ORM is the default for ordinary CRUD, relation loading, validation, migrations, and simple transactions. Parameterized raw SQL is required for row locks, concurrent inventory/reservation/availability decisions, refresh-token rotation, outbox/idempotency claims, CTEs, window functions, aggregates, full-text/geospatial queries, bulk operations, and other measured hot paths. MongoDB driver/Mongoose owns document workloads; MongoDB sessions are required for multi-document Mongo transactions. Domain and application layers depend only on repository/port contracts and MUST NOT import Prisma, Mongo drivers/Mongoose, SQL, or vendor SDKs.

### Supported runtime and production profiles

All profiles share contracts, ownership, and rollback semantics, but evidence is profile-specific. Native local is a PostgreSQL-backed developer profile; cloud-native Render and AWS Terraform are the active integration/deployment profiles; Compose is deferred and optional; production Docker is not used for Render.

| Profile | Production shape | Required boundary |
|---|---|---|
| Native local | `backend/` and `frontend/` wrappers over `apps/api` and `apps/web`; PostgreSQL supplied through `DATABASE_URL`; MongoDB/Redis/providers fake or explicitly disabled. | Exact documented commands, root `.env` path/key loading with redacted diagnostics, no copied secrets, and separate native smoke evidence. Not a production profile. |
| Render-native | Render-native API/web/Python services with managed PostgreSQL, MongoDB, Redis, object storage, and queues as configured. | Render plan/validation, secret-store and worker lifecycle checks, deterministic fakes, activation gates, rollback/runbooks, and authorized smoke only where credentials/resources exist. |
| AWS Terraform | VPC/subnets/security groups; ECS/Fargate and ECR; RDS PostgreSQL or Aurora-compatible option; MongoDB Atlas/DocumentDB decision adapter; ElastiCache Redis; S3; CloudFront; WAF; Route 53/ACM; SQS/DLQ; EventBridge; Lambda; CloudWatch/OTel; IAM/STS/KMS/Secrets Manager/CloudTrail; GuardDuty/Security Hub/Inspector; Budgets/Service Quotas; Backup; and applicable Bedrock/Transcribe/Polly/Textract/Rekognition/Translate. | Reusable Terraform modules and capability profiles, local fakes, explicit smoke gates, and no claim that every service is enabled in every product. |

Terraform is the single infrastructure-as-code source of truth. CDK is not introduced in parallel. The AWS profile may choose RDS/Aurora, Atlas/DocumentDB, or other approved options through an explicit decision adapter; it MUST NOT silently create duplicate sources of truth.

### AWS critical-service catalog

The catalog is a delivery and activation contract, not a list of empty stubs. Every service entry requires a real module/adapter where categorized, a local fake or deterministic fixture, configuration, ownership, security/cost/data evidence, and an explicit profile gate.

| Category | Services | Boundary |
|---|---|---|
| Core profile modules | VPC/subnets/security groups; ECS/Fargate; ECR; RDS PostgreSQL/Aurora-compatible; ElastiCache Redis; S3; CloudFront; WAF; Route 53/ACM; IAM/STS/KMS; SQS/DLQ; CloudWatch/OTel; CloudTrail; GuardDuty; Security Hub; Inspector; AWS Backup; Budgets; Service Quotas. | Reusable Terraform modules and contracts; activation is per product profile, never assumed universal. |
| Implemented adapters | S3 object/asset adapter; SQS/DLQ job adapter; EventBridge event adapter; Lambda invocation adapter; CloudWatch/OTel telemetry adapter; IAM/STS/KMS configuration adapter; CloudTrail/GuardDuty/Security Hub/Inspector/Backup/Budgets/Service Quotas integrations. | Real ports/adapters with local fakes and contract evidence; no provider logic in domain/application code. |
| Gated adapters | Bedrock models/embeddings/multimodal; Bedrock Guardrails; Transcribe; Polly; Textract; Rekognition; Translate; SES. | Fully implemented, wired, configured, documented, and locally fake-tested before activation; credits, credentials, regional availability, quotas, and owner-approved live conformance gate use. |
| Reference/deferred modules | OpenSearch, Location, Athena, Glue, and Kinesis. | Add only after a concrete neutral use case, ownership decision, cost boundary, local fake/fixture, and approved profile; otherwise remain deferred. |

Retired/closed, duplicative, or explicitly excluded services remain out of scope: Pinpoint, Forecast, Fraud Detector, Bedrock Agents/Flows, new X-Ray SDK/daemon instrumentation, default duplicate AWS data stores, and unapproved provider sprawl.

### Dependency-ordered delivery

| Phase | Exit evidence |
|---|---|
| 0. Inventory/governance | Capability ledger, ownership matrix, contamination map, support profiles, and neutral/reference boundaries are versioned before tasks are created. |
| 1. Foundation | Lockfile/namespaces, config validation, API contracts/errors/lifecycle, OTel context, Terraform/Render profile boundaries, native local startup, cloud-native plans/validation, CI harness, and split native/cloud evidence. Compose/P0.6b remains deferred. |
| 2. Identity/tenancy | Successor auth, OAuth/OIDC, atomic refresh rotation, revocation, recovery/MFA/passkeys, organizations, authorization, superadmin, audit/privacy, and the identity/email adapters required by verification and recovery. |
| 3. Data/platform CRUD | Independently verified PostgreSQL/Prisma/raw-SQL slices, Mongo ownership and sessions, users/tenants/search/assets/notifications/flags/quotas/idempotency/outbox/audit slices, ACID/reconciliation evidence, plus B2/S3 and database/storage adapters; this is not one opaque completion boundary. |
| 4. Durable runtime | LangGraph authority, TS/JSON/Python compatibility, checkpoint/resume/HITL, Redis-local and SQS+DLQ adapters, claims/retries/DLQ/run ledger, EventBridge/Lambda integration where used, worker lifecycle, and streaming. Capability-critical queue/cache/event adapters are delivered here, not deferred to a generic provider phase. |
| 5. Complete AI catalog | Groq remains the active provider until AWS credits exist. Each model, speech, media, recommendation, RAG, safety, evaluation, routing, and cost slice delivers its required Bedrock/Groq/specialized provider adapter with contract, implementation, fake, configuration, use case, ownership, and evidence. Bedrock activation requires credits and approved live conformance; availability gaps require an evidence-backed alternative/disposition. |
| 6. Reference integration | Neutral web/mobile/API app proves identity, tenancy, CRUD, search, assets, notifications, jobs, AI, audit, observability, and separate superadmin. |
| 7. Remaining provider integration | Mercado Pago and WhatsApp secure webhooks, local fakes, separate reference scenarios, and remaining cross-cutting adapter integration/conformance only; identity/email, storage, queue, AWS AI, and Groq adapters are not deferred here. |
| 8. Hardening | Render and AWS Terraform profile conformance, Secrets Manager/secret-store policy, STS bootstrap policy, IAM/KMS, GuardDuty/Security Hub/Inspector, Backup, budgets/quotas, CloudTrail, OTel export/alerts, retention/deletion, runbooks, clean-environment portability evidence, cloud plans/validation, and explicitly authorized paid/live smoke. |

### Capability ledger and slicing contract

Before tasks are created, the capability ledger MUST assign every row an owner, dependency phase, contract, implementation path, local fake or fixture, neutral use case/reference, configuration, security/data/cost ownership, and independently verifiable evidence gate. No task may hide multiple rows behind a single completion claim. The following universal modules require separate bounded slices, including within Phase 3:

| Ledger slice | Required independent evidence gate |
|---|---|
| Users, accounts, credentials | Tenant-safe CRUD, credential hashing/lifecycle, validation, audit, and local integration proof. |
| Sessions, refresh, devices | Atomic rotation, family/hash checks, revocation, replay denial, and restart proof. |
| Verification and recovery | Email adapter contract/fake, token expiry/replay protection, delivery failure handling, and audit. |
| Organizations, workspaces, memberships, tenants | Isolation filters, membership lifecycle, default-organization behavior, and cross-tenant denial tests. |
| Roles, permissions, tenant authorization, superadmin | Deny-by-default policy decisions, separate product superadmin boundary, and audited administration. |
| Audit and security events | Immutable/eventual delivery contract, redaction, correlation, retention, and query evidence. |
| Generic CRUD and search | Contracted pagination/filtering, tenant scope, lexical/query records, and neutral reference proof. |
| Assets, uploads, lineage | B2 ownership, metadata/lineage, access policy, lifecycle, deletion, and local storage fake. |
| Notifications and email | Channel contract, delivery status/retry semantics, SES-gated adapter, local fake, and preference/privacy proof. |
| Feature flags and configuration | Explicit profile resolution, tenant/product scope, fail-fast validation, and rollback proof. |
| Quotas and rate limits | Reservation/accounting semantics, tenant enforcement, cost units, and deterministic exhaustion tests. |
| Idempotency and outbox | Parameterized atomic SQL, duplicate/replay behavior, publication/claim evidence, and recovery proof. |
| Jobs, events, run ledger | Producer/consumer contracts, Redis-local/SQS+DLQ behavior, retry/claim/ack, durable status, and crash replay. |
| Privacy, retention, deletion | Consent, redaction, tenant isolation, configurable retention, deletion propagation, and audit evidence. |

Phase 3 is therefore a ledger of independently verifiable platform slices, not a single opaque boundary; Phase 4 and Phase 5 apply the same rule to durable jobs and every AI/provider capability.

## Auth provenance matrix

| Source | Reuse | Must not copy blindly |
|---|---|---|
| `auth-kit-standalone` | Structural/package boundaries and reusable neutral organization. | Any incomplete security behavior or stale assumptions. |
| `vialovers.../auth-kit` integrated source | Atomic refresh rotation, token hash/family checks, registration-session persistence, revocation guarantees, and tests. | Alqui/DNI/host/guest coupling, role escalation, revocation blindness, CSRF/cookie inconsistency, unauthenticated MFA, incomplete reset/verification, migration/adapter mismatch, stale dist. |
| New factory successor | Combines the two proven dimensions and adds email/password, verification, recovery, sessions/devices, MFA, passkeys, OAuth/OIDC, account linking, roles, tenants, product superadmin, and fixes every known vulnerability/regression. Both sources remain unchanged. | No production-readiness claim before security regression and tenant-isolation evidence. |

## AI, data, and provider policy

LangGraph is the only orchestrator for generation, durable state, sessions, tools, agents, HITL, RAG, routing policy, and workflow authority. Amazon Bedrock is the planned principal AI provider. Groq remains the currently active provider because AWS credits are not available yet; the factory MUST reuse `apps/api/backendFiles` only after extracting and neutralizing valid LLM/STT/TTS/retry primitives from its contaminated contents. The Bedrock adapter MUST be complete, wired, configured, documented, and locally fake-tested before activation; AWS credits, credentials, regional availability, and owner-approved live conformance gate activation. Bedrock Agents and Flows are explicitly excluded. Every capability requires a neutral contract, real implementation, local fake/fixture, documentation/configuration, a cross-project use case or isolated fallback reference, and evidence for security, cost, and data ownership. AI data may improve AI only with consent, encryption, tenant isolation, redaction, lineage, opt-out, deletion, configurable retention, and audit; raw indiscriminate logs are prohibited.

RAG is complete, not a stub: B2 is source of truth; ingestion performs parsing, chunking, deduplication, lineage, AWS embeddings, PGVector persistence, tenant filtering, hybrid retrieval, reranking, citations, update/delete/reindex, and evaluation. Bedrock Knowledge Bases is optional retrieval only and never owns generation/orchestration. Recommendations, image/video generation and editing are mandatory catalog entries; if current AWS capability is unavailable, record tested evidence and an approved alternative/disposition rather than silently omitting them.

Render uses one minimum env-held bootstrap credential capable only of STS `AssumeRole`; temporary credentials are scoped per environment/service, federation is prepared for future, and no real secret enters Git/GitHub. `.env` is local-only, ignored, never read into artifacts, never committed or pushed; real provider values belong only in Render or AWS secret stores. The existing `.env` was verified present, ignored, and untracked; its values MUST NOT be exposed or copied. AWS region is configurable per product, cross-region is never automatic, budgets/quotas are hard controls, and paid smoke requires explicit authorization.

### Normative capability acceptance

The following entries are mandatory and MUST independently satisfy every listed condition; they are not satisfied by interfaces, optional-only stubs, or a catalog mention:

| Capability | Normative acceptance |
|---|---|
| Recommendation systems | MUST provide a neutral recommendation contract and real implementation; deterministic fake; a cross-project use case or isolated reference; explicit security, data, and cost ownership; tenant/rate/usage quotas; evaluation fixtures for relevance, safety, latency, and cost; provider availability evidence plus alternative/disposition when AWS support is absent; and zero business-domain leakage. |
| Video editing | MUST provide a neutral asynchronous editing contract with inputs, operations, progress, cancellation, outputs, lineage, and retention; real implementation; deterministic fake; a cross-project use case or isolated reference; explicit security, data, and cost ownership; storage/compute quotas; evaluation fixtures for correctness, safety, latency, and cost; provider availability evidence plus alternative/disposition when AWS support is absent; and zero business-domain leakage. |

## Success criteria

| Capability class | Measurable acceptance |
|---|---|
| Every module/adapter | Real implementation is wired, configured, documented, locally tested, has a neutral use case/reference, explicit security/cost/data owner, deterministic fake where external, and no empty-interface gate. |
| Identity/tenancy | Atomic rotation/revocation/recovery and auth provenance tests pass; cross-tenant and superadmin boundaries are denied/allowed correctly; source folders remain unchanged. |
| Data/jobs/RAG | Ownership matrix prevents ambiguous dual writes; migrations and raw-SQL invariants pass; crash/replay/idempotency/DLQ/RAG lineage/citation/delete tests pass. |
| Consistency and query policy | PostgreSQL/Mongo ACID boundaries, outbox/idempotency/saga/reconciliation scenarios, Prisma/default-query rules, required parameterized SQL paths, Mongo sessions, and repository/port dependency checks pass. |
| AI/provider catalog | Every row has contract, implementation, config, fake, eval fixtures, cost/quota/guardrail evidence, and availability disposition; no hidden paid dependency. |
| Deployment profiles | Native local acceptance and active cloud-native Render/AWS integration evidence are independently recorded; plans/validation and authorized smoke are distinguished, deterministic fakes and activation gates cover unavailable providers, and no unsupported live-conformance claim is made. Compose/P0.6b remains deferred and non-blocking. |
| AWS service catalog | Each core module, implemented adapter, gated adapter, and reference/deferred service has a category, Terraform/port boundary, local fake/fixture or concrete use case, owner, cost/security/data policy, and explicit activation gate. |
| Secrets | `.env` remains ignored, untracked, and absent from artifacts; secret scanning blocks tracked secrets; Render/AWS secret stores are the only real-provider-value locations; rotation incident procedures are documented. |
| Operations | Cloud-native Render/AWS profiles and runbooks are explicit; native local limitations are explicit; cloud plans/validation and authorized smoke are recorded truthfully; Compose remains an optional future integration task; secret scans block tracked secrets; production readiness is claimed only after authorized live evidence. |
| Clean-environment portability | A fresh neutral product team/check-out follows the documentation to run native API/web smoke, configure the active Render/AWS cloud-native profile, run neutral reference integrations where resources are authorized, verify no vertical contamination, and understand every provider/live gate without hidden maintainer knowledge. |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api`, `apps/web`, `apps/mobile` | Modified | Neutral runtime, platform flows, reference integration, and contamination removal. |
| `apps/workflow-runtime-python` | Modified | Authoritative durable LangGraph runtime and AI/RAG workers. |
| `packages/*`, `apps/api/prisma`, Mongo adapters | Modified | Contracts, ownership, CRUD, persistence, queues, observability, and config. |
| `infra/terraform`, `openspec/`, CI, Render/AWS runbooks, Compose | Modified/Deferred | Single-source IaC, active cloud-native profiles, native/cloud evidence, and security policy; existing Compose files remain retained for a future optional integration task. |
| `backend`, `frontend`, `scripts/dev`, development docs | New/Modified | Source-free native wrappers, root `.env` path/key loading, optional/fake dependency profile, and separate smoke evidence. |
| external auth source folders | Unchanged | Read-only provenance inputs. |

## Risks and mitigations

- **High:** breadth becomes shallow; require per-row evidence gates and bounded slices.
- **High:** auth or dual-write errors; use provenance, atomic SQL, isolation tests, and explicit ownership.
- **High:** provider/model/region/cost drift; configuration-driven availability, hard quotas, fakes, and owner-approved paid smoke.
- **Med:** B2/S3 residency or retention failures; encrypted lifecycle staging, lineage, cleanup, and policy tests.
- **Med:** cross-runtime schema drift; one contract source plus compatibility fixtures.
- **High:** Render and AWS profiles drift; shared contracts, Terraform modules, profile-specific smoke gates, and clean-environment portability evidence are mandatory.
- **High:** cross-system consistency is mistaken for distributed ACID; prohibit 2PC and require outbox/saga/reconciliation scenarios.
- **Med:** AWS credits are unavailable; keep Groq active, implement/fake-test Bedrock completely, and gate activation without empty adapters.
- **Med:** disk/CI cost; keep local providers deterministic and monitor resource budgets without deleting user data.
- **Med:** native local or cloud profiles can drift; keep native smoke, cloud plans/validation, and authorized smoke evidence separate, while Compose remains an explicitly deferred optional integration gate.

## Rollback Plan

Deliver phases behind explicit profiles and adapter flags. Roll back the affected slice to the last passing contract/migration version, disable gated/live adapters, drain or replay durable jobs from the PostgreSQL ledger/DLQ, restore data from verified backups, and revert reference wiring without deleting neutral contracts. Native rollback removes or reverts only the source-free wrappers/profile loader and preserves `apps/api`/`apps/web`; Compose rollback remains independent. Render rollback uses the last passing native service configuration; AWS rollback uses versioned Terraform state/modules and profile flags. Never roll back by re-enabling contaminated or broad credentials. Rotate any exposed secret immediately and record the incident.

## Dependencies and non-blocking decisions

- Node 20/pnpm 9/Turborepo, PostgreSQL/Neon, MongoDB, Redis, B2, Render, Python 3.12/LangGraph, Terraform, AWS VPC/ECS/Fargate/ECR/RDS-or-Aurora/Atlas-or-DocumentDB/ElastiCache/S3/CloudFront/WAF/Route53/ACM/SQS/EventBridge/Lambda/CloudWatch/OTel/IAM/STS/KMS/Secrets Manager/CloudTrail/GuardDuty/Security Hub/Inspector/Backup/Budgets/Service Quotas, gated Bedrock/Transcribe/Polly/Textract/Rekognition/Translate/Guardrails/SES, and approved provider accounts.
- Paid/live implementation is blocked until owners approve regions, budgets, retention, credentials, resources, and adapter conformance; cloud plans/validation, deterministic fakes, contracts, governance, IaC, and planning are not blocked. No live cloud conformance is claimed without evidence.
- Native local requires an already available PostgreSQL endpoint referenced only by the existing `DATABASE_URL` key; MongoDB, Redis, and external provider credentials are not prerequisites for the native smoke.
