export const NEUTRAL_CONTRACT_VERSION = 'neutral-reference.v1'

export const NEUTRAL_PROFILE_MODE = {
  FAKE: 'fake',
  UNAVAILABLE: 'unavailable',
} as const

export type NeutralProfileMode = (typeof NEUTRAL_PROFILE_MODE)[keyof typeof NEUTRAL_PROFILE_MODE]

export interface CloudNativeDisposition {
  kind: 'unavailable-deferred'
  liveConformance: false
  reason: string
}

export interface NeutralProfile {
  name: 'aws-terraform'
  mode: NeutralProfileMode
  disposition: CloudNativeDisposition
}

export function createUnavailableCloudNativeDisposition(reason: string): CloudNativeDisposition {
  return { kind: 'unavailable-deferred', liveConformance: false, reason }
}

export interface NeutralContext {
  tenantId: string
  actorId: string
  correlationId: string
}

export interface IdempotentContext extends NeutralContext {
  idempotencyKey?: string
}

export interface SignupInput extends NeutralContext {
  email: string
}

export interface SignupResult {
  contractVersion: string
  userId: string
  verificationToken: string
  status: 'pending-verification'
}

export interface VerifyInput extends NeutralContext {
  userId: string
  token: string
}

export interface VerifyResult {
  contractVersion: string
  userId: string
  status: 'verified'
}

export interface MembershipInput extends NeutralContext {
  role: 'owner' | 'member'
}

export interface MembershipResult {
  contractVersion: string
  membershipId: string
  tenantId: string
  actorId: string
  role: MembershipInput['role']
}

export interface RecordInput extends NeutralContext {
  collection: string
  value: Record<string, JsonValue>
}

export interface RecordResult {
  contractVersion: string
  recordId: string
  tenantId: string
  collection: string
  value: Record<string, JsonValue>
}

export interface SearchInput extends NeutralContext {
  collection: string
  query: string
}

export interface SearchResult {
  contractVersion: string
  records: RecordResult[]
}

export interface AssetInput extends NeutralContext {
  name: string
  contentType: string
  content: string
}

export interface AssetResult {
  contractVersion: string
  assetId: string
  tenantId: string
  name: string
  contentType: string
  bytes: number
  status: 'available'
}

export interface AssetsResult {
  contractVersion: string
  assets: AssetResult[]
}

export interface NotificationInput extends IdempotentContext {
  message: string
}

export interface NotificationResult {
  contractVersion: string
  notificationId: string
  tenantId: string
  actorId: string
  message: string
  status: 'queued'
}

export interface NotificationsResult {
  contractVersion: string
  notifications: NotificationResult[]
}

export interface JobInput extends IdempotentContext {
  kind: string
}

export interface JobResult {
  contractVersion: string
  jobId: string
  tenantId: string
  kind: string
  status: 'completed'
  attempts: number
}

export interface AiInput extends IdempotentContext {
  prompt: string
}

export interface AiResult {
  contractVersion: string
  resultId: string
  output: string
  provider: 'deterministic-fake'
  usage: { inputUnits: number; outputUnits: number }
}

export interface KnowledgeInput extends NeutralContext {
  assetId: string
  text: string
}

export interface KnowledgeResult {
  contractVersion: string
  documentId: string
  assetId: string
  status: 'indexed'
  lineage: { tenantId: string; checksum: string }
}

export interface KnowledgeSearchInput extends NeutralContext {
  question: string
}

export interface KnowledgeSearchResult {
  contractVersion: string
  answer: string
  citations: Array<{ documentId: string; assetId: string }>
  status: 'grounded' | 'unavailable'
}

export interface AuditEvent {
  eventId: string
  tenantId: string
  actorId: string
  action: string
  outcome: 'success' | 'denied'
  correlationId: string
}

export interface AuditResult {
  contractVersion: string
  denied: boolean
  events: AuditEvent[]
}

export interface TelemetryInput extends NeutralContext {
  name: string
  value: number
}

export interface TelemetryPoint {
  pointId: string
  tenantId: string
  name: string
  value: number
  correlationId: string
}

