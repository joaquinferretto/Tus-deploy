# TUS Support and Reporting Operations

## Scope

This runbook covers the provider-free PR8 support, governed WhatsApp, reporting,
discovery, SEO, and telemetry boundaries. It does not activate WhatsApp,
payments, settlement, payout, release jobs, fleet work, or any excluded product
capability.

## Governed WhatsApp flow

1. Resolve the authenticated session and tenant on the server.
2. Require an authorized sender, explicit consent, a typed allowlisted action,
   and a tenant-scoped idempotency key/fingerprint.
3. Quote current published facts and issue a short-lived confirmation.
4. Re-check price and availability before consuming confirmation.
5. Redirect commitment payment to authenticated TUS checkout; never request or
   record passwords, payment credentials, tokens, or provider secrets in chat.
6. Hand off unsupported, ambiguous, cross-tenant, stale, expired, or denied
   actions to a human-safe path with no commercial side effect.

Duplicate confirmation returns the idempotent result. A consumed or expired
confirmation cannot create another commitment.

## Support and disputes

Support cases are tenant-scoped and retain the linked commitment and dispute
identifier. Customer and merchant evidence are both required before a support
agent can resolve a case. Resolution records the actor, correlation, timeline,
outcome, and (when applicable) an append-only compensating entry marked
`settlement: not-released`. AI assistance is not an authorization or mediation
decision.

## Reporting and discovery

Operations reports are scoped by the authenticated tenant and include period,
source version, dimensions, and freshness metadata. Foreign tenant queries are
denied. SEO projections are indexable only when publication, cohort policy,
discoverability, revocation, and freshness checks all pass; revoked or stale
listings are excluded from canonical output and sitemaps.

## Evidence and rollback

Local focused tests and authenticated HTTP smoke are `local-deterministic`.
PostgreSQL restart/replay, WhatsApp provider callbacks, browser/device proof,
legal approval, and production conformance remain `deferred` until authorized
evidence exists.

The PR8 migration is additive. To roll back, disable governed actions and
publication/report projections, drain or quarantine consumers, and preserve
transcripts, support evidence, audit events, readiness evidence, and financial
ledger history. Do not rewrite or destructively down-migrate financial records;
use compensating entries for financial corrections.
