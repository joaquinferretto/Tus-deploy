## Exploration: product-factory-core

### Current State

The repository is a neutralization candidate, not yet a fully wired product factory. Current evidence is from the indexed working tree (CodeGraph: 59 files, 615 nodes, 1,270 edges; index current), the prior baseline audit, and targeted source verification.

| Area | Verified current state | Maturity |
|---|---|---:|
| Workspace/DX | pnpm 9/Turborepo and Node 20 are declared; root `package.json` has build/test/lint scripts, but no root `pnpm-lock.yaml` exists and package namespaces are inconsistent (`@repo/*`/`@golden/*`). | 2/4 |
| API | Express shell with Helmet, CORS, rate limiting, circuit breaker, `/health`, and `/ready`; no real API routes, auth, error envelope, tenancy, admin surface, or graceful lifecycle. Readiness directly probes PostgreSQL, MongoDB, and Redis. | 1.5/4 |
| Web | Next.js/React shell with a typed fetch helper, React Query, and a sample Zustand store; no authenticated or product-neutral platform flow. | 1.5/4 |
| Mobile | Expo Router shell with secure credentials, refresh/retry client, offline query persistence, image handling, error boundary, and logging; tests are only `.gitkeep` directories and the implementation contains extensive Alqui identity. | 2/4 |
| Data | PostgreSQL/Prisma, raw `pg`, MongoDB/Mongoose, and Redis clients exist; `apps/api/prisma/schema.prisma` contains no models, migrations, seeds, ownership matrix, or source-of-truth enforcement. | 1/4 |
| Contracts | JSON Schema files and AJV validation bridge TS/JS and Python for workflow/assets; Zod and JSON Schema ownership is not reconciled and no compatibility matrix exists. | 2/4 |
| Python/LangGraph | Python runtime, queue consumer, graph, checkpointer, S3 asset bridge, PGVector ingestion, and telemetry scaffolds exist. The graph is OpenAI-coupled, the Redis consumer has no durable run ledger/DLQ semantics, and the runtime is not yet the principal integrated runtime. | 1.5/4 |
| AI/provider layer | `apps/api/backendFiles` contains reusable Groq retry/HTTP/audio primitives but is untracked, not in the build, and mixed with DocPhone/medical/companion code. AWS adapters are absent. | 1/4 |
| Jobs/events | Redis/BullMQ-compatible consumption exists only in Python; there is no producer contract, idempotency ledger, outbox, retry policy, DLQ, or SQS production adapter. | 1/4 |
| Observability | TypeScript OTel ports and Python JSON telemetry exist; API instrumentation, metrics/exporters, trace propagation, redaction, and operational alerts are absent. | 1.5/4 |
| Deployment | Docker Compose provisions PostgreSQL, MongoDB, and Redis, but the API build context conflicts with the Dockerfile's root-workspace copies and the root lockfile is missing. No Render-native service/worker profile is encoded. | 1/4 |
| Quality/CI | Security workflow and declared Jest scripts exist, but no API/web tests or Jest configuration were found, mobile tests are placeholders, and no integration/E2E runner or build/release workflow exists. | 0.5/4 |

**Overall current maturity: approximately 1.4/4.** The strongest reusable assets are mobile infrastructure, cross-runtime JSON Schema contracts, Python workflow scaffolding, and OTel ports. The blockers are deterministic execution, identity/security, tenancy, persistence lifecycle, durable jobs, provider-neutral AI, tests, and deployment truthfulness.

### Authoritative Intent and Non-Goals

#### Intent

- Build a neutral, reusable, fully wired product factory/golden platform; every new product starts with standard infrastructure and capabilities already implemented, configured, tested, and documented.
- Improve and extend reusable capability; do not reduce working capability merely to simplify the repository.
- Keep Python/LangGraph as the mandatory principal AI/workflow runtime and orchestration authority.
- Keep PostgreSQL/Neon and MongoDB operational in every factory baseline, with explicit ownership that prevents ambiguous dual writes. Use Prisma for straightforward CRUD and parameterized SQL for atomic, complex, aggregate, and hot paths.
- Use Redis for local durable-job emulation and Amazon SQS plus DLQ in production; keep run ledger and idempotency in PostgreSQL.
- Use Backblaze B2 as primary object storage. Use transient encrypted, lifecycle-managed S3 only when AWS asynchronous services require staging.
- Run complete local integration through Docker Compose; run native Render web services and background workers in production without production Docker.
- Use OTel as the observability standard; do not introduce new X-Ray SDK instrumentation.
- Make organizations/workspaces, memberships, tenant isolation, tenant-scoped authorization, and a per-product platform superadmin standard capabilities. Simple products may use a default organization.
- Keep a separate neutral reference application. Use tusservicios-inspired scenarios only as isolated fallback references when a universal use case is not obvious.

