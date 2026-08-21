# Product Factory Traceability Specification

## Purpose

Make the approved roadmap auditable: every proposal ledger row and AI catalog row maps to a requirement and an independently reviewable evidence gate.

## Requirements

### Requirement: Capability-ledger traceability

Before implementation tasks are created, every row MUST have an owner, dependency phase, contract, implementation path, local fake/fixture, neutral use case, configuration, security/data/cost policy, and evidence gate; no task MAY hide multiple rows behind one completion claim. Rationale: breadth without bounded proof produces nominal completeness.

| Proposal ledger rows | Requirement | Evidence gate |
|---|---|---|
| users/accounts/credentials; sessions/refresh/devices; verification/recovery | identity-tenancy: successor authentication lifecycle | tenant-safe CRUD; hash/family rotation; expiry/replay; restart/audit |
| organizations/workspaces/memberships/tenants; roles/permissions/superadmin | identity-tenancy: tenant authorization | cross-tenant denial; deny-by-default; audited admin |
| audit/security events; privacy/retention/deletion | identity-tenancy: privacy lifecycle | redaction, consent, deletion propagation, retention |
| generic CRUD/search; assets/uploads/lineage | data-platform-crud: universal primitives | pagination/filter tenant proof; B2 lineage/lifecycle |
| notifications/email; flags/config; quotas/rate limits | data-platform-crud: platform primitives | delivery retry; profile resolution; exhaustion/accounting |
| idempotency/outbox; jobs/events/run ledger | data-platform-crud and durable-langgraph-runtime | atomic duplicate proof; crash/replay; DLQ/reconciliation |

#### Scenario: Missing ledger evidence
- GIVEN a proposed implementation slice with an unowned or untested row
- WHEN traceability is checked
- THEN the slice cannot be marked complete and the missing evidence is named without blocking unrelated local work

### Requirement: AI-catalog traceability

Every AI row MUST map to a contract, implementation, fake/fixture, neutral use case, provider/data/security/cost owner, quota/guardrail policy, availability disposition, and evidence.

| AI catalog rows | Requirement | Evidence gate |
|---|---|---|
| LLM/chat; structured output; tools/permissions | ai-capability-catalog: complete LangGraph catalog | schema/error/tool-denial fixtures; usage/cost |
| agents/subgraphs/supervisors; memory; sessions/checkpoints; durable runs/HITL | durable-langgraph-runtime | resume, approval, crash/replay, tenant isolation |
| prompt/model registry; routing/retry/circuit breaker; evaluation | ai-capability-catalog | version rollback; fake failures; quality/latency/cost |
| safety/privacy/guardrails; usage/cost/quota; streaming | ai-capability-catalog | redaction, quota, adversarial, reconnect fixtures |
| RAG/ingestion; hybrid/vector search | rag-knowledge | lineage, recall, filters, citations, delete/reindex |
| STT/TTS; translation; vision; OCR; moderation | ai-capability-catalog | sanitized media/language/safety conformance |
| recommendations; image generation/editing; video generation/editing | ai-capability-catalog | relevance/media correctness, cancellation, retention, availability disposition |
| AWS operational controls | provider-adapters and operational-hardening | IAM/KMS, audit, budgets, quotas, telemetry, recovery |

#### Scenario: Traceable catalog decision
- GIVEN an unavailable AWS model or gated provider
- WHEN the catalog is reviewed
- THEN the row remains implemented and fake-tested, records its alternative/disposition and owner, and is not silently omitted or called production-ready
