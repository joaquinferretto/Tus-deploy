## Exploration: golden-base-readiness

### Current State

The repository is a promising but incomplete golden-repository scaffold, not a production-ready platform. The baseline commit is `8f3616a47a0c8ec559c4f4f32d567d0735b023fb` on `pre-cambios`; CodeGraph reports a healthy index of 59 files, 615 nodes, and 1,270 edges. The implementation was inspected directly rather than inferred from `README.md`, `ARCHITECTURE.md`, or `.ai-manifest.md`.

#### What is genuinely implemented

| Area | Evidence | Reusable value | Assessment |
|---|---|---|---|
| Repository/tooling | `pnpm-workspace.yaml`, `turbo.json`, shared TypeScript/ESLint packages, root `Makefile` | Good starting monorepo conventions | Useful, but not currently install/release deterministic because no root `pnpm-lock.yaml` exists |
| API edge | `apps/api/src/server.ts`, security middleware, `/health`, `/ready`, Postgres/Mongo/Redis clients | Small HTTP shell and health probes | Scaffold-only; there are no business routes, controllers, use cases, domain entities, repositories, auth, or error middleware |
| Web | Next.js App Router, React Query provider, typed fetch helper, Zustand example store | Basic web profile starting point | Shell/example only; the page is a stack overview and no feature or auth/data flow is wired |
| Mobile | Expo Router bootstrap, auth route guard, encrypted SecureStore/MMKV persistence, Axios client with refresh/retry, offline React Query persistence, image manager, Sentry-safe logger, error boundary, FlashList sample | Strongest reusable capability slice in the repository | Partially production-shaped, but still contains `Alqui` product identity, has no actual auth use case, and has no covering tests |
| Cross-runtime contracts | JSON Schemas for workflow jobs/state, assets, lineage, and publishing; AJV validation script; Python validates the same schemas | Real TS/JS-to-Python boundary | Valuable foundation, but there is no API producer or contract test matrix proving compatibility |
| Workflow/AI runtime | Python queue consumer, LangGraph graph, configurable Postgres/Redis/memory checkpointer, S3 asset adapter, PGVector ingestion, JSON logging, optional LangSmith | A credible optional worker/media/AI profile | Not a universal core; it is provider-heavy, OpenAI-oriented in the graph/embeddings, and lacks operational lifecycle guarantees and tests |
| Observability | `packages/observability` exposes OpenTelemetry tracer/logger ports; Python has JSON logs and LangSmith hooks | Correct direction for a runtime-neutral seam | TS package is not wired into the API; metrics/exporter setup and trace propagation are absent |
| Local infrastructure | `docker-compose.yml` provisions Postgres, MongoDB, Redis with healthchecks; API/web Dockerfiles use non-root runtime users | Useful local profile ingredients | Too heavy as a universal default and currently inconsistent: Compose builds with `./apps/api` context while the Dockerfile copies root workspace files |
| Security | Helmet, CORS, rate limiting, circuit-breaker helper, secret scan, SAST, audit commands | Good baseline intent | Controls are not a complete security boundary; no API authentication/RBAC/tenancy, no standardized security headers/error policy, and security CI is the only CI workflow |
| Documentation | README, architecture guide, AI manifest, worker README, OpenSpec config | Makes intended patterns discoverable | Several claims describe future or absent behavior, including auth, observability, tests, migrations, `/ready` semantics, and the old two-app structure |

#### Evidence-based maturity scale

The scale is: **0 absent**, **1 described or placeholder**, **2 partial scaffold**, **3 reusable baseline with bounded gaps**, **4 production-ready reusable capability**.

