# tus-reporting-discovery-operations Specification

## Purpose

Provide tenant-safe reports, SEO/discovery read models, redacted telemetry, explicit deployment composition, and evidence needed to decide an Argentina pilot without overstating deterministic proofs as production behavior.

## Requirements

### Requirement: Tenant-Safe Stage 1 Reporting

Reports MUST expose supply, demand, conversion, fulfillment, payment, settlement aging, disputes, POS/offline, WhatsApp, and readiness dimensions where available. Results MUST be scoped by tenant and role and segmented by context, geography, channel, and lifecycle outcome; financial reports MUST use immutable ledger snapshots.

#### Scenario: Merchant report

- GIVEN an authorized merchant admin requests a date-bounded report
- WHEN the report is generated
- THEN it contains only the merchant's permitted data with query period, currency, source version, and generation status

#### Scenario: Cross-tenant report

- GIVEN a merchant requests another tenant or platform-only dimension
- WHEN the report query runs
- THEN access is denied or the unauthorized dimension is omitted without leakage

### Requirement: Accurate SEO and Discovery Read Models

Published listings MAY be indexed only when cohort, tenant, policy, and visibility checks pass. Canonical URLs, sitemap entries, robots policy, structured data, price/currency, location, and availability presentation MUST be derived from current read models and MUST exclude unpublished, revoked, or stale offers.

#### Scenario: Indexable listing

- GIVEN a published Stage 1 listing has current price, location, and availability metadata
- WHEN its discovery read model is refreshed
- THEN the canonical page and structured data expose those facts consistently

#### Scenario: Revoked listing

- GIVEN publication is revoked or required data becomes stale
- WHEN SEO output is generated
- THEN the listing is removed or marked non-indexable and no stale commercial claim remains

### Requirement: Correlated Redacted Operations Telemetry

Critical commands, provider calls, release evaluations, offline replays, disputes, support actions, and gate decisions MUST emit correlated, tenant-aware, redacted telemetry with outcome and latency. Secrets, payment credentials, and unnecessary personal content MUST NOT be emitted.

#### Scenario: Traceable failure

- GIVEN a payment reconciliation or replay fails
- WHEN the failure is recorded
- THEN telemetry links the correlation and tenant-safe references to an auditable exception without secret payloads

#### Scenario: Tenant boundary incident

- GIVEN an authorization or routing boundary is violated or attempted
- WHEN the event is observed
- THEN an alertable security/operations signal is emitted and the request remains denied

### Requirement: Explicit Deployment and Pilot Evidence

Render/AWS deployment composition MUST explicitly show whether API, web, workers, TUS routes, providers, release jobs, and fleet jobs are enabled. Production pilot claims MUST cite separately authorized Argentina legal/provider, POS, database/API, browser/device, and operational smoke evidence; deterministic tests MUST be labeled as such.

#### Scenario: Failed deployment gate

- GIVEN deployment composition lacks a required gate or evidence reference
- WHEN a pilot release is evaluated
- THEN TUS production commitments, settlement, and fleet jobs remain disabled

#### Scenario: Deterministic CI

- GIVEN provider-free CI passes contract and unit tests
- WHEN readiness is reported
- THEN the report records deterministic coverage without claiming live provider, browser, device, database, or production evidence
