import {
  STORAGE_ACTIVATION,
  StorageActivationError,
  storageKey,
  toBytes,
  type StagingPutInput,
  type StorageActivation,
  type StoredObject,
  type TransientAssetStagingPort,
} from '../ports/index.js'

export interface S3ObjectClient {
  putObject(input: {
    bucket: string
    key: string
    data: Uint8Array
    contentType?: string
    metadata: Record<string, string>
  }): Promise<void>
  getObject(input: { bucket: string; key: string }): Promise<StoredObject | null>
  deleteObject(input: { bucket: string; key: string }): Promise<void>
  listObjects(input: { bucket: string; prefix: string }): Promise<readonly StoredObject[]>
}

export interface S3StagingOptions {
  bucket: string
  encryptionKeyRef: string
  retentionSeconds: number
  activation?: StorageActivation
}

export class S3StagingStorage implements TransientAssetStagingPort {
  constructor(
    private readonly client: S3ObjectClient,
    private readonly options: S3StagingOptions
  ) {
    if (!options.encryptionKeyRef.trim())
      throw new Error('S3 staging encryption key reference is required')
    if (!Number.isInteger(options.retentionSeconds) || options.retentionSeconds <= 0)
      throw new Error('S3 staging retention must be positive')
  }

  async put(input: StagingPutInput): Promise<StoredObject> {
    this.assertEnabled()
    const key = storageKey(input, 'staging')
    const expiresAt = input.now + this.options.retentionSeconds
    const metadata = {
      ...input.metadata,
      encryptionKeyRef: this.options.encryptionKeyRef,
      lifecycleExpiresAt: String(expiresAt),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
    }
    const object = {
      key,
      data: toBytes(input.data),
      contentType: input.contentType,
      metadata,
      expiresAt,
    }
    await this.client.putObject({
      bucket: this.options.bucket,
      key: object.key,
      data: object.data,
      contentType: object.contentType,
      metadata: object.metadata,
    })
    return { ...object, data: new Uint8Array(object.data) }
  }

  async get(key: string): Promise<StoredObject | null> {
    this.assertEnabled()
    return this.client.getObject({ bucket: this.options.bucket, key })
  }

  async delete(key: string): Promise<void> {
    this.assertEnabled()
    await this.client.deleteObject({ bucket: this.options.bucket, key })
  }

  async cleanup(now: number): Promise<number> {
    this.assertEnabled()
    const objects = await this.client.listObjects({
      bucket: this.options.bucket,
      prefix: 'staging/tenants/',
    })
    const expired = objects.filter(
      (object) => object.expiresAt !== undefined && object.expiresAt <= now
    )
    for (const object of expired) await this.delete(object.key)
    return expired.length
  }

  private assertEnabled(): void {
    if ((this.options.activation ?? STORAGE_ACTIVATION.DISABLED) !== STORAGE_ACTIVATION.ENABLED) {
      throw new StorageActivationError('S3 staging')
    }
  }
}

export default { S3StagingStorage }