export interface TelemetryResult {
  contractVersion: string
  points: TelemetryPoint[]
}

export interface SuperadminStateInput extends NeutralContext {}

export interface SuperadminStateResult {
  contractVersion: string
  product: 'neutral-reference'
  policyVersion: number
  tenantCount: number
}

export interface SuperadminIntentInput extends NeutralContext {
  intent: string
  target: string
}

export interface SuperadminIntentResult {
  contractVersion: string
  status: 'recorded'
  intent: string
  target: string
  policyVersion: number
}

export interface NeutralContractApi {
  signup(input: SignupInput): Promise<SignupResult>
  verify(input: VerifyInput): Promise<VerifyResult>
  createMembership(input: MembershipInput): Promise<MembershipResult>
  createRecord(input: RecordInput): Promise<RecordResult>
  updateRecord(input: RecordInput & { recordId: string }): Promise<RecordResult>
  deleteRecord(input: NeutralContext & { recordId: string }): Promise<{ deleted: true }>
  searchRecords(input: SearchInput): Promise<SearchResult>
  uploadAsset(input: AssetInput): Promise<AssetResult>
  listAssets(input: NeutralContext): Promise<AssetsResult>
  createNotification(input: NotificationInput): Promise<NotificationResult>
  listNotifications(input: NeutralContext): Promise<NotificationsResult>
  submitJob(input: JobInput): Promise<JobResult>
  getJob(input: NeutralContext & { jobId: string }): Promise<JobResult | null>
  runAi(input: AiInput): Promise<AiResult>
  ingestKnowledge(input: KnowledgeInput): Promise<KnowledgeResult>
  searchKnowledge(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult>
  listAudit(input: NeutralContext): Promise<AuditResult>
  recordTelemetry(input: TelemetryInput): Promise<TelemetryResult>
  listTelemetry(input: NeutralContext): Promise<TelemetryResult>
  getSuperadminState(input: SuperadminStateInput): Promise<SuperadminStateResult>
  setSuperadminIntent(input: SuperadminIntentInput): Promise<SuperadminIntentResult>
}

export interface NeutralStateClient {
  searchRecords(input: SearchInput): Promise<SearchResult>
  listAssets(input: NeutralContext): Promise<AssetsResult>
  listNotifications(input: NeutralContext): Promise<NotificationsResult>
  getJob(input: NeutralContext & { jobId: string }): Promise<JobResult | null>
  searchKnowledge(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult>
  listAudit(input: NeutralContext): Promise<AuditResult>
  listTelemetry(input: NeutralContext): Promise<TelemetryResult>
  getSuperadminState(input: SuperadminStateInput): Promise<SuperadminStateResult>
}

export interface NeutralIntentClient {
  signup(input: SignupInput): Promise<SignupResult>
  verify(input: VerifyInput): Promise<VerifyResult>
  createMembership(input: MembershipInput): Promise<MembershipResult>
  createRecord(input: RecordInput): Promise<RecordResult>
  updateRecord(input: RecordInput & { recordId: string }): Promise<RecordResult>
  deleteRecord(input: NeutralContext & { recordId: string }): Promise<{ deleted: true }>
  uploadAsset(input: AssetInput): Promise<AssetResult>
  createNotification(input: NotificationInput): Promise<NotificationResult>
  submitJob(input: JobInput): Promise<JobResult>
  runAi(input: AiInput): Promise<AiResult>
  ingestKnowledge(input: KnowledgeInput): Promise<KnowledgeResult>
  recordTelemetry(input: TelemetryInput): Promise<TelemetryResult>
  setSuperadminIntent(input: SuperadminIntentInput): Promise<SuperadminIntentResult>
}

export interface JsonObject {
  [key: string]: JsonValue
}

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject

interface StoredUser {
  userId: string
  tenantId: string
  email: string
  verified: boolean
}

interface StoredKnowledge extends KnowledgeResult {
  text: string
}

export class InMemoryNeutralContractApi implements NeutralContractApi {
  readonly profile: NeutralProfile = {
    name: 'aws-terraform',
    mode: NEUTRAL_PROFILE_MODE.FAKE,
    disposition: createUnavailableCloudNativeDisposition(
      'live profile access and managed resources are unavailable'
    ),
  }

