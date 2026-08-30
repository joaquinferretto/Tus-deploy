# TUS Reporting, Discovery, and Operations Specification

## Purpose

Expose tenant-safe operational truth, SEO/discovery foundations, telemetry, and runbook evidence without presenting stale, revoked, or unproven capabilities as active.

## Requirements

### Requirement: Tenant-safe reports and projections

Reports and read models MUST segment by tenant, context, geography, channel, and lifecycle outcome and MUST derive from auditable events or durable records. Unauthorized scopes MUST return no data.

#### Scenario: Authorized operations report

- GIVEN an authorized operator and current durable events
- WHEN a report is requested
- THEN it returns scoped supply, demand, fulfillment, payment, dispute, POS, and readiness measures with freshness metadata

#### Scenario: Foreign tenant report

- GIVEN a valid session for tenant A requesting tenant B dimensions
- WHEN the query executes
- THEN it is denied or returns an empty authorized scope without leakage

### Requirement: Truthful discovery and SEO

Canonical URLs, sitemap, robots policy, structured data, and search read models MUST exclude unpublished, revoked, stale, policy-invalid, or non-discoverable listings and MUST identify locale and currency assumptions.

#### Scenario: Eligible listing indexed

- GIVEN a current published listing with valid policy and tenant data
- WHEN its discovery projection is generated
- THEN canonical metadata and structured data are emitted consistently

#### Scenario: Listing revoked or stale

- GIVEN a listing is revoked, expired, or policy-invalid
- WHEN discovery artifacts refresh
- THEN it is excluded or marked unavailable and is not presented as transactable

### Requirement: Correlated redacted operations evidence

Critical API, outbox, payment, delivery, POS, support, WhatsApp, and readiness paths MUST emit correlated redacted telemetry and runbook evidence. Credentials and sensitive payloads MUST NOT be recorded.

#### Scenario: Safe critical-path trace

- GIVEN a local authenticated journey
- WHEN it completes
- THEN logs and metrics include correlation, tenant-safe dimensions, outcome, and evidence class without secrets