#### Non-goals

- Do not turn the core into `tusservicios.com`, Alqui, Travelers, DocPhone, medical, companion, or another vertical product.
- Do not modify the two read-only auth sources: `C:\Users\mmmau\vialovers-worktrees\alqui-full-product\apps\server\auth-kit` and `C:\Users\mmmau\auth-kit-standalone`.
- Do not build the versioned project generator in this change; preserve generator seams/metadata only if needed for future work.
- Do not import Google/Vertex, Bedrock Agents/Flows, Cognito, Pinpoint, Forecast, Fraud Detector, default duplicate AWS compute/data stores, or new X-Ray SDKs.
- Do not make every provider or every business workflow a mandatory implementation in the core. Capability breadth must be bounded by contracts, profiles, tests, ownership, and anti-scope.
- Do not make OAuth/OIDC a silent identity requirement; it remains an owner decision.
- Do not make live cloud credentials or provider APIs hidden test dependencies.

### Capability Taxonomy

| Category | Factory responsibility | Boundary rule |
|---|---|---|
| Universal core | Runtime configuration and fail-fast validation, API/request/error contracts, correlation/trace context, logging/telemetry ports, health/readiness/shutdown, contract versioning, test harnesses, CI conventions, security defaults, quotas/rate limits, i18n/time zones/currencies, privacy/retention/deletion policy. | No product entities, vendor SDKs, or vertical vocabulary. |
| Always-on platform modules | Users, credentials/accounts, sessions/refresh tokens, verification/recovery, MFA/passkeys, organizations/workspaces, memberships, roles/permissions, tenant authorization, per-product superadmin, audit/security events, generic search/query records, notifications, files/assets/uploads, feature flags/config, idempotency/outbox, job/event contracts, migrations/seeds, admin APIs/UI. | Operationally present in the baseline; product modules consume ports and tenant-scoped use cases. |
| Required data platform | PostgreSQL/Neon relational source of truth for identity, tenancy, authorization, audit, search records, job ledger, idempotency, outbox, quotas, and transactional aggregates; MongoDB for explicitly assigned document/read-model workloads. | Every collection/table has an owner; no uncoordinated dual writes. |
| Provider adapters | B2 storage; PostgreSQL/Neon; MongoDB; Redis; SQS/DLQ; email; Mercado Pago; WhatsApp/notification channels; AWS AI/cloud services; Groq capabilities retained from `backendFiles`. | SDKs stay behind ports; local deterministic fakes implement the same contracts. |
| Runtime profiles | Node API, Next.js/React web, Expo mobile, and mandatory Python/LangGraph runtime with shared versioned contracts. | UI renders state and captures intent; orchestration/security/persistence remain server-side. |
| Neutral reference application | End-to-end proof of identity, tenancy, CRUD, search, files, notifications, jobs, AI, audit, observability, web/mobile/API integration, and superadmin separation. | Separate app/package; never a core domain template. |
| Fallback reference scenarios | Isolated tusservicios-inspired scenarios only where a universal use case cannot prove a capability (for example marketplace-like search, messaging, or provider settlement). | Scenario fixtures, routes, and tests cannot leak into core packages/base apps. |

### AI Capability and Use-Case Matrix

LangGraph owns orchestration, durable state, thread/session semantics, and workflow policy. AWS is the comprehensive principal provider. Groq is limited to reusable LLM/STT/TTS capability harvested from `apps/api/backendFiles`; it is not an independent orchestration stack.