  private readonly users = new Map<string, StoredUser>()
  private readonly memberships = new Map<string, MembershipResult>()
  private readonly records = new Map<string, RecordResult>()
  private readonly assets = new Map<string, AssetResult>()
  private readonly notifications = new Map<string, NotificationResult>()
  private readonly jobs = new Map<string, JobResult>()
  private readonly knowledge = new Map<string, StoredKnowledge>()
  private readonly auditEvents: AuditEvent[] = []
  private readonly telemetry: TelemetryPoint[] = []
  private readonly notificationKeys = new Map<string, string>()
  private readonly jobKeys = new Map<string, string>()
  private readonly aiKeys = new Map<string, AiResult>()
  private readonly sequences = new Map<string, number>()
  private policyVersion = 1

  async signup(input: SignupInput): Promise<SignupResult> {
    const existing = [...this.users.values()].find(
      (user) => user.tenantId === input.tenantId && user.email === input.email
    )
    const user = existing ?? this.storeUser(input)
    this.record(input, 'identity.signup', 'success')
    return {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      userId: user.userId,
      verificationToken: `verify-${user.userId}`,
      status: user.verified ? 'pending-verification' : 'pending-verification',
    }
  }

  async verify(input: VerifyInput): Promise<VerifyResult> {
    const user = this.users.get(input.userId)
    if (
      user === undefined ||
      user.tenantId !== input.tenantId ||
      input.token !== `verify-${input.userId}`
    ) {
      this.record(input, 'identity.verify', 'denied')
      throw new Error('Verification could not be completed')
    }
    user.verified = true
    this.record(input, 'identity.verify', 'success')
    return { contractVersion: NEUTRAL_CONTRACT_VERSION, userId: input.userId, status: 'verified' }
  }

  async createMembership(input: MembershipInput): Promise<MembershipResult> {
    const membership: MembershipResult = {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      membershipId: this.nextId('membership'),
      tenantId: input.tenantId,
      actorId: input.actorId,
      role: input.role,
    }
    this.memberships.set(this.scope(input, input.actorId), membership)
    this.record(input, 'membership.created', 'success')
    return membership
  }

  async createRecord(input: RecordInput): Promise<RecordResult> {
    const result: RecordResult = {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      recordId: this.nextId('record'),
      tenantId: input.tenantId,
      collection: input.collection,
      value: input.value,
    }
    this.records.set(result.recordId, result)
    this.record(input, 'crud.created', 'success')
    return result
  }

  async updateRecord(input: RecordInput & { recordId: string }): Promise<RecordResult> {
    const current = this.requireTenantRecord(input.recordId, input.tenantId)
    const result = { ...current, collection: input.collection, value: input.value }
    this.records.set(result.recordId, result)
    this.record(input, 'crud.updated', 'success')
    return result
  }

  async deleteRecord(input: NeutralContext & { recordId: string }): Promise<{ deleted: true }> {
    this.requireTenantRecord(input.recordId, input.tenantId)
    this.records.delete(input.recordId)
    this.record(input, 'crud.deleted', 'success')
    return { deleted: true }
  }

  async searchRecords(input: SearchInput): Promise<SearchResult> {
    const query = input.query.toLowerCase()
    const records = [...this.records.values()].filter(
      (record) =>
        record.tenantId === input.tenantId &&
        record.collection === input.collection &&
        JSON.stringify(record.value).toLowerCase().includes(query)
    )
    this.record(input, 'crud.searched', 'success')
    return { contractVersion: NEUTRAL_CONTRACT_VERSION, records }
  }

  async uploadAsset(input: AssetInput): Promise<AssetResult> {
    const asset: AssetResult = {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      assetId: this.nextId('asset'),
      tenantId: input.tenantId,
      name: input.name,
      contentType: input.contentType,
      bytes: input.content.length,
      status: 'available',
    }
    this.assets.set(asset.assetId, asset)
    this.record(input, 'asset.uploaded', 'success')
    return asset
  }

