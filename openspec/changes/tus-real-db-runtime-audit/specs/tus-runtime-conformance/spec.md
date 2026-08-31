# TUS Runtime Conformance Specification

## Purpose

Produce truthful, bounded evidence for API, web, mobile, and POS journeys. The sibling `Goldenrepo-js_py`, providers, cloud/compliance, production activation, hardware, and physical certification are out of scope.

## Requirements

### Requirement: Bounded API, browser, mobile, and POS evidence

Authenticated API/web/mobile/POS flows MUST use finite HTTP plus Playwright or Chrome DevTools checks. Each action MUST be bounded to 30 seconds and each phase to 15 minutes; helper startup and shutdown MUST also be bounded. Screenshots MUST be finite, secret-free, and tied to the observed route/state.

#### Scenario: Available journey
- GIVEN approved credentials, owned services, and an authorized safe development target
- WHEN API health, authenticated web, mobile, and POS flows are exercised
- THEN observed status, screenshots, and cleanup are recorded as `browser/mobile`, without hardware, provider, or production claims

### Requirement: Truthful external blocking and attestation

Unavailable credentials, native devices, browser rendering, PostgreSQL proof, cloud ownership, or physical POS MUST be `external-blocked` or deferred. Evidence MUST contain redacted metadata only and MUST NOT contain URLs, credentials, tokens, cookies, PII, or raw secrets. A CLI confirmation MUST be described as user authorization, never as automated target or production proof; unrun flows MUST NOT be represented as observed.

#### Scenario: Missing external dependency
- GIVEN a required credential, device, target proof, or cloud setting is unavailable
- WHEN the corresponding flow cannot run
- THEN the report records the redacted blocker, zero unperformed side effects, and no success claim

### Requirement: Bounded owned-process cleanup

API, web, mobile, and POS helper processes MUST be stopped in a cleanup boundary on success, failure, timeout, or interruption. Cleanup MUST verify exact ownership, MUST NOT kill unknown processes, and MUST leave no secret-bearing diagnostic.

#### Scenario: Timeout or interruption
- GIVEN an owned helper exceeds its deadline or the audit is interrupted
- WHEN cleanup runs
- THEN the exact owned process is terminated, its port/process absence is verified, and no orphan remains
