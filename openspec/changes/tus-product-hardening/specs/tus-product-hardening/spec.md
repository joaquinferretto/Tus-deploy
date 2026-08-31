# TUS Product Hardening Specification

## Purpose

Make persistence and evidence reproducible without secrets or unsafe writes. Evidence tags: **deterministic**, **real-postgres**, **browser/mobile**, **deployment**, **external-blocked**.

## Requirements

### Requirement: Safe database configuration

The system MUST load root `.env` `DATABASE_URL` internally and MUST NOT print, persist, screenshot, or expose it. Before connection, migration, or write, it MUST prove target identity, disposable/test ownership, and non-production status; otherwise it fails closed.

#### Scenario: Unsafe target
- GIVEN identity, ownership, or non-production proof fails
- WHEN any database operation is requested
- THEN it is rejected before side effects and diagnostics contain no credential (**deterministic**; approved checks **real-postgres**)

### Requirement: Idempotent fixtures and non-destructive cleanup

The system MUST require explicit seeding with stable, namespaced identities. Repeated seeds MUST be idempotent. Cleanup MUST affect only tagged fixtures on an approved disposable target; reset, truncate, cascade, and untagged deletion are prohibited.

#### Scenario: Replay and refusal
- GIVEN a fixture version is seeded twice, then cleanup is requested on a shared or production target
- WHEN both actions complete
- THEN seeding creates no duplicates and cleanup refuses with records unchanged (**deterministic** plus **real-postgres**)

### Requirement: Additive PostgreSQL schema and tenant rules

Prisma/PostgreSQL changes MUST be additive and preserve data. Tenant-scoped foreign keys, constraints, and tenant/idempotency indexes MUST exist. Only documented transitions MAY succeed; invalid transitions MUST leave state unchanged.

#### Scenario: Isolation and transition rejection
- GIVEN two tenants and an entity in state S
- WHEN migration, cross-tenant access, and undocumented S→T checks run
- THEN data remains readable, A cannot access B, structures exist, and S remains S (**real-postgres**)

### Requirement: Atomic POS, audit/outbox, and recovery

Product/service POS operations MUST be atomic, caller-key-idempotent, and conflict-safe. Audit/outbox records MUST commit with the business change. Replay and recovery MUST neither duplicate effects nor lose committed events.

#### Scenario: Retry, conflict, and replay
- GIVEN a committed operation, an identical retry, a conflicting concurrent request, and an undispatched event
- WHEN the operation and a restarted worker replay run
- THEN retry returns the original result, conflict has no partial write, audit is preserved, and replay occurs at most once (**real-postgres**)

### Requirement: Bounded child lifecycle

API smoke/helper processes MUST have startup, request, and shutdown deadlines ≤120 seconds, be run-owned, and be terminated on success, failure, timeout, or interruption. No owned child may remain.

#### Scenario: Timeout cleanup
- GIVEN an owned child exceeds its deadline
- WHEN the run aborts
- THEN it terminates, cleanup completes, and the result contains no secret (**deterministic**)

### Requirement: Canonical environment contract

All environment consumers MUST be inventoried before normalization, with one canonical name/source per value. A variable MAY be removed only when repository evidence proves it unused; otherwise it MUST remain supported or fail clearly.

#### Scenario: Safe normalization
- GIVEN consumers and local/Render/Vercel manifests are mapped
- WHEN an alias is replaced
- THEN code, tests, docs, and deployments use it consistently (**deterministic**)

### Requirement: Bounded real workflow evidence

API, authenticated web, mobile, and POS journeys MUST use finite Playwright/Chrome DevTools checks and screenshots; each flow MUST finish within 180 seconds. Hardware gaps MUST be unproven, never passed.

#### Scenario: Evidence or external block
- GIVEN owned services and approved credentials, or an unavailable device/provider
- WHEN the journey runs or cannot run
- THEN outcomes/screenshots receive **browser/mobile**, or it is **external-blocked** with no success claim (**browser/mobile**)

### Requirement: Reproducible startup and fail-closed rollback

Local, Render, and Vercel build/start contracts MUST run from documented inputs without hidden state, long-lived services, or orphans. Provider, cloud, compliance, and production claims MUST require direct evidence. Rollback MUST never reset; it MAY quarantine tagged fixtures or use approved recovery while preserving audit/evidence.

#### Scenario: Deployment and failed phase
- GIVEN documented inputs or a failed phase/migration
- WHEN startup validation or rollback runs
- THEN it is reproducible and **deployment**-tagged, or recovery is non-destructive; absent external proof is **external-blocked** (**deployment**)
