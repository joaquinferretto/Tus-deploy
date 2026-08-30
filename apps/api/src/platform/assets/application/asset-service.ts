import {
  ASSET_RESULT_CODE,
  ASSET_STATUS,
  cloneAssetRecord,
  type AssetContext,
  type AssetFailure,
  type AssetLineageRecord,
  type AssetRecord,
  validAssetContext,
  validAssetMetadata,
} from '../domain.js'
import type {
  AssetCleanupInput,
  AssetCreateInput,
  AssetDeleteInput,
  AssetGetInput,
  AssetLineageInput,
  AssetServiceDependencies,
} from '../ports.js'

export type AssetOperationResult<T> = { ok: true; value: T; idempotent?: boolean } | AssetFailure

export class AssetService {
  private readonly deletionResults = new Map<string, true>()
  private readonly deletionAttempts = new Set<string>()

  constructor(private readonly dependencies: AssetServiceDependencies) {}

  async create(input: AssetCreateInput): Promise<AssetOperationResult<AssetRecord>> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    if (!(await this.dependencies.authorization.authorize(context.value, 'write')))
      return failure(ASSET_RESULT_CODE.FORBIDDEN, 'asset_write_denied')
    if (!validAssetMetadata(input.metadata) || !sameScope(context.value, input.metadata.ownership))
      return failure(ASSET_RESULT_CODE.INVALID, 'asset_metadata_invalid')
    const existing = await this.dependencies.store.find(
      context.value.tenantId,
      context.value.workspaceId,
      input.metadata.assetId
    )
    if (existing) return failure(ASSET_RESULT_CODE.INVALID, 'asset_already_exists')

