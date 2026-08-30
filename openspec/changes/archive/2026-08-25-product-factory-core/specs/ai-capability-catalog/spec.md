# AI Capability Catalog Specification

## Purpose

Define a complete, neutral AI capability catalog whose entries are real contracts and gated adapters rather than empty interfaces or hidden paid dependencies.

## Requirements

### Requirement: Complete LangGraph AI catalog

The system MUST provide separately verifiable contracts, implementations, configuration, deterministic fakes/fixtures, ownership, quotas, safety policy, and evaluation evidence for LLM/chat, structured output, typed tools/permissions, agents/subgraphs/supervisors, memory, sessions/checkpoints, prompt/model registry, routing/retry/circuit breaking, usage/cost/quota, guardrails/privacy, evaluation/regression, and streaming. Rationale: a named capability without evidence is not a platform capability.

#### Scenario: Safe structured workflow
- GIVEN a tenant-authorized prompt and schema
- WHEN LangGraph invokes a configured model and validates output
- THEN the result, usage, policy decision, latency, and cost metadata are recorded without domain-specific prompt leakage

#### Scenario: Provider failure and retry
- GIVEN a timeout or circuit-open provider response
- WHEN routing policy handles it
- THEN bounded configured retry or fallback occurs with explicit metadata; silent provider switching is forbidden

#### Scenario: Safety boundary
- GIVEN a privileged tool request or unsafe content fixture
- WHEN policy/guardrail evaluation runs
- THEN the request is denied or sent to HITL, tenant isolation is preserved, and the event is redacted and auditable

### Requirement: Complete multimodal and media catalog

The system MUST provide separately verifiable contracts and local fakes for STT, TTS, translation, vision/multimodal input, OCR/document intelligence, moderation/labels, recommendations, image generation/editing, and asynchronous video generation/editing, including limits, lineage, progress/cancellation where applicable, retention, security, cost, and availability disposition. Rationale: recommendations and media cannot be silently omitted because provider support changes.

#### Scenario: Media capability success
- GIVEN an authorized input within tenant size and cost quota
- WHEN the configured capability runs
- THEN it returns typed output, usage/lineage metadata, safety status, and an auditable result or job status

#### Scenario: Unsupported live capability
- GIVEN current AWS evidence shows no approved model or region for a capability
- WHEN activation is evaluated
- THEN the adapter remains disabled but complete and locally fake-tested, with tested alternative/disposition recorded; no empty AWS interface is accepted

#### Scenario: Video cancellation
- GIVEN an asynchronous video edit in progress
- WHEN the owner cancels it or retention expires
- THEN processing stops or is compensatingly finalized, staged assets are cleaned, and quota/lineage state is reconciled

### Requirement: Provider transition and governed AI data

Groq MUST remain the active configured provider until AWS credits and live authorization exist; Bedrock MUST be implemented, wired, configured, documented, and locally fake-tested before activation; Bedrock Agents and Flows MUST NOT orchestrate. AI retention MUST require consent, encryption, tenant isolation, redaction, lineage, opt-out, deletion, configurable retention, and audit. Rationale: current credit constraints must not reduce interface completeness or privacy.

#### Scenario: No-credit operation
- GIVEN no AWS credits or live credentials
- WHEN an AI request runs locally
- THEN configured Groq or deterministic fake serves it, Bedrock contracts remain testable, and no hidden cloud call occurs

#### Scenario: Consent withdrawal
- GIVEN retained prompt, audio, image, document, memory, search, or trace data
- WHEN the tenant withdraws improvement consent
- THEN future retention stops and owned copies/projections are deleted or redacted with completion evidence
