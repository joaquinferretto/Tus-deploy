export const ASSET_CONTRACT_VERSION = '1.0.0' as const

export const ASSET_STATUS = {
  ACTIVE: 'active',
  DELETED: 'deleted',
} as const

export type AssetStatus = (typeof ASSET_STATUS)[keyof typeof ASSET_STATUS]

export const ASSET_RESULT_CODE = {
  FORBIDDEN: 'FORBIDDEN',
  INVALID: 'INVALID',
  NOT_FOUND: 'NOT_FOUND',
  RETRYABLE: 'RETRYABLE',
} as const

export type AssetResultCode = (typeof ASSET_RESULT_CODE)[keyof typeof ASSET_RESULT_CODE]

export interface AssetContext {
  tenantId: string
  workspaceId: string
  actorId: string
  correlationId: string
  permissions?: readonly string[]
}

export interface AssetOwnership {
  tenantId: string
  workspaceId: string
  actorId?: string
}

export interface AssetChecksum {
  algorithm: 'sha256' | 'sha512'
  value: string
}

export interface AssetMetadataInput {
  contractVersion: typeof ASSET_CONTRACT_VERSION
  assetId: string
  mimeType: string
  sourceUri: string
  checksum: AssetChecksum
  sizeBytes: number
  capturedAt: string
  ownership: AssetOwnership
}

export interface AssetAccessPolicy {
  tenantId: string
  workspaceId: string
  allowedActorIds: readonly string[]
}

export interface AssetRecord {
  contractVersion: typeof ASSET_CONTRACT_VERSION
  assetId: string
  tenantId: string
  workspaceId: string
  metadata: AssetMetadataInput
  source: 'b2'
  accessPolicy: AssetAccessPolicy
  retentionUntil: number | null
  status: AssetStatus
  createdAt: number
  deletedAt: number | null
}

export interface AssetLineageParent {
  assetId: string
  relationship: 'source' | 'reference' | 'mask' | 'audio' | 'template'
}

export interface AssetLineageOperation {
  stage: 'ingest' | 'transform' | 'generate' | 'publish'
  tool: string
  performedBy: string
  jobId: string
}

export interface AssetLineageRecord {
  contractVersion: typeof ASSET_CONTRACT_VERSION
  lineageId: string
  tenantId: string
  assetId: string
  parents: readonly AssetLineageParent[]
  operation: AssetLineageOperation
  recordedAt: number
  invalidatedAt: number | null
}

export interface AssetFailure {
  ok: false
  code: AssetResultCode
  reason: string
}

export function validAssetContext(context: AssetContext | undefined): context is AssetContext {
  return Boolean(
    context?.tenantId.trim() &&
    context.workspaceId.trim() &&
    context.actorId.trim() &&
    context.correlationId.trim()
  )
}

export function validAssetMetadata(metadata: AssetMetadataInput): boolean {
  return Boolean(
    metadata.contractVersion === ASSET_CONTRACT_VERSION &&
    metadata.assetId.trim() &&
    metadata.mimeType.includes('/') &&
    metadata.sourceUri.startsWith('b2://') &&
    metadata.checksum.value.trim() &&
    metadata.sizeBytes >= 0 &&
    metadata.ownership.tenantId.trim() &&
    metadata.ownership.workspaceId.trim()
  )
}

export function cloneAssetRecord(record: AssetRecord): AssetRecord {
  return {
    ...record,
    metadata: {
      ...record.metadata,
      ownership: { ...record.metadata.ownership },
      checksum: { ...record.metadata.checksum },
    },
    accessPolicy: {
      ...record.accessPolicy,
      allowedActorIds: [...record.accessPolicy.allowedActorIds],
    },
  }
}

export function cloneLineage(record: AssetLineageRecord): AssetLineageRecord {
  return {
    ...record,
    parents: record.parents.map((parent) => ({ ...parent })),
    operation: { ...record.operation },
  }
}

export default {
  ASSET_CONTRACT_VERSION,
  ASSET_STATUS,
  ASSET_RESULT_CODE,
  validAssetContext,
  validAssetMetadata,
}