| Dimension | Score | Evidence-based conclusion |
|---|---:|---|
| Architecture and boundaries | 2 | API and mobile folders express boundaries, but API inner layers are README placeholders and shared packages are not consistently consumed |
| Developer experience | 2 | Turbo, pnpm intent, Make targets, strict TS, and local Compose exist; missing lockfile, invalid/stale commands, mixed npm/pnpm, and broken Docker context reduce day-one usability |
| Auth, security, and tenancy | 1 | Security middleware and mobile credential storage exist; API auth, RBAC, tenant context, session lifecycle, and authorization policy are absent |
| Data and persistence | 1 | Client adapters and readiness checks exist, but Prisma schema is empty, migrations/seeds are absent, and three stores are imposed without a selection profile |
| API contracts and error handling | 2 | JSON Schema and mobile/web client result types are useful; API responses are ad hoc, public route contracts are not generated/enforced, and no error envelope exists |
| Frontend and mobile | 2 | Mobile infrastructure is substantial; web is a minimal shell and mobile product flows are placeholders |
| Async jobs and events | 2 | A Redis/BullMQ-compatible Python consumer and workflow contracts exist; no producer, durable retry/dead-letter policy, idempotency, scheduling, or event adapter exists |
| AI and workflows | 2 | LangGraph, checkpointers, storage, vector ingestion, and LLM nodes are real; the graph is a sample workflow and provider coupling is not abstracted |
| Observability | 2 | JSON logging, Sentry-safe mobile logging, OTEL interfaces, and LangSmith hooks exist; API instrumentation, metrics, exporters, alerting, and cross-runtime propagation are missing |
| Testing | 0.5 | No test files were found; mobile test directories contain only `.gitkeep`, and API/web Jest configuration is absent despite declared scripts |
| CI/CD | 1 | Security workflow covers secret scan, SAST, and audit; build, typecheck, unit/integration/E2E, artifact, release, and deployment gates are absent |
| Deployment and local environment | 1.5 | Compose and Dockerfiles provide intent and healthchecks; root lockfile is missing, Compose/API context is inconsistent, worker is not a service, and no deployment profiles are encoded |
| Documentation and scaffolding | 2 | Documentation and directory scaffolding are present; there is no generator, preset manifest, upgrade policy, or reliable claim-to-implementation verification |

**Overall maturity: 1.7/4 — scaffold with several high-value capability slices, not a production-ready reusable base.** The strongest current assets are the mobile platform slice and cross-runtime workflow/asset contracts. The largest blockers are deterministic execution, security identity boundaries, persistence lifecycle, tests, and the absence of a real generation/profile model.

#### Missing, duplicated, coupled, obsolete, and heavy elements

- **Missing:** API authentication, RBAC/ABAC, tenant/workspace context, audit trail, standardized error contract, request/correlation middleware, upload API, job producer/lifecycle, notification port, payment interface, i18n/time-zone policy, feature-flag contract, Prisma models/migrations/seeds, test harnesses, full CI, deployment profiles, metrics/exporters, generator, and upgrade strategy.
- **Partial/scaffold-only:** API domain/application/presentation HTTP directories, web components, `@repo/zod-schemas` example, root config claims, Python `main.py` contract demo, and mobile login/protected screens.
- **Duplicated or inconsistent:** `@repo/*` and `@golden/*` package namespaces; TypeScript/Zod contracts alongside JSON Schema without a declared source-of-truth rule; two Python workflow entry paths (`main.py` validation demo versus queue-driven `graph/base.py`); npm lockfile only in mobile while the workspace is pnpm-based; separate TS and Python configuration models.
- **Overly coupled:** the API imports Redis-backed rate limiting at module load; the readiness route creates/checks infrastructure clients as a side effect; the default repository assumes Postgres + MongoDB + Redis; the Python worker directly selects OpenAI, S3, PGVector, Redis, and LangGraph; mobile persistence keys and app identity are hard-coded to `alqui`.
- **Product contamination:** `Alqui` appears in mobile package/app identity, bundle identifiers, storage keys, OAuth defaults, screen copy, and cache keys. These must be moved to a project profile or removed from the universal base.
- **Obsolete or misleading claims:** the docs claim production readiness, 100K+ concurrency, cluster-mode behavior, authentication, migrations, tests, OpenTelemetry, and deployment behavior that the inspected implementation does not provide. `xssFilter` is also retained in the Helmet configuration/docs despite being an obsolete browser-era control and should not be treated as a security capability.
- **Unnecessarily heavy by default:** three persistence systems, a large LangChain/LangGraph/vector/S3 dependency surface, and a full Expo/mobile application are unsuitable defaults for every generated product. They should be selectable capabilities, not one mandatory monolith.

#### Archetypes supported now versus after improvement

**Supportable now, with bounded hardening and explicit limitations:**

1. A web/API proof of concept with health checks, React Query, shared validation, and a small selected persistence adapter; not a secure multi-tenant product.
2. An Expo mobile shell requiring secure local credentials, offline cache, image selection/compression, protected navigation, and an external auth/API implementation.
3. An AI/media workflow prototype using the Python worker, JSON Schema jobs, LangGraph, object storage, and optional vector ingestion.
4. A contract-driven cross-runtime worker integration where TS/JS and Python communicate through versioned JSON Schema messages.

**Supportable after the base improvements:**

