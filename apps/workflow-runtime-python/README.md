# workflow-runtime-python

Python runtime slice for workflow execution (including LangGraph-based workers) in the baseline monorepo template.

## Runtime standard

- **Official standard**: LangGraph worker runtime is **Python**.
- **Deferred**: a TS/JS LangGraph runtime slice is intentionally deferred to a future SDD phase.

This keeps runtime responsibilities explicit:

- `apps/api` (TS/JS): API edge + CQRS command/query orchestration.
- `apps/workflow-runtime-python` (Python): workflow execution worker.

## JSON Schema bridge (cross-runtime contract)

The TS/JS API and Python worker communicate through shared JSON Schema contracts in `packages/contracts/schemas`.

Contract flow:

1. API edge validates payloads/events against JSON Schema.
2. Serialized contract messages are handed to workflow runtime boundaries.
3. Python worker validates the same schema contract before execution.

This provides:

- language-neutral interoperability (TS/JS ↔ Python),
- consistent versioned contracts across services,
- safe runtime evolution without coupling business workflow logic to one language stack.

## Why Python is the standard

Python is the default worker runtime because the current design explicitly mandates LangGraph on Python for the workflow executor. That choice keeps the baseline aligned with the design artifact and avoids pretending the TS/JS runtime parity already exists.

## Deferred TS/JS runtime

The TypeScript/JavaScript LangGraph worker is intentionally deferred. The baseline keeps the cross-runtime seam ready through JSON Schema contracts, but it does not ship a fake TS/JS worker implementation in this phase.

## Minimal local run

```bash
# from monorepo root
make worker-install
make worker-run
```

Or via npm scripts:

```bash
pnpm run worker:install
pnpm run worker:run
```