| Capability | Neutral contract/implementation to explore | Cross-project use case | Provider/ownership boundary | Evidence and anti-scope |
|---|---|---|---|---|
| LLM/chat | Model invocation, messages, metadata, streaming, cancellation, structured errors. | Support assistant, summarizer, content drafting. | LangGraph port; AWS Bedrock Converse first; Groq adapter where retained. | Deterministic fake plus provider conformance; no product prompts in core. |
| Structured output | Schema-bound generation and validation with repair/error metadata. | Extract typed records from user text/documents. | Contract package is source of truth; provider only generates. | Golden fixtures and invalid-output tests; no domain schema in core. |
| Tool calling/permissions | Typed tool registry, tenant/user authorization, timeout, approval, audit. | Search records, update a user-owned resource, invoke a job. | LangGraph tool nodes; policy service owns permissions. | Deny-by-default tests; no autonomous privileged tool. |
| Agents, subgraphs, supervisors | Composable graph registry and bounded supervisor routing. | Multi-step research, workflow triage, media processing. | LangGraph only; never Bedrock Agents/Flows. | Graph fixtures and recursion/time budgets; no business-agent framework. |
| Short/long-term memory | Thread state, user/tenant memory namespace, retention/deletion, retrieval policy. | Conversation continuity and reusable preferences. | PostgreSQL/checkpoints plus explicit document/vector adapter. | Tenant isolation and deletion tests; no unbounded personal profiling. |
| Sessions/threads/checkpoints | Durable run identity, resumable thread, checkpoint versioning. | Resume interrupted agent or media workflow. | PostgreSQL/Redis local and durable checkpoint adapters. | Restart/resume/idempotency fixtures; no queue-only state. |
| Durable runs/HITL | Run ledger, status transitions, interrupt/resume, approval expiry. | Human approval for a sensitive tool or generated result. | PostgreSQL ledger; SQS/Redis transport; LangGraph state. | Crash/replay/duplicate tests; no hidden synchronous long-running work. |
| Prompt/model registry | Versioned prompts/models, owner, environment, rollout, deprecation, approval. | Reproduce and roll back a model behavior. | PostgreSQL registry and config; provider adapters execute. | Registry migration and regression fixtures; no arbitrary runtime prompt injection. |
| Routing/retry/fallback/circuit breaker | Policy-based provider/model selection with observable failure metadata and no silent fallback. | Cost/latency/availability routing by capability and tenant policy. | AWS first; Groq explicitly configured; OTel metrics. | Fake failures and circuit tests; no provider sprawl by default. |
| Usage/cost/quota | Token/audio/image units, budgets, tenant quotas, rate limits, reservations. | Prevent runaway agents and expose product usage. | PostgreSQL ledger plus provider usage metadata; AWS budgets/quotas. | Deterministic accounting tests; no billing product. |
| Safety/privacy/tenant isolation | Redaction, policy checks, guardrails, data classification, tenant context. | Prevent unsafe or cross-tenant responses. | Bedrock Guardrails/ApplyGuardrail; equivalent local policy; Groq paths must use ApplyGuardrail where configured. | Adversarial fixtures and audit events; no medical/legal guarantees. |
| Evaluation/regression | Dataset/fixture runner, expected structured outputs, quality/cost/latency evidence. | Gate prompt/model/provider changes. | Local deterministic runner; owner-approved cloud conformance smoke only. | Versioned fixtures in CI; no hidden live API dependency. |
| RAG/ingestion | Source ingestion, parsing/chunking, lineage, embeddings, retrieval, citations, deletion. | Search tenant-owned documents and knowledge. | B2 source of truth; PGVector baseline; optional Bedrock Knowledge Bases retrieval adapter only. | Fixture corpus and isolation tests; no KB-owned generation/orchestration. |
| Hybrid/vector search | Generic lexical/vector retrieval and rank/filters. | Search documents, records, and semantic content. | PostgreSQL/PGVector baseline; MongoDB read model only when owned; no default OpenSearch. | Recall/tenant-filter fixtures; no universal search ranking business rules. |
| STT/TTS | Batch/realtime transcription and synthesis contracts with timestamps/voice metadata. | Voice notes, accessibility, call/media processing. | AWS Transcribe/Polly principal; retained Groq audio adapter. | Local audio fixtures and provider smoke; no voice identity. |
| Translation | Text/document translation with locale and quality metadata. | Localize notifications, content, and user input. | AWS Translate gated adapter; local fake. | Fixture language pairs; no translation catalog ownership. |
| Vision/multimodal | Image/video input, model content blocks, output schema, size/security limits. | Image understanding, moderation, media classification. | Bedrock multimodal models through current configured availability; no hard-coded unverified model IDs. | Fixture media and provider conformance; no domain diagnosis. |
| OCR/document intelligence | OCR, layout, tables, forms, confidence, page lineage. | Ingest invoices, forms, contracts, and media metadata. | AWS Textract gated adapter; LangGraph coordinates post-processing. | Sanitized documents and confidence tests; no medical extraction logic in core. |
| Moderation/labels | Content safety, labels, confidence, review status. | Moderate uploads, generated content, and user messages. | Bedrock Guardrails and Rekognition moderation/labels; facial identity excluded by default. | Safe/unsafe fixtures and HITL path; no facial recognition. |
| Image generation/editing | Prompt/image input, seed/metadata, asset lineage, policy and quota. | Marketing assets, product previews, creative variants. | Current supported AWS Bedrock image models/services must be verified before naming; adapter is gated. | Local fake and owner-approved conformance; no product-specific art pipeline. |
| Video generation | Async generation job, progress, output asset, cancellation, retention. | Short demos, media variants, storyboards. | Current supported AWS Bedrock video capability must be verified before naming; S3 staging only when required. | Async fake and lifecycle tests; no unbounded rendering platform. |
| Realtime/event streaming | Token/audio/event stream contract, backpressure, cancellation, reconnect. | Chat UX, live transcription, workflow progress. | LangGraph/runtime transport; API/Web/mobile adapters; OTel correlation. | Deterministic stream fixtures; no provider-specific client contract. |
| AWS operational controls | IAM/KMS, CloudTrail, budgets/quotas, CloudWatch through OTel, SQS/DLQ. | Secure and operate all AWS-backed capabilities. | Render workload identity remains unresolved; use federation or tightly scoped rotated assume-role bootstrap. | Local fakes plus explicit owner-approved AWS smoke; no broad shared credential. |

