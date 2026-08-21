# Design: Product Factory Core

## Technical Approach

Evolve the Express/Next/Expo/Python scaffold into a neutral Clean/Hexagonal platform. `packages/contracts/schemas` is the cross-runtime source of truth; Node owns HTTP/platform use cases, Python/LangGraph owns every durable AI/workflow decision, and adapters own databases, providers, queues, storage, and AWS. Compose is deterministic local integration; Render-native (API/web/workers + Neon/Mongo/Redis/B2) and Terraform/AWS are explicit profiles with health/readiness/shutdown and redacted errors.

## Architecture Decisions

| Decision | Choice and rationale |
|---|---|
| Contracts | JSON Schema in `packages/contracts/schemas` is canonical. Generate checked-in TypeScript types and Python models; validate ingress/egress with AJV and `jsonschema`; run compatibility fixtures. This avoids Zod/Pydantic drift and does not implement a versioned generator. |
| Authority | A LangGraph registry owns graphs, subgraphs, sessions, checkpoints, memory, tools, permissions, HITL, streaming, routing, RAG, and evaluations. Node orchestration and Bedrock Agents/Flows are rejected because they create competing state; Bedrock is only a provider/retrieval adapter. |
| Data/consistency | PostgreSQL/Neon owns identity, tenancy, auth, audit, quotas, search, aggregates, idempotency, outbox, and run ledger. Prisma is default for CRUD/simple transactions; parameterized `pg` SQL is mandatory for locks, refresh rotation, claims, aggregates, CTEs, bulk, and hot paths. Mongo owns explicitly assigned documents/read models and uses sessions for multi-document ACID. No 2PC: external work uses outbox, idempotent sagas, compensation, and reconciliation. |
| Identity successor | New neutral `auth-security` combines `C:\Users\mmmau\auth-kit-standalone` structure with `C:\Users\mmmau\vialovers-worktrees\alqui-full-product\apps\server\auth-kit` evidence for hashed token families, atomic refresh rotation, registration sessions, revocation, and tests. Both sources remain read-only provenance. Include password, verification/recovery, sessions/devices, MFA, passkeys, OAuth/OIDC, linking, tenant RBAC/ABAC, and separate audited product superadmin; do not copy Alqui coupling/regressions. |
| Providers/IaC | Groq LLM/STT/TTS remains active without AWS credits; complete fake-tested Bedrock adapters are gated until credentials, region, quota, and live approval exist. Terraform alone defines VPC, ECS/Fargate, ECR, RDS/Aurora, Mongo decision adapter, ElastiCache, S3, CloudFront, WAF, Route53/ACM, SQS/DLQ, EventBridge, Lambda, CloudWatch/OTel, IAM/STS/KMS, CloudTrail, security, Backup, Budgets, and Quotas. No CDK, cross-region default, or always-on service claim. |

## AWS Service Catalog

| Category | Services | Ownership/configuration | Evidence, activation, and local behavior |
|---|---|---|---|
| Core Terraform modules | VPC/subnets/security groups; ECS/Fargate; ECR; RDS/Aurora; ElastiCache; S3; CloudFront; WAF; Route53/ACM; IAM/STS/KMS; SQS/DLQ; CloudWatch/OTel; CloudTrail; GuardDuty; Security Hub; Inspector; Backup; Budgets; Service Quotas | Platform/IaC owns modules; profile, region, tags, encryption, retention, quotas, and enable flags are explicit. | `terraform validate/plan`, security/cost/backup evidence, and profile approval gate activation; deterministic plan fixtures represent them locally. |
| Implemented adapters | S3; SQS/DLQ; EventBridge; Lambda; telemetry; IAM/STS/KMS; security/backup/budget controls | Infrastructure/provider adapters own SDKs and configuration; domain code sees ports. | Port conformance, failure/retry/redaction evidence, profile gate, and deterministic in-memory/fake or fixture behavior in Compose. |
| Gated adapters | Bedrock/Guardrails; Transcribe; Polly; Textract; Rekognition; Translate; SES | AI/integration owners configure provider, model/region, consent, quota, cost, and secret-store references. | Fake + evaluation/conformance evidence, owner approval, credentials, availability, quota, and budget gate live activation; deterministic fakes never call AWS. |
| Deferred/reference | OpenSearch; Location; Athena; Glue; Kinesis | Architecture owns a registry disposition; no resource or data ownership is implied. | Concrete neutral use case, owner, cost boundary, contract, and fixture are required before an explicit gate; otherwise remain disabled with a fixture-only reference. |

