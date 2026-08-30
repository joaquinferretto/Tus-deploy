import {
  storageKey,
  toBytes,
  type DurableAssetSourcePort,
  type StagingPutInput,
  type StoragePutInput,
  type StorageScope,
  type StoredObject,
  type TransientAssetStagingPort,
} from '../ports/index.js'

function clone(object: StoredObject): StoredObject {
  return { ...object, data: new Uint8Array(object.data), metadata: { ...object.metadata } }
}

export class InMemoryB2Source implements DurableAssetSourcePort {
  readonly objects = new Map<string, StoredObject>()
  failNextDelete = false

  async put(input: StoragePutInput): Promise<StoredObject> {
    const object = {
      key: storageKey(input, ''),
      data: toBytes(input.data),
      contentType: input.contentType,
      metadata: { ...input.metadata },
    }
    this.objects.set(object.key, clone(object))
    return clone(object)
  }

  async get(scope: StorageScope): Promise<StoredObject | null> {
    const object = this.objects.get(storageKey(scope, ''))
    return object ? clone(object) : null
  }

  async delete(scope: StorageScope): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false
      throw new Error('deterministic B2 delete failure')
    }
    this.objects.delete(storageKey(scope, ''))
  }
}

export class InMemoryS3Staging implements TransientAssetStagingPort {
  readonly objects = new Map<string, StoredObject>()

  async put(input: StagingPutInput): Promise<StoredObject> {
    const object = {
      key: storageKey(input, 'staging'),
      data: toBytes(input.data),
      contentType: input.contentType,
      metadata: { ...input.metadata },
      expiresAt: input.now,
    }
    this.objects.set(object.key, clone(object))
    return clone(object)
  }

  async putObject(input: {
    bucket: string
    key: string
    data: Uint8Array
    contentType?: string
    metadata: Record<string, string>
  }): Promise<void> {
    const expiresAt = Number(input.metadata.lifecycleExpiresAt)
    this.objects.set(
      input.key,
      clone({
        key: input.key,
        data: input.data,
        contentType: input.contentType,
        metadata: { ...input.metadata },
        expiresAt,
      })
    )
  }

  async get(key: string): Promise<StoredObject | null> {
    const object = this.objects.get(key)
    return object ? clone(object) : null
  }

  async getObject(input: { bucket: string; key: string }): Promise<StoredObject | null> {
    return this.get(input.key)
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async deleteObject(input: { bucket: string; key: string }): Promise<void> {
    await this.delete(input.key)
  }

  async cleanup(now: number): Promise<number> {
    const expired = [...this.objects.values()].filter(
      (object) => object.expiresAt !== undefined && object.expiresAt <= now
    )
    for (const object of expired) this.objects.delete(object.key)
    return expired.length
  }

  async listObjects(
    input: string | { bucket: string; prefix: string } = 'staging/tenants/'
  ): Promise<readonly StoredObject[]> {
    const prefix = typeof input === 'string' ? input : input.prefix
    return [...this.objects.values()].filter((object) => object.key.startsWith(prefix)).map(clone)
  }
}

export default { InMemoryB2Source, InMemoryS3Staging }