Each row must eventually prove: a reusable contract/implementation, a real cross-project use case, an isolated fallback scenario when necessary, tests/evidence and configuration, provider/data/security/cost ownership, and explicit anti-scope. This matrix is exploration scope, not an implementation commitment for one slice.

### Identity, Data, Deployment, and Provider Reuse Decisions

| Concern | Direction | Reuse decision |
|---|---|---|
| Identity | New factory integration based structurally on `auth-kit-standalone`, selectively incorporating stronger integrated behavior: atomic refresh rotation, token hash/family checks, registration session persistence, revocation, and tests. Required email/password, verification, recovery, sessions/device management, MFA, and passkeys. | Keep both source folders read-only. Correct role escalation, access-token revocation blindness, CSRF/cookie inconsistency, unauthenticated MFA, incomplete reset/verification, migration/adapter mismatch, stale dist, and DNI/host/guest/Alqui coupling in the new integration. OAuth/OIDC requires owner confirmation. |
| Tenancy/admin | Organizations/workspaces, memberships, tenant-scoped authorization, default organization for simple products, and a separate audited platform superadmin per generated product. | Do not create a shared central panel or collapse product superadmin into organization admin. |
| PostgreSQL | Transactional source of truth for users, credentials, sessions, organizations, memberships, roles/permissions, audit/security events, search query records, job/run ledger, idempotency/outbox, quotas, and aggregates. | Prisma for straightforward CRUD; parameterized raw SQL for atomic refresh rotation, idempotency/outbox, aggregates, and hot paths. Adapt universal concepts from `travelers_clean.sql`; reject travel/property/reservation tables. |
| MongoDB | Always operational for explicitly assigned document workloads/read models whose ownership is documented. | Never dual-write the same source-of-truth record without a defined projection/reconciliation rule. |
| Object storage | B2 is primary source of truth for assets; temporary encrypted lifecycle-managed S3 is allowed only for AWS async service staging. | Preserve neutral asset metadata/lineage ports; isolate copied DocPhone upload code and rewrite its coupling. |
| Jobs/events | Redis local and SQS+DLQ production with equivalent contracts. PostgreSQL owns run ledger/idempotency, not the transport. | Retain workflow schemas and Python queue seam; replace BLPOP-only semantics with durable claim/ack/retry behavior during implementation. |
| AI providers | AWS comprehensive principal; Groq only LLM/STT/TTS primitives already present in `backendFiles`; LangGraph authority. | Preserve retry/HTTP/audio primitives; rewrite provider contracts, routing, streaming, tools, quotas, and tenant context. Remove OpenAI/Anthropic defaults from the neutral principal path unless explicitly gated adapters are approved. |
| Notifications/payments | Neutral ports for email, WhatsApp/notification channels, and Mercado Pago where reusable evidence supports them. | Keep vendor logic behind adapters; no product payment or messaging workflow in core. SES is gated for email; Pinpoint is excluded. |
| Observability | OTel across Node/Python/mobile boundaries with redaction, correlation, metrics, traces, logs, and CloudWatch-compatible export. | Preserve OTel ports and Python telemetry; wire them through middleware/interceptors rather than domain imports. |
| Deployment | Docker Compose is the complete local integration profile. Render-native web/background services are the production profile; no production Docker. | Fix root build context/lockfile and encode worker/service lifecycle. Resolve Render-to-AWS workload identity before production conformance. |