1. CRUD/API SaaS products with a selected SQL persistence profile, pluggable auth, migrations, contract-tested endpoints, and deployment presets.
2. Web dashboard or SEO/product frontend profiles backed by the API kernel.
3. Mobile companion applications sharing auth/session, API error, configuration, telemetry, and contract packages.
4. Media/AI products that opt into storage, jobs, workflow, lineage, vector, and provider adapters.
5. Event-driven products that opt into durable jobs/events and notification adapters.

**Not a target:** one monolith containing every database, frontend, mobile app, AI provider, payment provider, vertical workflow, and deployment model. The reusable product is a stable platform core plus explicit profiles and adapters.

### Affected Areas

- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `Makefile` — workspace execution, scripts, package-manager policy, and deterministic DX.
- `packages/typescript-config/`, `packages/eslint-config/` — universal developer/tooling core and architecture enforcement.
- `packages/config/`, `packages/observability/`, `packages/contracts/` — runtime configuration, telemetry ports, and cross-runtime contract governance.
- `packages/zod-schemas/`, `packages/workflows/`, `packages/asset-pipelines/` — contract duplication and capability packages that need clear profile ownership.
- `apps/api/src/server.ts`, `apps/api/src/index.ts`, `apps/api/src/presentation/`, `apps/api/src/infrastructure/` — API kernel, startup/configuration, error/auth boundaries, lifecycle, and adapter selection.
- `apps/api/prisma/schema.prisma` — persistence profile, migration, seed, and tenancy strategy; currently empty.
- `apps/web/src/`, `apps/web/package.json`, `apps/web/Dockerfile` — web profile shell, API contract integration, and build/deployment correctness.
- `apps/mobile/app.config.ts`, `apps/mobile/package.json`, `apps/mobile/app/`, `apps/mobile/src/`, `apps/mobile/tests/` — reusable mobile profile, removal of Alqui identity, and missing test harness.
- `apps/workflow-runtime-python/pyproject.toml`, `apps/workflow-runtime-python/src/worker/`, `apps/workflow-runtime-python/README.md` — optional AI/workflow profile, provider ports, job semantics, and runtime contract alignment.
- `docker-compose.yml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.env.example` — local/deployment profiles, build contexts, explicit configuration, and secret-safe defaults.
- `.github/workflows/security.yml` — CI/CD gate expansion beyond security-only checks.
- `README.md`, `ARCHITECTURE.md`, `.ai-manifest.md`, and placeholder READMEs — claim-to-implementation accuracy, profile documentation, generator usage, and upgrade guidance.

### Approaches

1. **Harden the current all-in monorepo** — Fill the existing API/web/mobile/AI/database stack in place and keep all capabilities enabled by default.
   - Pros: least visible restructuring; preserves current paths and the existing documentation narrative.
   - Cons: perpetuates the three-database and multi-runtime default, increases dependency and deployment cost for every product, leaves vertical/product identity boundaries unclear, and encourages the false universal-monolith goal.
   - Effort: High

2. **Small stable platform core plus optional profiles and adapters** — Define a product-agnostic core for contracts, configuration, errors, observability ports, testing, tooling, and generation; expose web, API, mobile, persistence, jobs, AI/workflow, asset, notification, and payment capabilities as opt-in profiles/adapters.
   - Pros: maximizes reuse without forcing irrelevant infrastructure; makes maturity measurable per profile; preserves strong existing mobile/contracts/workflow slices; supports incremental adoption and clean rollback; keeps vertical/business modules outside the base.
   - Cons: requires an initial boundary/package reorganization, profile metadata, generator conventions, and an upgrade policy; some duplicate-looking contracts must be intentionally consolidated.
   - Effort: High

3. **Split into separate starter repositories** — Maintain independent web/API, mobile, and AI/workflow templates with a small shared contract repository.
   - Pros: smaller installs and clearer runtime ownership; each stack can evolve independently.
   - Cons: loses atomic cross-runtime changes, duplicates DX/security conventions, complicates synchronized upgrades, and weakens the golden repository's ability to bootstrap combined products.
   - Effort: High

### Recommendation

Choose **Approach 2**. Treat the current repository as a capability laboratory and reframe it as a product factory rather than completing it into a universal application. Preserve the genuinely reusable mobile infrastructure, JSON Schema contracts, workflow/asset abstractions, strict TypeScript/tooling intent, and observability interfaces. Move `Alqui` identity and all business-specific workflows out of the base, make databases/AI/mobile/jobs selectable profiles, and verify each profile independently.

