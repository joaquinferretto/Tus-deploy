const ACTIVATION_STATE = {
  ACTIVE: 'active',
  GATED: 'gated',
  DEFERRED: 'deferred',
} as const

export type ActivationState = (typeof ACTIVATION_STATE)[keyof typeof ACTIVATION_STATE]

export interface ActivationDecision {
  state: ActivationState
  reason: string
}

export interface TraceabilityLedgerRow {
  id: string
  capability: string
  owner: string
  scope: string
  contract: string
  implementation: string
  fixture: string
  useCase: string
  policy: string
  activation: ActivationDecision
  evidence: readonly string[]
  rollbackRef: string
}

export interface TraceabilityValidationIssue {
  rowId: string
  field: string
  message: string
}

export class TraceabilityLedgerValidationError extends Error {
  readonly issues: readonly TraceabilityValidationIssue[]

  constructor(issues: readonly TraceabilityValidationIssue[]) {
    super(
      `Traceability ledger validation failed: ${issues
        .map((issue) => `${issue.rowId} ${issue.field}: ${issue.message}`)
        .join('; ')}`,
    )
    this.name = 'TraceabilityLedgerValidationError'
    this.issues = issues
  }
}

export const TRACEABILITY_LEDGER = [
  {
    id: 'users',
    capability: 'Users, accounts, credentials',
    owner: 'Identity',
    scope: 'tenant-scoped identity lifecycle across native and cloud-native profiles',
    contract: 'identity schemas and identity lifecycle ports',
    implementation: 'auth successor lifecycle and tenant-safe persistence boundary',
    fixture: 'deterministic local account and credential fixture',
    useCase: 'generic account registration, verification, and credential lifecycle',
    policy: 'hashing, non-enumeration, tenant isolation, and audit ownership',
    activation: { state: 'active', reason: 'deterministic local contract and fake are enabled' },
    evidence: ['tenant-safe CRUD', 'credential lifecycle', 'audit regression tests'],
    rollbackRef: 'revert auth successor modules and identity migration version',
  },
  {
    id: 'sessions',
    capability: 'Sessions, refresh, devices',
    owner: 'Identity',
    scope: 'tenant and device-scoped session families in the API profile',
    contract: 'session schemas and refresh-rotation ports',
    implementation: 'token-family service with atomic rotation and revocation',
    fixture: 'deterministic replay, restart, and concurrent-refresh fixture',
    useCase: 'resumable authenticated session with device management',
    policy: 'hash and family checks, replay denial, revocation, and redaction',
    activation: { state: 'active', reason: 'provider-free rotation path is enabled' },
    evidence: ['concurrent refresh replay tests', 'restart recovery', 'outbox security event'],
    rollbackRef: 'revert refresh-family migration and application adapter slice',
  },
  {
    id: 'verification',
    capability: 'Verification and recovery',
    owner: 'Identity / Integrations',
    scope: 'tenant-safe account recovery with provider-free local delivery',
    contract: 'verification lifecycle and email adapter ports',
    implementation: 'expiring token lifecycle with deterministic email adapter',
    fixture: 'expiry, replay, redaction, and delivery-failure fixture',
    useCase: 'generic account verification and recovery',
    policy: 'non-enumeration, token redaction, expiry, replay protection, and quota',
    activation: { state: 'gated', reason: 'local fake is active; live email requires owner-approved activation' },
    evidence: ['expiry and replay tests', 'delivery failure handling', 'audit evidence'],
    rollbackRef: 'revert verification token and email adapter version',
  },
  {
    id: 'tenants',
    capability: 'Organizations, workspaces, memberships, tenants',
    owner: 'Tenancy',
    scope: 'tenant and workspace authorization boundaries',
    contract: 'tenancy context, organization, and membership schemas',
    implementation: 'tenant policy service with mandatory context predicates',
    fixture: 'deterministic two-tenant membership and isolation fixture',
    useCase: 'workspace membership and default-organization bootstrap',
    policy: 'deny by default, membership lifecycle, and cross-tenant denial',
    activation: { state: 'active', reason: 'provider-free tenancy contract is enabled' },
    evidence: ['cross-tenant read and write denial', 'membership lifecycle', 'context propagation'],
    rollbackRef: 'revert tenancy policy modules and migration version',
  },
  {
    id: 'roles',
    capability: 'Roles, permissions, tenant authorization, superadmin',
    owner: 'Tenancy / Platform Admin',
    scope: 'tenant resource policies and separate product-superadmin boundary',
    contract: 'authorization ports and product-admin contracts',
    implementation: 'deny-by-default policy evaluator and audited admin service',
    fixture: 'deterministic escalation, break-glass, and policy-rollback fixture',
    useCase: 'product administration without tenant privilege escalation',
    policy: 'least privilege, dual control, approval expiry, and emergency revoke',
    activation: { state: 'active', reason: 'deterministic policy and audit sinks are enabled' },
    evidence: ['deny-by-default tests', 'audited support session', 'policy rollback integrity'],
    rollbackRef: 'revert policy version and product-superadmin module slice',
  },
  {
    id: 'audit',
    capability: 'Audit and security events',
    owner: 'Platform',
    scope: 'tenant-correlated administrative and security event records',
    contract: 'audit event schema and immutable event port',
    implementation: 'redacting audit sink with correlation and retention metadata',
    fixture: 'deterministic redaction, correlation, and retention fixture',
    useCase: 'traceable administrative action and security investigation',
    policy: 'no raw secrets, immutable append semantics, retention, and access control',
    activation: { state: 'active', reason: 'local immutable event contract is enabled' },
    evidence: ['redaction and correlation tests', 'retention query proof', 'tenant isolation'],
    rollbackRef: 'revert audit module and migration while preserving prior event records',
  },
  {
    id: 'crud',
    capability: 'Generic CRUD and search',
    owner: 'Data',
    scope: 'tenant-scoped neutral resources and query boundaries',
    contract: 'CRUD record and query schemas',
    implementation: 'repository ports with deterministic in-memory and Prisma-shaped predicates',
    fixture: 'deterministic pagination, filtering, sorting, and search fixture',
    useCase: 'neutral resource management without vertical domain coupling',
    policy: 'authorization before repository access, tenant predicates, and injection boundaries',
    activation: { state: 'active', reason: 'provider-free repository contract is enabled' },
    evidence: ['pagination and filter tests', 'tenant-safe search', 'vendor-free boundary check'],
    rollbackRef: 'revert CRUD modules and contract version',
  },
  {
    id: 'assets',
    capability: 'Assets, uploads, lineage',
    owner: 'Data / Assets',
    scope: 'tenant asset metadata with B2 source and transient staging profiles',
    contract: 'asset record, lineage, and deletion schemas',
    implementation: 'asset access policy plus B2 and encrypted staging ports',
    fixture: 'deterministic local object, lineage invalidation, and cleanup fixture',
    useCase: 'neutral document asset upload, lineage, and deletion',
    policy: 'tenant access, encryption, retention, lifecycle deletion, and source ownership',
    activation: { state: 'gated', reason: 'local storage fake is active; B2/S3 live use is gated' },
    evidence: ['lineage and delete tests', 'retention cleanup', 'vendor-free storage boundary'],
    rollbackRef: 'revert asset/storage adapter and metadata contract version',
  },
  {
    id: 'notifications',
    capability: 'Notifications and email',
    owner: 'Integrations',
    scope: 'tenant and user preference-scoped delivery channels',
    contract: 'notification, preference, and email-status schemas',
    implementation: 'queue-aware notification service with deterministic delivery fake',
    fixture: 'opt-in suppression, retry, quota, idempotency, and outage-recovery fixture',
    useCase: 'status notification delivered through a consented channel',
    policy: 'consent, redaction, tenant quota, bounded retry, and replay protection',
    activation: { state: 'gated', reason: 'deterministic delivery is active; SES requires explicit activation' },
    evidence: ['delivery retry and outage tests', 'preference suppression', 'idempotent replay'],
    rollbackRef: 'revert notification/email adapter and contract version',
  },
  {
    id: 'flags',
    capability: 'Feature flags and configuration',
    owner: 'Platform',
    scope: 'profile, product, and tenant configuration precedence',
    contract: 'typed runtime configuration and feature-flag contracts',
    implementation: 'explicit profile resolver with versioned activation and rollback',
    fixture: 'deterministic profile, tenant, product, and invalid-config fixture',
    useCase: 'safe feature rollout with reversible configuration',
    policy: 'fail-fast validation, redacted diagnostics, and no implicit provider fallback',
    activation: { state: 'active', reason: 'provider-free configuration resolver is enabled' },
    evidence: ['precedence and fail-fast tests', 'invalid-value redaction', 'version rollback'],
    rollbackRef: 'revert flag/configuration version and package export',
  },
  {
    id: 'quotas',
    capability: 'Quotas and rate limits',
    owner: 'Platform',
    scope: 'profile, tenant, product, and capability usage accounting',
    contract: 'quota policy, reservation, usage, and rate-limit schemas',
    implementation: 'reservation and accounting ports with fixed-window limiter',
    fixture: 'deterministic exhaustion, expiry, release, and cost-unit fixture',
    useCase: 'bounded neutral capability consumption per tenant',
    policy: 'hard tenant limits, cost units, isolation, and deterministic exhaustion',
    activation: { state: 'active', reason: 'provider-free accounting and limiter are enabled' },
    evidence: ['reservation and exhaustion tests', 'tenant-isolated ledger', 'cost accounting'],
    rollbackRef: 'revert quota policy module and contract version',
  },
  {
    id: 'idempotency-outbox',
    capability: 'Idempotency and transactional outbox',
    owner: 'Data',
    scope: 'tenant and idempotency-key scoped atomic business effects',
    contract: 'idempotency and outbox repository ports plus SQL contracts',
    implementation: 'parameterized PostgreSQL claim/publication/recovery adapters',
    fixture: 'deterministic duplicate, takeover, fencing, commit, and rollback fixture',
    useCase: 'retry-safe action with exactly one durable follow-up publication',
    policy: 'tenant isolation, request-hash conflict, stale-claim fencing, and replay safety',
    activation: { state: 'active', reason: 'deterministic transactional composition is enabled' },
    evidence: ['duplicate and claim-race tests', 'commit/rollback proof', 'lease recovery'],
    rollbackRef: 'revert idempotency/outbox composition, migration, and SQL adapter slice',
  },
  {
    id: 'jobs-events',
    capability: 'Jobs, events, run ledger',
    owner: 'Runtime',
    scope: 'tenant-correlated durable work across local and cloud transport profiles',
    contract: 'durable-job and run-event schemas with ledger ports',
    implementation: 'durable run ledger plus Redis-local/SQS+DLQ transport ports',
    fixture: 'deterministic claim, crash-redelivery, retry, DLQ, replay, and reconciliation fixture',
    useCase: 'resumable neutral workflow with explicit recovery state',
    policy: 'authorization, bounded retry, poison quarantine, idempotency, and reconciliation',
    activation: { state: 'gated', reason: 'local transport fake is active; managed queues require activation' },
    evidence: ['crash and replay tests', 'bounded retry and DLQ', 'run-ledger reconciliation'],
    rollbackRef: 'revert jobs/events ledger release and transport adapter version',
  },
  {
    id: 'privacy',
    capability: 'Privacy, retention, deletion',
    owner: 'Platform / Privacy',
    scope: 'tenant-owned records, projections, assets, and consent decisions',
    contract: 'privacy record, consent, and request schemas',
    implementation: 'tracked export, rectification, deletion, retention, and anonymization workflows',
    fixture: 'deterministic consent withdrawal, legal hold, purge, and propagation fixture',
    useCase: 'tenant data export and deletion with auditable completion',
    policy: 'minimization, consent, redaction, retention, legal holds, and tenant isolation',
    activation: { state: 'deferred', reason: 'provider propagation remains deferred until all owned sinks are activated' },
    evidence: ['consent and deletion propagation tests', 'retention purge', 'audit completion record'],
    rollbackRef: 'revert privacy worker version while retaining tracked request state',
  },
] as const satisfies readonly TraceabilityLedgerRow[]