### Keep / Adapt / Rewrite / Remove Contamination / Defer

| Decision | Items and rationale |
|---|---|
| Keep | pnpm/Turbo/strict TypeScript intent; Clean/Hexagonal boundaries; mobile SecureStore/MMKV/offline/image/error/logger infrastructure; JSON Schema asset/workflow contracts; Python/LangGraph/checkpointer/asset/vector seams; OTel ports; non-root container intent; Vialovers evidence for Node/Express/pg/SQL migrations/Redis/Zod/logging/health patterns. |
| Adapt | API startup and readiness; package namespaces; config and fail-fast env validation; contract ownership; persistence profiles into the mandatory PG+Mongo baseline; Redis/SQS transport; B2 adapter; Mercado Pago/email/WhatsApp ports; mobile identity/profile config; workflow lifecycle; docs and claims; Vialovers services that need neutral ports. |
| Rewrite | Auth integration; API error/request/security/tenant/admin boundaries; Python graph/provider abstraction; AI routing and capability contracts; job producer/ledger/idempotency/outbox; tests and CI; deployment profiles; generic search/notification/file/upload modules. |
| Remove contamination from core | Alqui names/keys/package identifiers/screens/OAuth defaults; Travelers tables/domain; DocPhone routes/types; medical schemas/prompts; companion/Tilo logic; Google/Vertex imports/config; product-specific business workflows and copied provider implementations that cannot be neutralized. Preserve useful code only through neutral ports/adapters or isolated reference packages. |
| Defer | Versioned generator; OAuth/OIDC pending owner choice; named Bedrock image/video models until current official availability is verified; advanced AWS adapters not in the bounded first profile; GraphQL/CQRS/event sourcing/Kubernetes/multi-region; product billing and vertical modules. |

### Approaches

1. **All-in universal monolith** — Wire every database, UI, provider, AI capability, and reference workflow into the existing apps by default.
   - Pros: few profile decisions and one visible runtime.
   - Cons: preserves contamination and coupling, makes every product pay for irrelevant dependencies, creates unbounded test combinations, and conflicts with neutral-core rules.
   - Effort: High

2. **Neutral core with always-on platform modules and bounded provider/runtime adapters** — Keep the required PG/Mongo/Redis-local/SQS-production/Python baseline operational, while separating contracts, ports, adapters, references, and gated AI/provider capabilities. Deliver one verified vertical slice per dependency group.
   - Pros: satisfies the mandatory baseline, preserves reusable capability, makes ownership and evidence explicit, isolates vertical examples, and allows incremental rollback.
   - Cons: requires boundary cleanup, contract consolidation, explicit support matrix, and substantial test/operational work before the result is genuinely reusable.
   - Effort: High

3. **Split runtime starter repositories** — Separate Node/web/mobile and Python/AI repositories with shared contracts.
   - Pros: smaller individual repositories and independent runtime releases.
   - Cons: weakens the fully wired factory, duplicates security/DX/deployment policy, and makes cross-runtime compatibility harder to prove.
   - Effort: High

### Recommendation

Choose **Approach 2**. Reframe this repository as a neutral factory platform with a mandatory operational baseline, not as a completed application and not as a collection of empty interfaces. Preserve and harden the proven reusable slices, build explicit ownership and contract boundaries, isolate reference scenarios, and stage the comprehensive AI catalog behind deterministic local fakes and owner-approved cloud conformance tests. The first implementation plan should be sliced by dependency order rather than by product feature, and should not begin until the owner confirms unresolved identity, AWS credential, data residency, cost, and AI model availability decisions.

### Phased Roadmap (Planning Only)

