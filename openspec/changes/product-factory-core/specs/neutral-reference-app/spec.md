# Neutral Reference Application Specification

## Purpose

Prove that the factory is usable end to end without turning the core into tusservicios, Alqui, Travelers, DocPhone, medical, companion, or another vertical product.

## Requirements

### Requirement: End-to-end neutral proof

The reference application MUST demonstrate registration/verification, tenant membership and authorization, generic CRUD/search, assets, notifications, jobs, AI/RAG, audit, telemetry, web/mobile/API integration, and separate product superadmin through a complete Compose or supported production profile; UI clients MUST render state and capture intent while server/runtime owns policy and orchestration. Native local API/web smoke is a developer check only and MUST NOT substitute for this end-to-end proof. Rationale: a reference flow is the evidence that contracts compose.

#### Scenario: Happy-path product team
- GIVEN a fresh complete integration profile and a neutral workspace
- WHEN a user signs up, verifies, creates a resource, uploads knowledge, runs a job, and views a result
- THEN each step is tenant-scoped, observable, idempotent where retried, and visible through the documented contract

#### Scenario: Failure and retry
- GIVEN a notification, provider, or worker failure during the flow
- WHEN the user retries or resumes
- THEN the UI exposes state, the ledger/outbox prevents duplicate effects, and no client bypasses authorization

#### Scenario: Boundary and rollback
- GIVEN an attempted cross-tenant read or a bad reference release
- WHEN the action or rollback runs
- THEN access is denied without disclosure and the last passing reference wiring is restored without removing platform contracts

### Requirement: Isolated fallback scenarios and contamination proof

The system MAY include tusservicios-inspired marketplace, messaging, or settlement fixtures only when a universal capability cannot prove itself; such fixtures MUST live outside core packages and MUST contain no vertical names, schemas, prompts, routes, credentials, or assumptions in reusable modules. Rationale: realistic evidence must not become copied business logic.

#### Scenario: Fallback isolation
- GIVEN a capability requiring a marketplace-like example
- WHEN its isolated scenario runs
- THEN it uses explicit fixture boundaries and cannot be imported by the neutral core

#### Scenario: Contamination check
- GIVEN a clean-environment scan of core packages and base apps
- WHEN vertical vocabulary or excluded provider defaults are found
- THEN the evidence gate fails and the reference is not advertised as neutral