#### Proposed reusable structure

| Layer | Belongs in the base | Does not belong in the base |
|---|---|---|
| Universal core | Workspace/toolchain, config/secrets contract, environment validation, error envelope, request/trace context, contract versioning, logging/telemetry ports, test harness, security defaults, generator metadata, upgrade metadata | Product entities, screens, provider-specific business rules, mandatory database fleet |
| Common optional modules | HTTP API kernel, SQL persistence adapter, cache adapter, auth/RBAC/tenant context, object storage/uploads, jobs/events, notifications, i18n/time zones, feature flags, audit trail, payment port, web profile, mobile profile | A provider or domain implementation forced into every project |
| Vertical/business modules | None by default; generated projects add these under a product-owned area | Catalog, orders, pricing, marketplace, B2B workflows, OCR business rules, vendor integrations, tusservicios.com logic |
| Generation/presets | A versioned manifest selecting `core`, `api`, `web`, `mobile`, `sql`, `jobs`, `workflow`, `assets`, and deployment profiles; generated README/config/test skeleton and provenance | Copying the whole repository and deleting unwanted folders manually |

#### Prioritized proposed changes

**P0 — foundation blockers**

| Change | Why / affected areas | Reusable value and dependencies | Do not build yet |
|---|---|---|---|
| Establish core/profile boundary and remove product identity | `apps/mobile/*`, package names, docs, profile metadata; `Alqui` contamination makes the base non-generic | Enables safe generation and independent profile maturity; do before packaging or new business modules | Do not rename every business concept blindly or add a second abstraction layer before inventorying exports |
| Make installation and validation deterministic | Root workspace, lockfile, scripts, Dockerfiles, CI; no root lockfile and Docker Compose/API context mismatch are immediate execution blockers | Every profile can be built, tested, and released reproducibly; dependency for all later work | Do not add more dependencies or claim production readiness before a clean install/build/lint/test path exists |
| Add explicit per-runtime configuration and secret validation | API startup, Python settings, mobile profiles, `.env.example`; remove silent production fallbacks and unsafe placeholder secrets | Prevents misconfigured deployments and makes profiles portable; dependency for deployment and auth | Do not build a secret-management vendor integration into the core |
| Define the platform security boundary | API auth/session port, tenant/workspace context, authorization policy interface, secure defaults, audit hooks | Makes authenticated products possible without mandating one identity provider; dependency for persistence/API profiles | Do not implement a complete product IAM, billing entitlements, or business-specific role matrix |
| Add a minimal executable quality gate | API/web/mobile/Python test harnesses, contract tests, typecheck/build/lint CI; current test inventory is empty | Converts claims into evidence and protects profile upgrades; dependency for all refactors | Do not chase arbitrary coverage percentages or build full E2E suites before one vertical smoke path works |
| Correct runtime lifecycle and deployment profiles | Graceful shutdown, readiness semantics, selected adapters, worker service, Compose contexts, non-default heavy services | Makes local and production execution honest; dependency for observability and jobs | Do not optimize for 100K users or add Kubernetes/blue-green deployment before a reliable single-instance profile |

**P1 — high-leverage reuse**

| Change | Why / affected areas | Reusable value and dependencies | Do not build yet |
|---|---|---|---|
| Standardize API contracts and errors | `packages/contracts`, Zod package, API/web/mobile clients; create one source-of-truth rule and safe error envelope | Consistent clients, retries, correlation IDs, and cross-runtime evolution; depends on P0 contracts/config | Do not add GraphQL or generate every possible SDK before REST/profile contracts are proven |
| Provide persistence profiles with migrations/seeds | Prisma/SQL adapter plus optional document/cache adapters; empty Prisma schema currently proves no persistence foundation | Lets products choose one store and add others intentionally; depends on deterministic config and quality gates | Do not ship Postgres + MongoDB + Redis as a mandatory stack or implement CQRS/event sourcing |
| Operationalize jobs/events and storage ports | Python consumer, workflow contracts, asset storage, retry/idempotency/dead-letter/result semantics | Reuses real workflow/asset work across products; depends on contract/error/observability foundations | Do not add Kafka, multiple queue vendors, or a universal scheduler until one durable adapter is tested |
| Complete observability seam | Wire TS OTEL package into API, propagate trace/correlation context, add metrics and redaction policy, align Python callbacks | Makes every selected profile diagnosable without business code coupling; depends on lifecycle and error contracts | Do not require a hosted vendor or build a full analytics platform |
| Add versioned project presets/generator | Manifest-driven `core`, runtime, data, UI, AI, and deployment selections with generated provenance | Turns the golden repo into repeatable bootstrapping and supports upgrade strategy; depends on stable package boundaries | Do not generate vertical business modules or support arbitrary combinatorial presets initially |
| Add common capability interfaces | Notification, payment, feature flags, i18n/time zones, audit trail, uploads as ports/contracts where evidence supports reuse | Prevents product code from coupling directly to vendors and creates optional capability seams | Do not implement email/SMS/payment vendors, localization catalogs, or enterprise flag management in the base |

