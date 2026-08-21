# Durable LangGraph Runtime Specification

## Purpose

Make Python/LangGraph the sole AI/workflow authority while providing resumable, cross-runtime, observable execution.

## Requirements

### Requirement: LangGraph authority and cross-runtime durability

LangGraph MUST own orchestration, graph state, threads, sessions, tools, agents/subgraphs/supervisors, HITL, routing policy, and RAG workflow authority; TypeScript, JSON Schema, and Python contracts MUST remain compatible; queue transport MUST NOT be the sole state store. Rationale: two workflow authorities create irreconcilable state.

#### Scenario: Resumable graph
- GIVEN a valid tenant-scoped graph request
- WHEN the graph pauses at a checkpoint or approval
- THEN its durable run/thread identity and versioned state permit safe resume from the same authority

#### Scenario: Crash and retry
- GIVEN a worker crashes after an external step but before acknowledgement
- WHEN the message is redelivered
- THEN the run ledger and idempotency key prevent duplicate effects and expose the recovery state

#### Scenario: Unauthorized tool/HITL action
- GIVEN a graph asks to invoke a privileged tool for another tenant
- WHEN policy evaluates the request
- THEN deny-by-default authorization blocks it, records the decision, and cannot be bypassed by a subgraph

### Requirement: Equivalent local and production job delivery

Redis MUST provide local durable-job emulation; SQS with DLQ MUST provide production delivery; both MUST implement claim, acknowledgement, bounded retry, backoff, poison-message quarantine, cancellation, and reconciliation against the PostgreSQL run ledger. Rationale: local and production semantics must be comparable without requiring cloud credentials.

#### Scenario: Local successful job
- GIVEN a Compose worker and a valid queued run
- WHEN it claims and completes the job
- THEN the ledger, acknowledgement, telemetry, and result state agree

#### Scenario: Production poison message
- GIVEN repeated deterministic failure in SQS delivery
- WHEN the retry limit is reached
- THEN the message moves to DLQ, the run is marked recoverable, operators receive evidence, and replay is explicit and idempotent

### Requirement: Streaming and operational rollback

The runtime MUST support correlated token/audio/event/progress streams with backpressure, cancellation, reconnect, and partial-result policy; MUST expose worker lifecycle and redacted telemetry; and MUST support disabling a failing adapter while preserving ledger recovery. Rationale: long-running AI work must remain observable and reversible.

#### Scenario: Reconnecting stream
- GIVEN a client disconnect during a valid run
- WHEN it reconnects with the run cursor
- THEN only authorized, ordered events resume and cancellation remains effective

#### Scenario: Rollback evidence
- GIVEN a runtime version causes failed runs
- WHEN operators disable that version and replay eligible ledger/DLQ entries
- THEN no neutral contract is removed, outcomes distinguish replay from new work, and the rollback/runbook evidence is retained
