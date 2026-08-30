# Design: Product Factory Core

## Technical Approach

Use an explicit profile resolver and cloud-native governance layer. Native local remains a PostgreSQL-backed developer profile using `DATABASE_URL`; source-free `backend/` and `frontend/` wrappers delegate the documented commands to `apps/api` and `apps/web`, resolving the repository-root `.env` by script path, consuming only `DATABASE_URL`, giving a non-empty process value precedence, and never copying or logging secrets. Active integration/deployment requires an explicit `render-native` or `aws-terraform` selection and never silently substitutes Compose. Clean/Hexagonal ports isolate application code from managed services, fakes, and SDKs.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Profile authority | Validate `native`, `render-native`, or `aws-terraform`; Render uses its native service model and AWS uses Terraform as the sole IaC source. | Prevents hidden Compose fallback and duplicate infrastructure authority. |
| Native boundary | PostgreSQL is required. MongoDB, Redis, Python worker, mobile, and external providers each report explicit optional, disabled, fake, or unavailable state. | Native smoke remains useful without becoming production or full-integration evidence. |
| Managed boundaries | Every external service has a non-secret config reference, owner, rollback path, deterministic fake/disabled state, and activation gate. | Ownership and availability cannot be inferred from a catalog entry. |
| Evidence truth | Separate native smoke, cloud plan/`terraform validate`, authorized cloud smoke, and unavailable/deferred credentials/resources. | Plan/validation proves shape only, never live conformance. |
| Compose | Retain existing Compose as optional, deferred, non-blocking work. | Docker is not a completion dependency. |

## Data Flow

```text
explicit profile → validator → boundary matrix → managed adapter or fake/disabled state
                                      └→ evidence record (class, scope, gates, rollback)
native wrapper → apps/api/apps/web → PostgreSQL via DATABASE_URL; no cloud calls
```

### Managed-Service Boundary Contract

| Boundary | Configuration / owner | Rollback | Fake/disabled state and activation gate |
|---|---|---|---|
| PostgreSQL | Local `DATABASE_URL`; Render/AWS secret-store reference; Data Platform. | Last passing app/schema version plus verified backup. | Native requires reachability; cloud requires endpoint, secret ref, backup, quota, and authorized smoke. |
| MongoDB | Profile endpoint/secret ref; Document/Data owner. | Restore or rebuild owned projections from PostgreSQL with reconciliation. | Deterministic document fake or disabled read model; live owner/network/retention/backup gate. |
| Redis | Profile endpoint/secret ref; Runtime/Jobs owner. | Disable consumers; preserve PostgreSQL ledger; replay eligible work. | Deterministic cache/queue fake or disabled optional capability; live retry, quota, and smoke gate. |
| Object storage | B2/Render or S3/AWS profile ref; Assets owner. | Revert adapter/config; reconcile versioned objects and metadata. | Deterministic object/filesystem fake or disabled uploads; policy, encryption, lifecycle, and smoke gate. |
| Queues | Render-managed queue ref or AWS SQS/DLQ Terraform outputs; Runtime owner. | Stop intake; preserve ledger/outbox/DLQ; replay idempotently. | Deterministic local transport fake; queue policy, retry, IAM/secret ref, quota, and smoke gate. |

Real values remain only in local `.env` or provider secret stores; artifacts and logs contain redacted references only. Render-to-AWS bootstrap remains minimum-scope STS `AssumeRole`. No provisioning or live provider call is part of this design.

## Interfaces / Contracts

```ts
type DeliveryProfile = 'native' | 'render-native' | 'aws-terraform'
type EvidenceKind = 'native-smoke' | 'cloud-plan-validation' | 'authorized-cloud-smoke' | 'unavailable-deferred'
interface ManagedBoundary { name: string; owner: string; configRef: string; rollbackRef: string; mode: 'managed' | 'fake' | 'disabled'; activationGate: string }
interface EvidenceRecord { profile: DeliveryProfile; kind: EvidenceKind; boundaries: string[]; liveConformance: boolean; status: 'pass' | 'unavailable' | 'deferred' | 'fail' }
interface NativeReadiness { postgres: 'required'; mongodb: string; redis: string; pythonWorker: string; mobile: string; externalProviders: string }
```

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/package.json`, `frontend/package.json`, `scripts/dev/native-profile.mjs` | Create | Source-free wrappers, explicit env precedence, redaction, and exit propagation. |
| `packages/config/**`, `apps/api/**`, `apps/web/**` | Modify | Profile validation, PostgreSQL-required startup, individual native states, and readiness. |
| `docs/architecture/profile-matrix.md`, `docs/deployment/{render,aws}.md` | Create/modify | Profile selection, five boundaries, owners, gates, runbooks, and rollback. |
| `docs/evidence/cloud-native/**`, `scripts/validation/cloud-native/**` | Create | Evidence schemas and non-provisioning validation. |
| `tests/foundation/cloud-native/**` | Create | RED coverage for selection, boundaries, fakes, gates, evidence truth, rollback, and secrets. |
| `openspec/changes/product-factory-core/tasks.md` | Modify | P0.6c before P0.7/P0.8; P1.1 depends on P0.3/P0.6a/P0.6c; P0.6b stays deferred. |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Four env precedence cases, no fallback, boundary completeness, native states, redaction, evidence classification. | Deterministic fixtures and synthetic secret references. |
| Integration | Render validation and Terraform `fmt`/`validate`/safe-plan shape; no provisioning or undeclared service. | Selected-profile fixtures. |
| E2E | Native wrapper/PostgreSQL smoke and separately authorized Render/AWS smoke. | Missing resources produce unavailable/deferred, never live conformance. |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A — docs/manifests are not executed. | Only allowlisted validation scripts execute. | None. |
| Git repository selection | N/A — no Git command. | No repository mutation or path selection. | None. |
| Commit state | N/A — no commit automation. | No index/worktree side effects. | None. |
| Push state | N/A — no push automation. | No remote/ref resolution. | None. |
| PR commands | N/A — no PR composition. | No PR side effects. | None. |

## Migration / Rollout

No data migration. Apply governance in P0.6c, then P0.7 and P0.8; P1.1 starts only after P0.3, P0.6a, and P0.6c. P0.6b remains independently deferred. Rollback stops/drains traffic before partial serving, preserves ledger/outbox/DLQ, disables the failing profile/adapter, and records version, reason, operator, and health evidence. Preserve secret scanning, provider gates, and Terraform-only AWS ownership.

## Open Questions

None. Regions, quotas, credentials, resources, retention, and paid/live smoke remain owner-approved activation gates.