Bedrock Agents/Flows, Pinpoint, Forecast, Fraud Detector, new X-Ray SDK/daemon instrumentation, default duplicate stores, and unsupported/unverified model names are explicitly excluded.

## Data Flow

```text
Client → API contracts/auth/tenant policy → PostgreSQL + outbox → Redis(local)|SQS+DLQ → LangGraph
                                       ↘ Mongo projection     ↘ B2 → parse/chunk → embeddings → PGVector
LangGraph → policy/guardrail/provider (Groq now, Bedrock later) → ledger/stream → clients
```

B2 is durable source of truth; encrypted lifecycle-managed S3 is transient AWS staging only. Retrieval performs tenant filtering, lexical/vector fusion, reranking, citations, delete/reindex, and evaluation. Consent governs retention of prompts, media, memory, traces, chunks, and derived indexes; deletion propagates through the ledger.

## File Changes

| File / area | Action | Design responsibility |
|---|---|---|
| `packages/contracts`, `packages/*` | Modify/Create | Canonical schemas, generated bindings, ports, fakes, compatibility checks, observability/config contracts. |
| `apps/api/src`, `apps/api/prisma` | Modify | Domain/application/presentation boundaries; successor identity, tenancy, CRUD, outbox/idempotency, Prisma migrations, raw-SQL repositories, Mongo reconciliation, provider adapters. |
| `apps/web`, `apps/mobile` | Modify | Contract-driven state/intent clients; session, stream, neutral reference UI; remove Alqui vocabulary while preserving SecureStore/offline/error primitives. |
| `apps/workflow-runtime-python/src/worker` | Modify | Graph registry, checkpoints/memory, tool/HITL policy, RAG, catalog routing/evals, streams, run ledger worker; replace `BLPOP`-only delivery with claim/ack/retry/DLQ. |
| `docker-compose.yml`, `infra/terraform`, Render/CI/runbooks | Modify/Create | Complete local profile; Render API/web/workers; AWS capability modules; secret scanning, retention, recovery, rollback, and evidence. |
| isolated reference area | Create | Neutral end-to-end proof plus only necessary tusservicios-inspired marketplace/messaging/settlement fixtures; never import them into core. |

## Interfaces / Contracts

```ts
interface Capability<I, O> { execute(input: I, ctx: TenantContext): Promise<Result<O>> }
interface JobTransport { publish(job: WorkflowJob): Promise<void>; claim(): Promise<Lease|null>; ack(id: string): Promise<void> }
```

Messages carry contract version, tenant/workspace, actor, correlation/trace IDs, idempotency key, lineage, and redacted outcome. AI ports cover LLM/chat, structured output, tools, agents/subgraphs/supervisors, memory, sessions/checkpoints, STT, TTS, translation, vision, OCR, moderation, recommendations, image/video generation/editing, streaming, routing/retry/circuit breaking, usage/cost/quotas, guardrails, and evaluations. AWS adapters map Bedrock/Guardrails, Transcribe, Polly, Translate, Textract, Rekognition, and SES; neutral examples include support assistance, typed extraction, tenant document search, and resumable user-resource jobs.

### Prompt / Model Registry

`apps/api/prisma` owns PostgreSQL models `PromptDefinition`, immutable `PromptVersion`, `ModelDefinition`, `ModelAvailability`, `Rollout`, `Approval`, and `RegistryAudit`; the AI platform owns them and no product prompt may enter core. Versions record capability, provider/model, schema, safety/cost policy, owner, and compatibility; states are `draft → pending_approval → approved → active → deprecated/disabled`. Availability records region, credentials/capability, quota, and evidence. LangGraph resolves an approved active version by capability, tenant/profile, and rollout, writes lookup/use/audit events, and can atomically roll back to the last passing version. A deterministic registry fake and fixture evaluator cover lookup, approval, rollout, provider failure, deprecation, and rollback without live calls.

