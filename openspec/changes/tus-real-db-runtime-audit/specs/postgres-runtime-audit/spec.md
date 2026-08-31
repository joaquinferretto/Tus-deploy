# PostgreSQL Runtime Audit Specification

## Purpose

Define safe, repeatable PostgreSQL evidence without touching unknown or production data.

## Requirements

### Requirement: Canonical source and explicit development authorization

The audit MUST read `DATABASE_URL` only from the repository-root `.env`; alternate URL variables MUST NOT be read, introduced, or used as overrides. A remote target MAY be used only when `NODE_ENV=development` and `--confirm-development-target` are both explicit. The flag is user authorization/attestation, not automated proof of ownership, disposability, or production safety. Production MUST refuse regardless of the flag.

#### Scenario: Root URL is sole source
- GIVEN root `.env` contains `DATABASE_URL` and another URL variable is present
- WHEN the audit resolves its target
- THEN only the root value is considered, the alternate is ignored or refused, and no URL value is emitted

#### Scenario: Remote development authorization
- GIVEN `NODE_ENV=development`, the explicit `seed` command, and `--confirm-development-target`
- WHEN a remote target is requested
- THEN the audit may proceed to bounded checks, records the attestation as user intent only, and does not call it automated production proof

#### Scenario: Production refusal
- GIVEN `NODE_ENV=production`, with or without `--confirm-development-target`
- WHEN seed or audit access is requested
- THEN it refuses before connection side effects and records only redacted denial metadata

### Requirement: Bounded connection and startup attempts

Each database connection or startup attempt MUST finish within 60 seconds. The audit MUST perform exactly one retry after a failed or timed-out first attempt and MUST never make a third attempt.

#### Scenario: Timeout and single retry
- GIVEN the first connection/start attempt exceeds 60 seconds
- WHEN the retry policy is applied
- THEN one additional bounded attempt is recorded and the audit stops without further retry

### Requirement: Additive idempotent seed and targeted cleanup

Migrations MUST be additive and preserve existing data. An authorized run MUST seed namespaced fixtures twice, verify stable identities, counts, tenant isolation, and zero duplicates, and permit cleanup only for exact tagged fixtures. Reset, truncate, cascade deletion, and untagged deletion MUST NOT occur.

#### Scenario: Two-run verification
- GIVEN authorization and additive migration preflight pass
- WHEN migration, seed twice, verification, and targeted cleanup run
- THEN the second seed adds no duplicate, identities/counts remain stable, and no untagged data is changed

### Requirement: Truthful redacted evidence

Evidence MUST contain redacted metadata only: no URL, credential, token, cookie, PII, secret, or raw secret-bearing output. Results MUST distinguish `deterministic`, `real-postgres`, `browser/mobile`, `deployment`, and `external-blocked`; `real-postgres` MAY be recorded only after actual successful PostgreSQL proof.

#### Scenario: Blocked or unrun proof
- GIVEN authorization, target proof, or another dependency is unavailable
- WHEN the audit stops before successful PostgreSQL verification
- THEN it records the redacted blocker, zero unperformed side effects, and no real-PostgreSQL or production-success claim