    const record: AssetRecord = {
      contractVersion: '1.0.0',
      assetId: input.metadata.assetId,
      tenantId: context.value.tenantId,
      workspaceId: context.value.workspaceId,
      metadata: cloneMetadata(input.metadata),
      source: 'b2',
      accessPolicy: input.accessPolicy ?? {
        tenantId: context.value.tenantId,
        workspaceId: context.value.workspaceId,
        allowedActorIds: [context.value.actorId],
      },
      retentionUntil: input.retentionUntil ?? null,
      status: ASSET_STATUS.ACTIVE,
      createdAt: this.dependencies.clock.now(),
      deletedAt: null,
    }
    if (!sameScope(context.value, record.accessPolicy))
      return failure(ASSET_RESULT_CODE.INVALID, 'asset_access_policy_invalid')
    await this.dependencies.source.put({
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      assetId: record.assetId,
      data: input.data,
      contentType: input.metadata.mimeType,
      metadata: { assetId: record.assetId },
    })
    await this.dependencies.store.save(record)
    return { ok: true, value: cloneAssetRecord(record) }
  }

  async get(input: AssetGetInput): Promise<AssetOperationResult<AssetRecord>> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    if (!(await this.dependencies.authorization.authorize(context.value, 'read')))
      return failure(ASSET_RESULT_CODE.FORBIDDEN, 'asset_read_denied')
    const record = await this.dependencies.store.find(
      context.value.tenantId,
      context.value.workspaceId,
      input.assetId
    )
    if (
      !record ||
      record.status === ASSET_STATUS.DELETED ||
      !record.accessPolicy.allowedActorIds.includes(context.value.actorId)
    )
      return failure(ASSET_RESULT_CODE.NOT_FOUND, 'asset_not_found')
    return { ok: true, value: record }
  }

  async recordLineage(input: AssetLineageInput): Promise<AssetOperationResult<AssetLineageRecord>> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    if (!(await this.dependencies.authorization.authorize(context.value, 'write')))
      return failure(ASSET_RESULT_CODE.FORBIDDEN, 'asset_write_denied')
    const target = await this.dependencies.store.find(
      context.value.tenantId,
      context.value.workspaceId,
      input.assetId
    )
    if (!target || target.status === ASSET_STATUS.DELETED)
      return failure(ASSET_RESULT_CODE.NOT_FOUND, 'asset_not_found')
    for (const parent of input.parents) {
      const source = await this.dependencies.store.find(
        context.value.tenantId,
        context.value.workspaceId,
        parent.assetId
      )
      if (!source || source.status === ASSET_STATUS.DELETED)
        return failure(ASSET_RESULT_CODE.NOT_FOUND, 'asset_parent_not_found')
    }
    if (!input.parents.length || !input.operation.tool.trim() || !input.operation.jobId.trim())
      return failure(ASSET_RESULT_CODE.INVALID, 'asset_lineage_invalid')
    const event: AssetLineageRecord = {
      contractVersion: '1.0.0',
      lineageId: this.dependencies.ids.next('lineage'),
      tenantId: context.value.tenantId,
      assetId: input.assetId,
      parents: input.parents.map((parent) => ({ ...parent })),
      operation: { ...input.operation },
      recordedAt: this.dependencies.clock.now(),
      invalidatedAt: null,
    }
    await this.dependencies.lineage.append(event)
    return { ok: true, value: event }
  }

  async delete(input: AssetDeleteInput): Promise<AssetOperationResult<true>> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    if (!(await this.dependencies.authorization.authorize(context.value, 'delete')))
      return failure(ASSET_RESULT_CODE.FORBIDDEN, 'asset_delete_denied')
    if (!input.idempotencyKey.trim())
      return failure(ASSET_RESULT_CODE.INVALID, 'asset_idempotency_key_required')
    const idempotencyKey = `${context.value.tenantId}:${context.value.workspaceId}:${input.assetId}:${input.idempotencyKey}`
    if (this.deletionResults.has(idempotencyKey)) return { ok: true, value: true, idempotent: true }
    const record = await this.dependencies.store.find(
      context.value.tenantId,
      context.value.workspaceId,
      input.assetId
    )
    if (!record) return failure(ASSET_RESULT_CODE.NOT_FOUND, 'asset_not_found')
    if (record.status === ASSET_STATUS.DELETED) return { ok: true, value: true, idempotent: true }
    const retried = this.deletionAttempts.has(idempotencyKey)
    this.deletionAttempts.add(idempotencyKey)
    try {
      await this.dependencies.source.delete({
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        assetId: record.assetId,
      })
      const deleted = {
        ...record,
        status: ASSET_STATUS.DELETED,
        deletedAt: this.dependencies.clock.now(),
      } satisfies AssetRecord
      await this.dependencies.store.save(deleted)
      await this.dependencies.lineage.invalidateByParent(
        record.tenantId,
        record.assetId,
        deleted.deletedAt ?? this.dependencies.clock.now()
      )
      this.deletionResults.set(idempotencyKey, true)
      return { ok: true, value: true, ...(retried ? { idempotent: true } : {}) }
    } catch {
      return failure(ASSET_RESULT_CODE.RETRYABLE, 'asset_delete_retryable')
    }
  }

  async cleanup(input: AssetCleanupInput): Promise<{ ok: true; deleted: number } | AssetFailure> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    if (!(await this.dependencies.authorization.authorize(context.value, 'delete')))
      return failure(ASSET_RESULT_CODE.FORBIDDEN, 'asset_delete_denied')
    const expired = await this.dependencies.store.listExpired(
      context.value.tenantId,
      input.now ?? this.dependencies.clock.now()
    )
    let deleted = 0
    for (const record of expired) {
      const result = await this.delete({
        context: context.value,
        assetId: record.assetId,
        idempotencyKey: `retention:${record.assetId}`,
      })
      if (result.ok) deleted += 1
    }
    return { ok: true, deleted }
  }

  get source(): AssetServiceDependencies['source'] {
    return this.dependencies.source
  }

  get lineage(): AssetServiceDependencies['lineage'] {
    return this.dependencies.lineage
  }

  private requireContext(
    context: AssetContext | undefined
  ): { ok: true; value: AssetContext } | AssetFailure {
    return validAssetContext(context)
      ? { ok: true, value: context }
      : failure(ASSET_RESULT_CODE.INVALID, 'invalid_asset_context')
  }
}

function sameScope(
  left: { tenantId: string; workspaceId: string },
  right: { tenantId: string; workspaceId: string }
): boolean {
  return left.tenantId === right.tenantId && left.workspaceId === right.workspaceId
}

function cloneMetadata(metadata: AssetCreateInput['metadata']): AssetCreateInput['metadata'] {
  return { ...metadata, ownership: { ...metadata.ownership }, checksum: { ...metadata.checksum } }
}

function failure(code: AssetFailure['code'], reason: string): AssetFailure {
  return { ok: false, code, reason }
}

export default { AssetService }