export function findTraceabilityIssues(rows: readonly unknown[]): TraceabilityValidationIssue[] {
  const issues: TraceabilityValidationIssue[] = []
  for (const row of rows) {
    const record = isRecord(row) ? row : {}
    const rowId = isNonEmptyString(record.id) ? record.id : '<unknown>'

    for (const field of ['owner', 'scope', 'contract', 'implementation', 'fixture', 'useCase', 'policy', 'rollbackRef']) {
      if (!isNonEmptyString(record[field])) {
        issues.push({ rowId, field, message: `${field} is required` })
      }
    }

    if (!Array.isArray(record.evidence) || !record.evidence.some(isNonEmptyString)) {
      issues.push({ rowId, field: 'evidence', message: 'evidence must contain at least one entry' })
    }

    if (!isRecord(record.activation)) {
      issues.push({ rowId, field: 'activation', message: 'activation state is required' })
    } else {
      if (!isActivationState(record.activation.state)) {
        issues.push({ rowId, field: 'activation.state', message: 'activation state is unsupported' })
      }
      if (!isNonEmptyString(record.activation.reason)) {
        issues.push({ rowId, field: 'activation.reason', message: 'activation reason is required' })
      }
    }
  }
  return issues
}

export function validateTraceabilityLedger(rows: readonly unknown[]): TraceabilityLedgerRow[] {
  const issues = findTraceabilityIssues(rows)
  if (issues.length > 0) throw new TraceabilityLedgerValidationError(issues)
  return [...rows] as TraceabilityLedgerRow[]
}

export function assertValidTraceabilityLedger(rows: readonly unknown[]): void {
  validateTraceabilityLedger(rows)
}

function isActivationState(value: unknown): value is ActivationState {
  return typeof value === 'string' && Object.values(ACTIVATION_STATE).includes(value as ActivationState)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
