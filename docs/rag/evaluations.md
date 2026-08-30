# Deterministic RAG evaluations

The P3.10 evaluator runs versioned, provider-free fixtures with stable inputs and
outputs. The fixture corpus covers:

- recall at K for expected chunks;
- tenant isolation, including cross-tenant leakage attempts;
- citation correctness and grounded source mapping;
- answer quality;
- latency in milliseconds; and
- cost units.

Evaluation reports expose each metric, thresholds, fixture count, and named
failures. A reindex may be promoted only when the configured quality and safety
thresholds pass. A failing version is rolled back to the retained last-passing
index; source assets remain intact.

The test command is:

```text
python -m pytest tests/compatibility/test_p3_rag_lifecycle.py -q
```

These are deterministic local tests with no live provider, database, B2, PGVector,
embedding, cloud, credential, secret, or `.env` dependency. Unavailable adapters
are explicit and never produce a live-conformance claim.
