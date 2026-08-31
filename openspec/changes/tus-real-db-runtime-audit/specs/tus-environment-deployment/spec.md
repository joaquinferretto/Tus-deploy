# TUS Environment and Deployment Specification

## Purpose

Normalize environment consumers and prove local, Render, and Vercel contracts without activation. This scope preserves deployment/runtime reconciliation and excludes production activation, cloud ownership, credentials, providers, hardware, and compliance.

## Requirements

### Requirement: Canonical environment normalization

Every consumer MUST be inventoried with its canonical name/source before normalization. The repository-root `.env` `DATABASE_URL` MUST be the sole database URL source; ambient, duplicate, legacy, runner, or CLI URL values MUST NOT override it, and no alternate URL variable may be introduced. Remote database use is permitted only under `NODE_ENV=development` plus explicit `--confirm-development-target`; that flag is user authorization, not automated production proof. Secrets MUST remain unprinted and unpersisted.

#### Scenario: Alias reconciliation
- GIVEN local apps, tests, manifests, and runbooks use different names
- WHEN inventory and normalization are checked
- THEN the root source is explicit, alternate URL inputs are ignored or refused, and evidence contains only redacted metadata

#### Scenario: Production environment
- GIVEN `NODE_ENV=production`, with or without the confirmation flag
- WHEN a database-backed operation is requested
- THEN the operation refuses before connection side effects and records no production-success claim

### Requirement: Reproducible deployment contracts

Local, Render, and Vercel build/start contracts MUST declare documented inputs, ports, URL handoffs, migration ordering, and bounded cleanup. Static contracts MUST be recorded separately from `browser/mobile`, `real-postgres`, and live deployment evidence.

#### Scenario: Static-only deployment audit
- GIVEN manifests and runbooks are available but cloud ownership or runtime access is absent
- WHEN contracts are inspected
- THEN deterministic results are recorded, live gaps are `external-blocked`, and no service, migration, seed, or production activation is implied
