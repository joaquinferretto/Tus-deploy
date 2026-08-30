# AI Capability Evaluation and Regression Ledger

This ledger is the P4.6 local evidence boundary for the complete AI catalog. Each
row is independently evaluated by a deterministic fixture and records its
contract, implementation, owner, fake, evaluation, policy, availability, and
rollback reference. The catalog does not call providers, cloud services,
databases, credentials, secrets, or `.env` files.

| Capability | Contract | Implementation | Owner | Deterministic fake / fixture | Evaluation evidence | Policy / availability | Rollback |
|---|---|---|---|---|---|---|---|
| `llm-chat` | LLM/chat request and response ports | `DeterministicLLM`, `DeterministicChat` | AI Platform / Runtime | `fixture-llm-chat` | repeatable response, lineage, usage, cost | tenant isolation, quota, guardrails; live provider gated | P4.6 evaluation row |
| `structured-output` | bounded JSON Schema output port | `StructuredOutputExecutor` | AI Platform / Runtime | `fixture-structured-output` | schema validation and retry bound | tenant isolation, quota, guardrails; live provider gated | P4.6 evaluation row |
| `tools` | typed permissioned tool port | `PermissionedToolExecutor` | AI Platform / Runtime | `fixture-tools` | denial, invalid input, and audit | deny by default; local fake active | P4.6 evaluation row |
| `agents` | LangGraph agent/subgraph/supervisor contract | `AgentRuntime` | AI Platform / Runtime | `fixture-agents` | authority and resume behavior | LangGraph authority; local fake active | P4.6 evaluation row |
| `memory` | tenant/actor/session memory catalog | `InMemoryMemoryCatalog` | AI Platform / Runtime | `fixture-memory` | versioning, isolation, mutation safety | tenant/actor isolation; local fake active | P4.6 evaluation row |
| `registry` | versioned prompt/model/rollout registry | `InMemoryAIRegistry` | AI Platform / Runtime | `fixture-registry` | fail-closed rollout and audit | approval, availability, rollback; live gated | P4.6 evaluation row |
| `routing` | provider route/retry/circuit contract | `ProviderRouter` | AI Platform / Runtime | `fixture-routing` | bounded attempts and explicit fallback | allow-list, circuit, quota; live provider gated | P4.6 evaluation row |
| `cost` | usage, pricing, and hard-quota contract | `UsageMetadata`, `HardTenantQuota` | AI Platform / Runtime | `fixture-cost` | aggregation and exhaustion | hard tenant quota and cost ownership | P4.6 evaluation row |
| `guardrails` | safety, privacy, and HITL outcome contract | deterministic guardrail/privacy stores | AI Platform / Runtime | `fixture-guardrails` | deny, escalate, redact, consent, deletion | redaction, consent, retention; local fake active | P4.6 evaluation row |
| `streaming` | versioned frame and cursor contract | deterministic stream runtime | AI Platform / Runtime | `fixture-streaming` | ordering, reconnect, backpressure, cancellation | tenant lineage and bounded retention; local fake active | P4.6 evaluation row |
| `rag` | tenant-filtered retrieval and citation contract | RAG retrieval/evaluation runtime | AI Platform / Runtime | `fixture-rag` | recall, isolation, citations, latency, cost | tenant filters, lineage, retention; live retrieval gated | P4.6 evaluation row |
| `image-generation-editing` | typed image generation/editing and staged-asset contract | `DeterministicImageGeneration`, injected `BedrockImageGeneration` | AI Platform / Runtime | `fixture-image-generation-editing` | input safety, repeatability, lineage, retention, quota, cost, staged cleanup | tenant isolation, redaction, hard quota; Bedrock gated with deterministic-local-image alternative | P4.13 evaluation row |
| `video-generation-editing` | typed asynchronous video generation/editing job contract | `DeterministicVideoGeneration`, injected `BedrockVideoGeneration` | AI Platform / Runtime | `fixture-video-generation-editing` | progress, cancellation, media lineage, retention cleanup, safety, quota, cost | tenant isolation, redaction, hard quota; Bedrock gated with deterministic-local-video alternative | P4.14 evaluation row |

The deterministic regression report is evidence of local contract behavior only.
No production-readiness claim is made: it is not provider conformance or cloud
readiness.
Unavailable or gated live services remain explicitly documented rather than
silently substituted or omitted.