| Phase | Bounded outcome | Dependencies / exit evidence |
|---|---|---|
| 0. Scope and inventory | Freeze neutral taxonomy, contamination inventory, capability ownership matrix, supported baseline, and reference boundary. Reconcile docs with code evidence. | Owner confirms open decisions; no code behavior changes required in exploration. |
| 1. Deterministic foundation | Repair workspace/lockfile/package namespaces, config validation, startup/shutdown/readiness, API contracts/errors, Docker Compose complete local profile, Render service/worker shape, and minimal CI harness. | Clean install/build/typecheck/lint/test path; provider-free local startup. |
| 2. Security and tenancy | Implement new identity integration, sessions/rotation/revocation, verification/recovery/MFA/passkeys, organizations/memberships/authorization, product superadmin, audit/security events, and privacy lifecycle. | Auth/tenant isolation/security regression fixtures; source auth folders unchanged. |
| 3. Data and platform modules | Add PostgreSQL models/migrations/seeds and ownership matrix, Mongo document boundaries, generic search, notifications, files/assets/uploads, feature flags, quotas, idempotency/outbox, and job/run ledger. | Contract and transactional tests; no ambiguous dual writes; B2 and local adapters proven. |
| 4. Durable cross-runtime runtime | Make Python/LangGraph authoritative, align TS/JSON/Python contracts, implement Redis/SQS equivalent transport, DLQ/retry/claim semantics, checkpoint/resume/HITL, OTel propagation, and worker lifecycle. | Crash/replay/idempotency fixtures and local Compose integration evidence. |
| 5. AI capability slices | Deliver model registry/routing, LLM/structured/tools, memory/RAG, speech, translation, multimodal/OCR/moderation, image/video gated adapters, evals, safety, cost/quota, and streaming as separately verifiable slices. | Every matrix row has contract, use case/reference, fake/fixture, config, ownership, and anti-scope; AWS smoke is explicit and owner-approved. |
| 6. Neutral reference integration | Wire web/mobile/API/reference app through identity, tenancy, CRUD/search/files/jobs/AI/audit/observability and superadmin paths. Add isolated tusservicios-inspired fallback scenarios only where required. | Docker full integration and separate local/provider conformance evidence; no reference vocabulary in core. |
| 7. Operational hardening | Render production configuration, AWS IAM/KMS/budgets/quotas/CloudTrail, CloudWatch via OTel, alerting, retention/deletion, rollback/runbooks, and compatibility documentation. | Owner-approved credentials/data residency/cost controls and production smoke evidence. |

The versioned generator is deliberately outside these slices. Its future prerequisite is a stable package/profile matrix and upgrade policy, not a code-generation implementation now.

### Risks and Open Decisions

#### Major risks

- Scope breadth can produce a nominally complete catalog with shallow implementations. The matrix's evidence and anti-scope columns must be gates for each slice.
- Mandatory PostgreSQL and MongoDB increase operational and test cost; explicit source ownership is required to prevent divergent data.
- Identity integration can reproduce privilege escalation or token-revocation defects if the two read-only sources are copied mechanically.
- Python/LangGraph dependencies are currently provider-heavy and partially disconnected; making them principal without lifecycle, contracts, and durable run semantics will create false readiness.
- Render-to-AWS workload identity is unresolved; a shared broad static credential is unacceptable.
- AWS model IDs, Regions, quotas, and image/video availability change independently; names and defaults must be configuration-driven and checked for active availability.
- B2-to-AWS asynchronous staging can create residency, encryption, retention, and cleanup failures.
- Existing copied `backendFiles` mix useful Groq/audio primitives with medical, companion, and DocPhone code; selective extraction must avoid domain leakage.
- Contract duplication between Zod, JSON Schema, and Pydantic can silently drift without a declared source of truth and compatibility tests.
- The repository has pre-existing uncommitted baseline artifacts and no configured Git remote; exploration must not overwrite or normalize them implicitly.

#### Questions requiring owner input

1. Should OAuth/OIDC be included in the first identity scope, or remain a later adapter after email/password, verification, recovery, sessions, MFA, and passkeys?
2. Which data-residency regions and retention/deletion guarantees are mandatory for PostgreSQL, MongoDB, B2, transient S3, and AWS AI providers?
3. What monthly AWS/Groq budget, per-tenant quota, and approval threshold should govern expensive speech, OCR, image, and video capabilities?
4. Which Render-to-AWS credential strategy is approved: external federation/Roles Anywhere, or a tightly scoped rotated bootstrap key that only assumes per-service/per-environment roles?
5. Which AWS Regions and owner-approved conformance smoke tests are permitted, and who approves enabling gated SES, Translate, Textract, Rekognition, Knowledge Bases, image, and video adapters?
6. Are Mercado Pago and WhatsApp required in the first platform slice as configured adapters, or only as neutral contracts plus reference implementations?

### Ready for Proposal

Yes, with a controlled handoff. Exploration is complete and sufficiently evidenced for the orchestrator to show the owner the scope, taxonomy, AI matrix, roadmap, risks, and six open decisions. Do not advance automatically: wait for owner clarification/approval before formal proposal work. The next phase, if authorized, should turn the bounded Phase 0/Phase 1 outcomes into a formal proposal without implementing or testing code in this exploration phase.
