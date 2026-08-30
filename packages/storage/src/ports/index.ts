export const STORAGE_ACTIVATION = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
} as const

export type StorageActivation = (typeof STORAGE_ACTIVATION)[keyof typeof STORAGE_ACTIVATION]

export interface StorageScope {
  tenantId: string
  workspaceId: string
  assetId: string
}

export interface StoragePutInput extends StorageScope {
  data: string | Uint8Array
  contentType?: string
  metadata?: Readonly<Record<string, string>>
  now?: number
}

export interface StoredObject {
  key: string
  data: Uint8Array
  contentType?: string
  metadata: Record<string, string>
  expiresAt?: number
}

export interface DurableAssetSourcePort {
  put(input: StoragePutInput): Promise<StoredObject>
  get(scope: StorageScope): Promise<StoredObject | null>
  delete(scope: StorageScope): Promise<void>
}

export interface StagingPutInput extends StoragePutInput {
  now: number
}

export interface TransientAssetStagingPort {
  put(input: StagingPutInput): Promise<StoredObject>
  get(key: string): Promise<StoredObject | null>
  delete(key: string): Promise<void>
  cleanup(now: number): Promise<number>
}

export function assertStorageScope(scope: StorageScope): void {
  for (const [name, value] of Object.entries({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    assetId: scope.assetId,
  })) {
    if (!value.trim() || value.includes('/') || value.includes('\\')) {
      throw new Error(`Invalid storage scope field: ${name}`)
    }
  }
}

export function storageKey(scope: StorageScope, prefix: string): string {
  assertStorageScope(scope)
  const root = prefix ? `${prefix}/` : ''
  return `${root}tenants/${scope.tenantId}/workspaces/${scope.workspaceId}/assets/${scope.assetId}`
}

export function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
}

export class StorageActivationError extends Error {
  readonly code = 'STORAGE_ACTIVATION_REQUIRED'

  constructor(provider: string) {
    super(`${provider} storage is disabled until its activation gate is satisfied`)
    this.name = 'StorageActivationError'
  }
}

export default {
  STORAGE_ACTIVATION,
  assertStorageScope,
  storageKey,
  toBytes,
  StorageActivationError,
}