  async listAssets(input: NeutralContext): Promise<AssetsResult> {
    return {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      assets: [...this.assets.values()].filter((asset) => asset.tenantId === input.tenantId),
    }
  }

  async createNotification(input: NotificationInput): Promise<NotificationResult> {
    const key = this.idempotencyScope(input)
    const previousId =
      input.idempotencyKey === undefined ? undefined : this.notificationKeys.get(key)
    if (previousId !== undefined) return this.notifications.get(previousId) as NotificationResult
    const notification: NotificationResult = {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      notificationId: this.nextId('notification'),
      tenantId: input.tenantId,
      actorId: input.actorId,
      message: input.message,
      status: 'queued',
    }
    this.notifications.set(notification.notificationId, notification)
    if (input.idempotencyKey !== undefined)
      this.notificationKeys.set(key, notification.notificationId)
    this.record(input, 'notification.created', 'success')
    return notification
  }

  async listNotifications(input: NeutralContext): Promise<NotificationsResult> {
    return {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      notifications: [...this.notifications.values()].filter(
        (item) => item.tenantId === input.tenantId
      ),
    }
  }

  async submitJob(input: JobInput): Promise<JobResult> {
    const key = this.idempotencyScope(input)
    const previousId = input.idempotencyKey === undefined ? undefined : this.jobKeys.get(key)
    if (previousId !== undefined) return this.jobs.get(previousId) as JobResult
    const job: JobResult = {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      jobId: this.nextId('job'),
      tenantId: input.tenantId,
      kind: input.kind,
      status: 'completed',
      attempts: 1,
    }
    this.jobs.set(job.jobId, job)
    if (input.idempotencyKey !== undefined) this.jobKeys.set(key, job.jobId)
    this.record(input, 'job.completed', 'success')
    return job
  }

  async getJob(input: NeutralContext & { jobId: string }): Promise<JobResult | null> {
    const job = this.jobs.get(input.jobId)
    return job?.tenantId === input.tenantId ? job : null
  }

  async runAi(input: AiInput): Promise<AiResult> {
    const key = this.idempotencyScope(input)
    const previous = input.idempotencyKey === undefined ? undefined : this.aiKeys.get(key)
    if (previous !== undefined) return previous
    const result: AiResult = {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      resultId: this.nextId('ai'),
      output: `Deterministic result for: ${input.prompt}`,
      provider: 'deterministic-fake',
      usage: { inputUnits: input.prompt.length, outputUnits: 1 },
    }
    if (input.idempotencyKey !== undefined) this.aiKeys.set(key, result)
    this.record(input, 'ai.completed', 'success')
    return result
  }

  async ingestKnowledge(input: KnowledgeInput): Promise<KnowledgeResult> {
    const document: StoredKnowledge = {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      documentId: this.nextId('document'),
      assetId: input.assetId,
      status: 'indexed',
      lineage: { tenantId: input.tenantId, checksum: this.checksum(input.text) },
      text: input.text,
    }
    this.knowledge.set(document.documentId, document)
    this.record(input, 'rag.indexed', 'success')
    return document
  }

  async searchKnowledge(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
    const documents = [...this.knowledge.values()].filter(
      (document) => document.lineage.tenantId === input.tenantId
    )
    const match =
      documents.find((document) => document.text.toLowerCase().includes('factory')) ?? documents[0]
    this.record(input, 'rag.searched', match === undefined ? 'denied' : 'success')
    if (match === undefined) {
      return {
        contractVersion: NEUTRAL_CONTRACT_VERSION,
        answer: '',
        citations: [],
        status: 'unavailable',
      }
    }
    return {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      answer: match.text,
      citations: [{ documentId: match.documentId, assetId: match.assetId }],
      status: 'grounded',
    }
  }

  async listAudit(input: NeutralContext): Promise<AuditResult> {
    const events = this.auditEvents.filter((event) => event.tenantId === input.tenantId)
    return { contractVersion: NEUTRAL_CONTRACT_VERSION, denied: events.length === 0, events }
  }

  async recordTelemetry(input: TelemetryInput): Promise<TelemetryResult> {
    this.telemetry.push({
      pointId: this.nextId('telemetry'),
      tenantId: input.tenantId,
      name: input.name,
      value: input.value,
      correlationId: input.correlationId,
    })
    this.record(input, 'telemetry.recorded', 'success')
    return this.listTelemetry(input)
  }

