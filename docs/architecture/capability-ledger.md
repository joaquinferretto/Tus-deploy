# Capability Ledger

This ledger is the governance source for bounded delivery. Every row has one
owner, one contract boundary, one implementation path, a deterministic local
fixture, a neutral use case, and an evidence gate. Later phases remain disabled
until their rows are independently verified.

| Capability row | Owner | Phase | Contract | Implementation | Fake / Fixture | Use case | Security | Data | Cost | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Users, accounts, credentials | Identity | P1/P2 | identity schemas | auth successor | local account fixture | generic account lifecycle | hashing, non-enumeration | PostgreSQL owner | quota owner | tenant CRUD and audit tests |
| Sessions, refresh, devices | Identity | P1/P2 | session schemas | token-family service | replay fixture | resumable session | rotation and revocation | PostgreSQL owner | bounded sessions | concurrent replay tests |
| Verification, recovery, email | Identity/Integrations | P1/P2 | verification/email ports | token lifecycle + fake email | expiry/replay fixture | account recovery | redacted tokens | PostgreSQL/outbox | delivery quota | expiry and delivery tests |
| Organizations, workspaces, memberships | Tenancy | P1/P2 | tenancy schemas | tenant policy service | two-tenant fixture | workspace membership | deny by default | PostgreSQL owner | membership quotas | cross-tenant denial |
| Roles, permissions, superadmin | Tenancy | P1/P2 | authorization ports | policy evaluator | escalation fixture | product administration | separate boundary | PostgreSQL audit | admin rate limits | audited policy tests |
| Audit and security events | Platform | P1/P2 | audit event schema | immutable event port | redaction fixture | traceable admin action | no raw secrets | PostgreSQL owner | retention budget | redaction/correlation tests |
| Privacy, retention, deletion | Platform | P1/P2 | privacy schemas | tracked deletion worker | consent fixture | tenant export/deletion | authorization and consent | source + projections | retention policy | propagation evidence |
| Generic CRUD and search | Data | P2 | CRUD/search schemas | repository ports | in-memory repository | neutral resource | tenant predicates | PostgreSQL owner | query quotas | pagination/filter tests |
| Assets and lineage | Data | P2/P3 | asset schemas | B2/storage ports | local object fake | document asset lineage | access policy | B2 source, PG index | storage quota | lineage/delete tests |
| Notifications and email | Integrations | P2/P5 | notification/email ports | queue-aware adapter | deterministic delivery | status notification | consent/redaction | outbox owner | channel quota | retry/outage tests |
| Flags and configuration | Platform | P0/P2 | config contract | explicit profile resolver | local profile | feature rollout | fail-fast | configuration only | budget gate | rollback test |
| Quotas and rate limits | Platform | P2/P4 | quota schema | reservation/accounting port | exhaustion fixture | bounded capability use | tenant isolation | usage ledger | hard quota | deterministic exhaustion |
| Idempotency and outbox | Data | P2 | ledger schemas | atomic repository port | duplicate fixture | retry-safe action | replay protection | PostgreSQL owner | queue budget | duplicate/claim tests |
| Jobs, events, run ledger | Runtime | P2/P3 | workflow schemas | ledger + transport ports | crash/replay fixture | resumable work | authorization | PostgreSQL owner | retry/DLQ budget | crash/replay/DLQ tests |
| Contract validation | Platform | P0 | JSON Schema v1 | TS/Python validators | valid/invalid fixtures | cross-runtime message | reject before action | no persistence | test-only | compatibility suite |
| Configuration and lifecycle | Platform | P0 | runtime config/lifecycle | fail-fast loader and shutdown manager | local startup fixture | safe service startup | secret-store references | no secret values | timeout budget | config/lifecycle tests |
| Observability | Platform | P0 | telemetry ports | context middleware and ports | in-memory telemetry | correlated request | redacted context | metadata only | sampling policy | redaction/metric tests |
| Compose local profile | DX | P0 | profile matrix | complete Compose services | fake providers | fresh-team bootstrap | no credentials | local databases | local resource budget | provider-free boot |
| Terraform profiles | IaC | P0/P6 | profile contract | module boundaries | deterministic plan | Render/AWS shape | explicit gates | owner matrix | budget/quota flags | terraform validate/plan |

P1+ rows are intentionally ledgered here but are not claimed complete by the
P0 slice.
