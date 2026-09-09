# TUS Launch Surfaces and Operations Specification

## Purpose

Define customer/operator journeys, runtime operations, deployment evidence, and go-live gates for Argentina.

## Requirements

### Requirement: Web/PWA, Android, and iPhone journeys

The web/PWA, Android, and iPhone surfaces MUST provide role-appropriate discover/buy/book/status/support journeys and operator flows for shifts, catalog, calendar, POS, delivery, and recovery. Clients MUST be thin contract consumers; authorization, pricing, idempotency, and audit MUST remain server-side. Evidence: browser/mobile, deterministic, real-PostgreSQL, external-blocked.

#### Scenario: End-to-end customer journey
- GIVEN a published product or service and an authorized customer
- WHEN the customer discovers, purchases/books, pays through approved checkout, and views status
- THEN the correct separate commitment, receipt/status, consent, and support path is visible on the tested surface

#### Scenario: Mobile interruption or forbidden role
- GIVEN an iPhone/Android app is interrupted offline or an operator lacks a capability
- WHEN it resumes or loads the route
- THEN it shows recoverable pending/conflict state or an accessible denial and does not invent success

### Requirement: Bounded backend runtime and security operations

The backend MUST use root `.env` `DATABASE_URL`, a 60-second DB timeout with one retry, explicit development seed confirmation, bounded startup/readiness/shutdown, schema-aware `/ready`, strict CORS/body/rate limits, redacted correlation-aware errors, structured observability, owned worker lifecycle, and recovery fencing. Evidence: deterministic, real-PostgreSQL, deployment.

#### Scenario: Startup or readiness failure
- GIVEN configuration, database, schema, or worker dependency is invalid
- WHEN startup or `/ready` runs
- THEN it stops after two total DB attempts or returns 503 without a usable listener or secret leakage

#### Scenario: Malicious request or stale worker
- GIVEN an oversized/disallowed-origin request, unknown route, expired claim, or worker restart
- WHEN the boundary processes it
- THEN it returns a bounded redacted error or rejects the stale claim, while preserving correlation and retry/DLQ evidence

### Requirement: Render, Vercel, DNS, and support readiness

Render API/web/worker, Vercel web, DNS, health/readiness, environment ownership, logs, rollback, support, and incident runbooks MUST be validated per deployment profile. Static manifests or successful builds MUST NOT be promoted to live evidence; a one-shot worker MUST NOT be treated as durable. Evidence: deployment, deterministic, external-blocked.

#### Scenario: Authorized deployment proof
- GIVEN current owner-authorized Render/Vercel/DNS settings, live health responses, logs, worker lifecycle, and rollback proof
- WHEN the launch profile is evaluated
- THEN only that scoped profile may be marked deployment-ready

#### Scenario: Missing live proof
- GIVEN URLs, settings, worker runtime, DNS, or logs are unavailable
- WHEN go-live is requested
- THEN the result is `external-blocked`/`not-production-ready` and no production claim is emitted

### Requirement: P0 go-live gates and evidence truth

Go-live MUST remain blocked by any technical P0 or missing required schema/restore, tenant/security, money/provider, WhatsApp, delivery, tax/invoice, device/POS, deployment, operations/support, or legal evidence. Every result MUST carry exactly one or more boundary classes: deterministic, real-PostgreSQL, browser/mobile, provider, deployment, legal/external-blocked. Evidence classes MUST NOT be promoted. Evidence: all listed classes.

#### Scenario: Complete gate envelope
- GIVEN all applicable owner-scoped evidence is current, unrevoked, and reproducible
- WHEN launch readiness is calculated
- THEN only the covered Argentina capability is enabled and its evidence references are recorded

#### Scenario: P0, expired, or conflicting evidence
- GIVEN a P0, expired/revoked record, conflicting owner decision, or missing external proof
- WHEN readiness is calculated or rollback requested
- THEN activation fails closed, intake/jobs are disabled or drained, state is preserved, and rollback uses verified restore/compensating entries only

`Goldenrepo-js_py` (underscore sibling), global launch, rentals, financing, regulated healthcare, custody/escrow, open-driver bidding, and unbounded AI authority remain excluded.
