# Neutral Recommendation Capability

P4.12 provides a provider-neutral recommendation contract owned by **AI Platform / Runtime**.
The contract ranks tenant-authorized candidate resources for discovery; it contains no
marketplace, commerce, medical, or other business-domain fields. The same use case can
serve cross-project discovery of help articles, workflow templates, files, or other
tenant-owned resources by supplying neutral candidate identifiers, titles, and tags.

## Contract and implementation

- `packages/ai-contracts/schemas/recommendations/request.v1.schema.json` and
  `response.v1.schema.json` are strict versioned contracts.
- `DeterministicRecommendations` is the real local implementation and deterministic fake.
  It performs stable token-overlap ranking, deterministic tie-breaking, bounded output,
  and no network, provider, database, credential, secret, or `.env` access.
- `BedrockRecommendations` is a complete injected-transport port. It never creates an AWS
  client and cannot perform provider I/O without an explicitly active injected transport.

Every response carries tenant/actor/correlation lineage, an auditable safety outcome,
encrypted retention metadata, usage/cost metadata, availability disposition, and a
deterministic latency record. Telemetry contains counts and scores only; query, titles,
tags, and provider error details are not recorded.

## Safety, relevance, latency, and cost

The deterministic guardrail evaluates the query and candidate text before ranking. Denied
or escalated content returns no candidates and preserves a redacted, tenant-scoped audit
outcome. Candidate tenant identifiers, when present, must match the runtime tenant.

Ranking is relevance-testable: token overlap produces a score in `[0, 1]`, then candidate
ID provides a stable tie-break. `limit`, query length, candidate count, and latency budget
are contract bounds. Usage records input characters, candidate count, returned count, and
USD cost. The fake costs `0.0 USD`; injected Bedrock transport usage is estimated and
reserved/committed through `HardTenantQuota` per tenant.

## AWS availability and alternative disposition

No approved AWS recommendation model or region is validated in this repository. Therefore
the Bedrock port remains **gated** until credits, credentials, region, quota, configuration,
and owner-approved live conformance evidence exist. This is not a live AWS capability claim.

The tested alternative is `deterministic-local-ranking` (`AvailabilityStatus.ALTERNATIVE`).
It is sufficient for local development and contract/evaluation evidence; activating a
future provider requires an injected conformance transport and the normal profile gate.

## Rollback

Revert `packages/ai-contracts/schemas/recommendations/**`,
`apps/workflow-runtime-python/src/worker/ai/recommendations/**`, the recommendation exports,
`tests/compatibility/test_p4_12_recommendations.py`, affected schema-count assertions, and
this document. Preserve P4.1–P4.11 and leave P4.13+ untouched.
