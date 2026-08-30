import {
  STORAGE_ACTIVATION,
  StorageActivationError,
  storageKey,
  toBytes,
  type DurableAssetSourcePort,
  type StorageActivation,
  type StoragePutInput,
  type StoredObject,
  type StorageScope,
} from '../ports/index.js'

export interface B2ObjectClient {
  putObject(input: {
    bucket: string
    key: string
    data: Uint8Array
    contentType?: string
    metadata: Record<string, string>
  }): Promise<void>
  getObject(input: { bucket: string; key: string }): Promise<StoredObject | null>
  deleteObject(input: { bucket: string; key: string }): Promise<void>
}

export interface B2DurableSourceOptions {
  bucket: string
  activation?: StorageActivation
}

export class B2DurableSource implements DurableAssetSourcePort {
  constructor(
    private readonly client: B2ObjectClient,
    private readonly options: B2DurableSourceOptions
  ) {}

  async put(input: StoragePutInput): Promise<StoredObject> {
    this.assertEnabled()
    const key = storageKey(input, '')
    const object = {
      key,
      data: toBytes(input.data),
      contentType: input.contentType,
      metadata: { ...input.metadata },
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

  async get(scope: StorageScope): Promise<StoredObject | null> {
    this.assertEnabled()
    return this.client.getObject({ bucket: this.options.bucket, key: storageKey(scope, '') })
  }

  async delete(scope: StorageScope): Promise<void> {
    this.assertEnabled()
    await this.client.deleteObject({ bucket: this.options.bucket, key: storageKey(scope, '') })
  }

  private assertEnabled(): void {
    if ((this.options.activation ?? STORAGE_ACTIVATION.DISABLED) !== STORAGE_ACTIVATION.ENABLED) {
      throw new StorageActivationError('B2')
    }
  }
}

export default { B2DurableSource }
