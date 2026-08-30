# Asynchronous Video Generation and Editing

Video generation/editing is a neutral asynchronous capability owned by **AI Platform / Runtime**. Its cross-project use case is tenant-authorized creation
and editing of reusable media, not a product-specific workflow.

## Contract and local implementation

- `request.v1` validates operation, prompt, duration, media type, and optional
  B2 source checksum lineage.
- `response.v1` describes a durable job, ordered progress, cancellation state,
  staged output assets, safety outcome, retention, usage, and availability.
- `DeterministicVideoGeneration` is the provider-free implementation and fake.
  Its output is digest-derived, repeatable, and never contains prompt or source
  bytes.
- Jobs are tenant-scoped, idempotent, asynchronously runnable, cancellable,
  and cleaned when staged retention expires. Quota reservations are released on
  cancellation or failure and committed only after output completion.

## Safety, lineage, and cost

Prompts and source media are bounded and reject unsafe controls. Editing requires
`b2://` source URI, source asset ID, and a matching lowercase SHA-256 checksum.
Telemetry contains only redacted identifiers, status, progress, byte counts,
duration, cost, and audit IDs. Retention metadata is encrypted-by-contract and
contains only a key reference and algorithm name. Hard tenant request/token/cost
quotas are enforced with deterministic local evidence.

## AWS disposition

The injected `BedrockVideoGeneration` port is complete and activation-gated.
AWS model/region, credits, credentials, quotas, and owner-approved live
conformance are unavailable in the local evidence boundary, so Bedrock is not
claimed active. The tested alternative/disposition is
`deterministic-local-video`; no AWS, cloud, database, provider, secret, or
`.env` access is required for local operation.