  async listTelemetry(input: NeutralContext): Promise<TelemetryResult> {
    return {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      points: this.telemetry.filter((point) => point.tenantId === input.tenantId),
    }
  }

  async getSuperadminState(input: SuperadminStateInput): Promise<SuperadminStateResult> {
    this.record(input, 'superadmin.state.read', 'success')
    return {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      product: 'neutral-reference',
      policyVersion: this.policyVersion,
      tenantCount: new Set([...this.users.values()].map((user) => user.tenantId)).size,
    }
  }

  async setSuperadminIntent(input: SuperadminIntentInput): Promise<SuperadminIntentResult> {
    this.policyVersion += 1
    this.record(input, 'superadmin.intent.recorded', 'success')
    return {
      contractVersion: NEUTRAL_CONTRACT_VERSION,
      status: 'recorded',
      intent: input.intent,
      target: input.target,
      policyVersion: this.policyVersion,
    }
  }

  private storeUser(input: SignupInput): StoredUser {
    const user: StoredUser = {
      userId: this.nextId('user'),
      tenantId: input.tenantId,
      email: input.email,
      verified: false,
    }
    this.users.set(user.userId, user)
    return user
  }

  private requireTenantRecord(recordId: string, tenantId: string): RecordResult {
    const record = this.records.get(recordId)
    if (record === undefined || record.tenantId !== tenantId) throw new Error('Record not found')
    return record
  }

  private record(input: NeutralContext, action: string, outcome: AuditEvent['outcome']): void {
    this.auditEvents.push({
      eventId: this.nextId('audit'),
      tenantId: input.tenantId,
      actorId: input.actorId,
      action,
      outcome,
      correlationId: input.correlationId,
    })
  }

  private nextId(prefix: string): string {
    const next = (this.sequences.get(prefix) ?? 0) + 1
    this.sequences.set(prefix, next)
    return `${prefix}-${next}`
  }

  private scope(input: NeutralContext, value: string): string {
    return `${input.tenantId}:${value}`
  }

  private idempotencyScope(input: IdempotentContext): string {
    return this.scope(input, input.idempotencyKey ?? `${input.actorId}:${input.correlationId}`)
  }

  private checksum(value: string): string {
    let hash = 0
    for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
    return hash.toString(16).padStart(8, '0')
  }
}

export function createNeutralStateClient(api: NeutralContractApi): NeutralStateClient {
  return {
    searchRecords: (input) => api.searchRecords(input),
    listAssets: (input) => api.listAssets(input),
    listNotifications: (input) => api.listNotifications(input),
    getJob: (input) => api.getJob(input),
    searchKnowledge: (input) => api.searchKnowledge(input),
    listAudit: (input) => api.listAudit(input),
    listTelemetry: (input) => api.listTelemetry(input),
    getSuperadminState: (input) => api.getSuperadminState(input),
  }
}

export function createNeutralIntentClient(api: NeutralContractApi): NeutralIntentClient {
  return {
    signup: (input) => api.signup(input),
    verify: (input) => api.verify(input),
    createMembership: (input) => api.createMembership(input),
    createRecord: (input) => api.createRecord(input),
    updateRecord: (input) => api.updateRecord(input),
    deleteRecord: (input) => api.deleteRecord(input),
    uploadAsset: (input) => api.uploadAsset(input),
    createNotification: (input) => api.createNotification(input),
    submitJob: (input) => api.submitJob(input),
    runAi: (input) => api.runAi(input),
    ingestKnowledge: (input) => api.ingestKnowledge(input),
    recordTelemetry: (input) => api.recordTelemetry(input),
    setSuperadminIntent: (input) => api.setSuperadminIntent(input),
  }
}

export default {
  NEUTRAL_CONTRACT_VERSION,
  NEUTRAL_PROFILE_MODE,
  createUnavailableCloudNativeDisposition,
  InMemoryNeutralContractApi,
  createNeutralStateClient,
  createNeutralIntentClient,
}
