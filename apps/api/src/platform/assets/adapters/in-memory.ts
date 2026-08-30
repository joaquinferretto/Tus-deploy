import {
  cloneAssetRecord,
  cloneLineage,
  type AssetAccessPolicy,
  type AssetContext,
  type AssetLineageRecord,
  type AssetRecord,
} from '../domain.js'
import type {
  AssetAuthorizationPort,
  AssetClock,
  AssetIdGenerator,
  AssetLineageStore,
  AssetSourceInput,
  AssetSourceObject,
  AssetStore,
} from '../ports.js'

function key(tenantId: string, workspaceId: string, assetId: string): string {
  return `${tenantId}:${workspaceId}:${assetId}`
}

export class InMemoryAssetStore implements AssetStore {
  readonly records = new Map<string, AssetRecord>()

  async save(record: AssetRecord): Promise<void> {
    this.records.set(
      key(record.tenantId, record.workspaceId, record.assetId),
      cloneAssetRecord(record)
    )
  }

  async find(tenantId: string, workspaceId: string, assetId: string): Promise<AssetRecord | null> {
    const record = this.records.get(key(tenantId, workspaceId, assetId))
    return record ? cloneAssetRecord(record) : null
  }

  async listExpired(tenantId: string, now: number): Promise<AssetRecord[]> {
    return [...this.records.values()]
      .filter(
        (record) =>
          record.tenantId === tenantId &&
          record.status === 'active' &&
          record.retentionUntil !== null &&
          record.retentionUntil <= now
      )
      .map(cloneAssetRecord)
  }
}

export class InMemoryAssetLineageStore implements AssetLineageStore {
  readonly events = new Map<string, AssetLineageRecord>()

  async append(event: AssetLineageRecord): Promise<void> {
    this.events.set(event.lineageId, cloneLineage(event))
  }

  async list(tenantId: string, assetId: string): Promise<AssetLineageRecord[]> {
    return [...this.events.values()]
      .filter((event) => event.tenantId === tenantId && event.assetId === assetId)
      .map(cloneLineage)
  }

  async invalidateByParent(tenantId: string, parentAssetId: string, now: number): Promise<void> {
    for (const [id, event] of this.events) {
      if (
        event.tenantId === tenantId &&
        event.parents.some((parent) => parent.assetId === parentAssetId) &&
        event.invalidatedAt === null
      ) {
        this.events.set(id, { ...cloneLineage(event), invalidatedAt: now })
      }
    }
  }
}

export class InMemoryAssetAuthorization implements AssetAuthorizationPort {
  async authorize(context: AssetContext, action: 'read' | 'write' | 'delete'): Promise<boolean> {
    return context.permissions?.includes(`asset:${action}`) ?? false
  }
}

export class DeterministicAssetIdGenerator implements AssetIdGenerator {
  private sequence = 0

  next(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
}

export class SystemAssetClock implements AssetClock {
  now(): number {
    return Date.now()
  }
}

export class DeterministicAssetClock implements AssetClock {
  constructor(private readonly value: number) {}

  now(): number {
    return this.value
  }
}

export class InMemoryB2Source {
  readonly objects = new Map<string, AssetSourceObject>()
  failNextDelete = false

  async put(input: AssetSourceInput): Promise<AssetSourceObject> {
    const object = {
      key: `tenants/${input.tenantId}/workspaces/${input.workspaceId}/assets/${input.assetId}`,
      data:
        typeof input.data === 'string'
          ? new TextEncoder().encode(input.data)
          : new Uint8Array(input.data),
      contentType: input.contentType,
      metadata: { ...input.metadata },
    }
    this.objects.set(object.key, cloneSourceObject(object))
    return cloneSourceObject(object)
  }

  async get(
    scope: Pick<AssetSourceInput, 'tenantId' | 'workspaceId' | 'assetId'>
  ): Promise<AssetSourceObject | null> {
    const object = this.objects.get(
      `tenants/${scope.tenantId}/workspaces/${scope.workspaceId}/assets/${scope.assetId}`
    )
    return object ? cloneSourceObject(object) : null
  }

  async delete(
    scope: Pick<AssetSourceInput, 'tenantId' | 'workspaceId' | 'assetId'>
  ): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false
      throw new Error('deterministic B2 delete failure')
    }
    this.objects.delete(
      `tenants/${scope.tenantId}/workspaces/${scope.workspaceId}/assets/${scope.assetId}`
    )
  }
}

function cloneSourceObject(object: AssetSourceObject): AssetSourceObject {
  return { ...object, data: new Uint8Array(object.data), metadata: { ...object.metadata } }
}

export type { AssetAccessPolicy }

export default {
  InMemoryAssetStore,
  InMemoryAssetLineageStore,
  InMemoryAssetAuthorization,
  DeterministicAssetIdGenerator,
  SystemAssetClock,
  DeterministicAssetClock,
  InMemoryB2Source,
}
