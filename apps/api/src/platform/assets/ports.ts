import type {
  AssetAccessPolicy,
  AssetContext,
  AssetLineageRecord,
  AssetMetadataInput,
  AssetRecord,
} from './domain.js'

export interface AssetSourceObject {
  key: string
  data: Uint8Array
  contentType?: string
  metadata: Record<string, string>
}

export interface AssetSourceInput {
  tenantId: string
  workspaceId: string
  assetId: string
  data: string | Uint8Array
  contentType?: string
  metadata?: Readonly<Record<string, string>>
}

export interface DurableAssetSourcePort {
  put(input: AssetSourceInput): Promise<AssetSourceObject>
  get(
    scope: Pick<AssetSourceInput, 'tenantId' | 'workspaceId' | 'assetId'>
  ): Promise<AssetSourceObject | null>
  delete(scope: Pick<AssetSourceInput, 'tenantId' | 'workspaceId' | 'assetId'>): Promise<void>
}

export interface AssetStore {
  readonly records: Map<string, AssetRecord>
  save(record: AssetRecord): Promise<void>
  find(tenantId: string, workspaceId: string, assetId: string): Promise<AssetRecord | null>
  listExpired(tenantId: string, now: number): Promise<AssetRecord[]>
}

export interface AssetLineageStore {
  readonly events: Map<string, AssetLineageRecord>
  append(event: AssetLineageRecord): Promise<void>
  list(tenantId: string, assetId: string): Promise<AssetLineageRecord[]>
  invalidateByParent(tenantId: string, parentAssetId: string, now: number): Promise<void>
}

export interface AssetAuthorizationPort {
  authorize(context: AssetContext, action: 'read' | 'write' | 'delete'): Promise<boolean>
}

export interface AssetClock {
  now(): number
}

export interface AssetIdGenerator {
  next(prefix: string): string
}

export interface AssetServiceDependencies {
  store: AssetStore
  lineage: AssetLineageStore
  source: DurableAssetSourcePort
  staging?: unknown
  authorization: AssetAuthorizationPort
  clock: AssetClock
  ids: AssetIdGenerator
}

export interface AssetCreateInput {
  context?: AssetContext
  metadata: AssetMetadataInput
  data: string | Uint8Array
  accessPolicy?: AssetAccessPolicy
  retentionUntil?: number | null
}

export interface AssetGetInput {
  context?: AssetContext
  assetId: string
}

export interface AssetDeleteInput {
  context?: AssetContext
  assetId: string
  idempotencyKey: string
}

export interface AssetLineageInput {
  context?: AssetContext
  assetId: string
  parents: AssetLineageRecord['parents']
  operation: AssetLineageRecord['operation']
}

export interface AssetCleanupInput {
  context?: AssetContext
  now?: number
}

export interface AssetServiceOptions {
  source: DurableAssetSourcePort
  lineage: AssetLineageStore
  store: AssetStore
  staging?: unknown
  authorization: AssetAuthorizationPort
  clock: AssetClock
  ids: AssetIdGenerator
}

export default {}