**P2 — optional maturity**

- Broader integration/E2E and contract compatibility suites, provider adapters, deployment promotion/rollback automation, dependency update automation, and stronger security policy checks.
- Advanced workflow features such as human-in-the-loop, model routing, vector-store alternatives, lineage querying, and workflow UI.
- GraphQL, CQRS, event sourcing, full-text search, WebSockets, multi-region scaling, 100K-user performance engineering, and blue-green deployment only when a generated product demonstrates a measured need.

#### Keep/change/remove/defer matrix

| Decision | Items |
|---|---|
| Keep | pnpm/Turbo intent, strict TS and shared lint configs, Clean/Hexagonal direction, mobile secure credential/storage/offline/image abstractions, JSON Schema contracts, asset lineage concepts, Python worker seam, OTEL/logger interfaces, non-root container intent |
| Change | Package namespace and ownership, API startup/config/error/auth boundaries, contract source-of-truth, configuration defaults, test/CI commands, Docker/Compose contexts, docs, readiness behavior, persistence selection, workflow lifecycle, and profile naming |
| Remove from universal core | `Alqui` identifiers and screens, example counter/product copy, mandatory MongoDB/Redis/AI/mobile dependencies, unsupported 100K-concurrency and production-ready claims, obsolete `xssFilter` security claim |
| Defer | Product business modules, tusservicios.com implementation, full IAM provider, payment/notification providers, GraphQL/CQRS/event sourcing, multi-region/Kubernetes/blue-green, advanced AI orchestration, and broad generator combinatorics |

#### Base-only roadmap

1. **Phase 0 — Reframe and inventory:** define core/profile taxonomy, normalize package naming, remove vertical identity, reconcile docs with implementation, and freeze the supported baseline profiles.
2. **Phase 1 — Make it executable:** generate/commit the correct workspace lockfile, fix scripts and Docker build contexts, create profile-specific Compose services, add config validation and graceful lifecycle, and prove clean install/build/lint/typecheck.
3. **Phase 2 — Secure and contract the platform:** add error/request context, pluggable auth/RBAC/tenant ports, contract compatibility tests, selected persistence migrations/seeds, and a minimal unit/integration harness.
4. **Phase 3 — Productize capabilities:** stabilize optional API/web/mobile/data/jobs/storage/observability/AI profiles, define retry/idempotency/audit/notification/payment/i18n interfaces where justified, and provide one generated sample per profile.
5. **Phase 4 — Generate and upgrade:** implement versioned presets, provenance, compatibility checks, migration/upgrade notes, dependency update policy, deployment profiles, and release verification. Only then evaluate advanced scalability and provider breadth.

### Risks

- The current repository mixes two generations of design: the original API/web boilerplate and newer mobile/workflow/contract slices. A mechanical merge could preserve contradictions instead of creating a coherent base.
- Moving to profiles can create combinatorial testing cost; begin with a deliberately small supported matrix and reject untested combinations.
- Auth, tenancy, audit, and persistence choices are foundational but product-sensitive. The base should provide contracts and safe defaults, not pretend to solve every identity or data model.
- Python workflow dependencies are large and provider-specific; making them universal would inflate installs and create supply-chain/operational burden for non-AI products.
- Contract duplication between Zod and JSON Schema can cause silent drift unless one source-of-truth and compatibility testing are selected before new schemas are added.
- Documentation currently overstates maturity. Downstream planning must treat code evidence and executable gates as authoritative, not the README's production claims.
- The repository has no configured Git remote, so the required baseline is locally verifiable but cannot be pushed until a remote is provided.

### Ready for Proposal

Yes. The exploration provides enough evidence for a proposal focused exclusively on converting the scaffold into a small, profile-driven golden platform. The proposal should make P0 scope explicit, select the initial supported profile matrix, preserve non-goals around tusservicios.com, and define measurable readiness gates before any vertical implementation begins.
