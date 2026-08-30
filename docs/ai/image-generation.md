# Image Generation and Editing

The neutral image capability is owned by **AI Platform / Runtime** and proves a
cross-project use case: a tenant-authorized product team can generate a new
illustration or edit a tenant-owned image while preserving source lineage.

## Contract and local implementation

- `packages/ai-contracts/schemas/image/request.v1.schema.json` and
  `response.v1.schema.json` are strict versioned wire contracts.
- `DeterministicImageGeneration` is the provider-free local implementation. Its
  digest-derived bytes are repeatable and do not contain prompt or source data.
- `InMemoryImageAssetLifecycle` stages output under a tenant/workspace key,
  supports explicit promotion, denies cross-tenant access, and removes expired
  staged assets without deleting promoted assets.
- Edit requests require a B2 source URI, source asset id, and matching SHA-256
  checksum. Prompt, MIME, size, control-character, and tenant bounds fail closed.

## Safety, data, cost, and retention policy

The deterministic guardrail denies unsafe prompts before staging. Telemetry and
sanitized provider errors contain metadata only; they do not echo prompts,
source bytes, or provider exception text. Every response carries tenant/actor/
correlation/root-message lineage, encrypted retention metadata, output checksum,
and staged asset state. Hard tenant reservations account for request, output,
and estimated cost units before commit.

## AWS availability disposition

`BedrockImageGeneration` is fully typed and locally fake-tested but remains
**gated** until an approved AWS image model/region, credits, credentials, quota,
and owner-approved live conformance exist. It performs no live I/O: provider
behavior is available only through an injected transport in tests. The tested
alternative is `deterministic-local-image`; no production or cloud conformance
claim is made.

## Rollback

Disable the image adapter and revert the image schema/worker release while
retaining tenant lineage records. Clean staged assets through the lifecycle
cleanup boundary; do not delete promoted durable assets or re-enable an
unapproved provider.
