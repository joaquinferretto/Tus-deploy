import { validTenantContext, type TenantContext } from '../../../tenancy/domain.js'
import { crudFailure, type CrudFailure } from '../domain/errors.js'
import { validateCrudQuery } from '../domain/query.js'
import {
  CRUD_ACTION,
  CRUD_RESULT_CODE,
  type CrudAuthorizationPort,
  type CrudClock,
  type CrudCreateData,
  type CrudIdGenerator,
  type CrudPage,
  type CrudQuery,
  type CrudResourceDefinition,
  type CrudPatch,
  type TenantCrudRecord,
} from '../domain/types.js'
import type { CrudRepository } from '../ports/repository.js'

export interface CrudServiceDependencies<TRecord extends TenantCrudRecord = TenantCrudRecord> {
  repository: CrudRepository<TRecord>
  authorization: CrudAuthorizationPort
  ids: CrudIdGenerator
  clock: CrudClock
}

export interface CrudRequestContext {
  context?: TenantContext
}

export interface CrudCreateInput extends CrudRequestContext {
  data: CrudCreateData
}

export interface CrudListInput extends CrudRequestContext {
  query: unknown
}

export interface CrudRecordInput extends CrudRequestContext {
  id: string
}

export interface CrudUpdateInput extends CrudRecordInput {
  patch: Record<string, unknown>
}

export type CrudSuccess<T extends TenantCrudRecord> = { ok: true; record: T }
export type CrudListSuccess<T extends TenantCrudRecord> = { ok: true; page: CrudPage<T> }
export type CrudOperationResult<T extends TenantCrudRecord> = CrudSuccess<T> | CrudFailure
export type CrudListResult<T extends TenantCrudRecord> = CrudListSuccess<T> | CrudFailure

export class CrudService<TRecord extends TenantCrudRecord = TenantCrudRecord> {
  constructor(
    private readonly dependencies: CrudServiceDependencies<TRecord>,
    private readonly definition: CrudResourceDefinition
  ) {}

  async create(input: CrudCreateInput): Promise<CrudOperationResult<TRecord>> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    const decision = await this.dependencies.authorization.authorize({
      context: context.value,
      action: CRUD_ACTION.WRITE,
      resourceType: this.definition.resourceType,
      resourceTenantId: context.value.tenantId,
    })
    if (!decision.allowed) return crudFailure(decision.code, decision.reason)
    if (!isRecord(input.data) || hasIdentityFields(input.data)) return crudFailure(CRUD_RESULT_CODE.INVALID, 'invalid_crud_record')
    const now = this.dependencies.clock.now()
    const record = {
      ...input.data,
      id: this.dependencies.ids.next(),
      tenantId: context.value.tenantId,
      createdAt: now,
      updatedAt: now,
    } as unknown as TRecord
    try {
      const created = await this.dependencies.repository.create(record)
      return { ok: true, record: created }
    } catch (error) {
      return crudFailure(CRUD_RESULT_CODE.CONFLICT, errorMessage(error, 'crud_create_failed'))
    }
  }

  async get(input: CrudRecordInput): Promise<CrudOperationResult<TRecord>> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    const decision = await this.dependencies.authorization.authorize({ context: context.value, action: CRUD_ACTION.READ, resourceType: this.definition.resourceType, resourceId: input.id, resourceTenantId: context.value.tenantId })
    if (!decision.allowed) return crudFailure(decision.code, decision.reason)
    const record = await this.dependencies.repository.findById(context.value.tenantId, input.id)
    return record ? { ok: true, record } : crudFailure(CRUD_RESULT_CODE.NOT_FOUND, 'crud_record_not_found')
  }

  async list(input: CrudListInput): Promise<CrudListResult<TRecord>> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    let query: CrudQuery
    try {
      query = validateCrudQuery(input.query, this.definition)
    } catch (error) {
      return crudFailure(errorCode(error, CRUD_RESULT_CODE.INVALID), errorMessage(error, 'invalid_crud_query'))
    }
    const decision = await this.dependencies.authorization.authorize({ context: context.value, action: CRUD_ACTION.READ, resourceType: this.definition.resourceType, resourceTenantId: context.value.tenantId })
    if (!decision.allowed) return crudFailure(decision.code, decision.reason)
    return { ok: true, page: await this.dependencies.repository.search(context.value.tenantId, query) }
  }

  async update(input: CrudUpdateInput): Promise<CrudOperationResult<TRecord>> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    if (!input.id.trim() || !isRecord(input.patch) || hasIdentityFields(input.patch)) return crudFailure(CRUD_RESULT_CODE.INVALID, 'invalid_crud_update')
    const decision = await this.dependencies.authorization.authorize({ context: context.value, action: CRUD_ACTION.WRITE, resourceType: this.definition.resourceType, resourceId: input.id, resourceTenantId: context.value.tenantId })
    if (!decision.allowed) return crudFailure(decision.code, decision.reason)
    const record = await this.dependencies.repository.update(context.value.tenantId, input.id, { ...input.patch, updatedAt: this.dependencies.clock.now() } as unknown as CrudPatch<TRecord>)
    return record ? { ok: true, record } : crudFailure(CRUD_RESULT_CODE.NOT_FOUND, 'crud_record_not_found')
  }

  async delete(input: CrudRecordInput): Promise<CrudFailure | { ok: true }> {
    const context = this.requireContext(input.context)
    if (!context.ok) return context
    const decision = await this.dependencies.authorization.authorize({ context: context.value, action: CRUD_ACTION.DELETE, resourceType: this.definition.resourceType, resourceId: input.id, resourceTenantId: context.value.tenantId })
    if (!decision.allowed) return crudFailure(decision.code, decision.reason)
    const deleted = await this.dependencies.repository.delete(context.value.tenantId, input.id)
    return deleted ? { ok: true } : crudFailure(CRUD_RESULT_CODE.NOT_FOUND, 'crud_record_not_found')
  }

  private requireContext(context: TenantContext | undefined): { ok: true; value: TenantContext } | CrudFailure {
    return validTenantContext(context) ? { ok: true, value: context } : crudFailure(CRUD_RESULT_CODE.INVALID_TENANT_CONTEXT, 'invalid_tenant_context')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasIdentityFields(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'id') || Object.prototype.hasOwnProperty.call(value, 'tenantId')
}

function errorCode(error: unknown, fallback: string): string {
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : fallback
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export default { CrudService }