### Email, Payments, Messaging, and Notifications

| Port | Adapter contract and boundary |
|---|---|
| Email/SES | `EmailPort` normalizes send/status/templates/preferences; SES is gated, fake delivery is deterministic, errors use bounded retry and DLQ, and tenant consent/redaction is mandatory. |
| Mercado Pago | `PaymentPort` handles signed webhook verification, receipt-before-processing, tenant authorization, idempotency/outbox, saga transitions, compensation, reconciliation, retry/DLQ, and a fake. Only isolated reference scenarios may model settlement; payment workflows stay out of core. |
| WhatsApp | `MessagingPort` validates signatures/replay, normalizes events, applies tenant/security policy, idempotency/outbox, saga/reconciliation, retry/DLQ, and a fake. Messaging/business journeys remain reference-only. |
| Notifications | `NotificationPort` owns channel preferences, delivery status, quotas, redacted errors, retry/DLQ, and provider-neutral fakes; application policy owns authorization, never vendor SDKs. |

## Testing Strategy

Unit: ports, policy, schemas, fakes, SQL invariants, graph nodes, redaction. Integration: full Compose with PostgreSQL, Mongo sessions, Redis, B2 fake, adapters, crash/replay/reconciliation. E2E/profile: neutral web/mobile/API flow and separately authorized Render/AWS conformance. Live calls require approval; all gated Bedrock/catalog adapters are locally fake-tested.

## Threat Matrix

| Boundary | Applicability and response | Planned RED test |
|---|---|---|
| Documentation-like paths | N/A: no documentation is executable; classify as data. | None unless an executor is added. |
| Git repository selection | N/A: no Git automation or cwd mutation. | None. |
| Commit state | N/A: no staging/commit automation. | None. |
| Push state | N/A: no destination/ref automation. | None. |
| PR commands | N/A: no command composition/PR automation. | None. |

## Migration / Rollout

Slice `foundation → identity/tenancy → data/platform → durable LangGraph → AI/RAG → reference → Mercado Pago/WhatsApp → hardening`. Each slice has a contract gate, owner, fake, rollback version, and evidence. Rollback disables the adapter, preserves contracts, replays ledger/DLQ work, restores verified backups, and rotates exposed secrets. `.env` remains ignored, untracked, local-only; examples are fictitious; Render holds only minimum STS `AssumeRole` bootstrap credentials and receives scoped temporary credentials; protected Terraform state never copies secret values.

## Clean-Environment Portability and Profile Parity

1. A fresh checkout follows documented commands with only fictitious `.env.example` values; no `.env` value is read, copied, logged, or placed in evidence.
2. Compose starts API, web/mobile support, Python/LangGraph, PostgreSQL, MongoDB, Redis, and every deterministic provider fake; contract and neutral-reference smoke proves identity, tenancy, CRUD, asset/RAG, job, stream, audit, and superadmin behavior.
3. Render-native conformance runs the same contract/reference smoke against API/web/workers, Neon, managed Mongo, Redis, and B2; AWS conformance runs `terraform plan` and authorized smoke for enabled modules/adapters only.
4. A parity matrix compares contracts, ownership, lifecycle, worker delivery, telemetry, retention/deletion, rollback, and gated services. A contamination scan checks core packages/base apps for vertical names and excluded providers. The evidence artifact records checkout/profile, configuration schema (never values), date, scope, results, deferred services, and owner authorization.
5. A failed parity, plan, smoke, or contamination check marks that profile unsupported; rollback selects the last passing profile/configuration, preserves recoverable ledger/DLQ work, and never silently enables another profile or live provider. The flow requires no maintainer-only knowledge.

## Dependency Graph and Open Questions

```text
foundation → identity → data/platform → runtime → {AI,RAG} → reference → providers → hardening
contracts ─────────────────────────────→ every runtime/profile
```

No design-blocking questions remain. Region, quota, retention, availability, and paid/live owners are implementation-time gates, not defaults.
