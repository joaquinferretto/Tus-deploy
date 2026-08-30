import type {
  CrudCreateData,
  CrudPage,
  CrudPatch,
  CrudQuery,
  TenantCrudRecord,
} from '../domain/types.js'

export interface CrudRepository<TRecord extends TenantCrudRecord = TenantCrudRecord> {
  create(record: TRecord): Promise<TRecord>
  findById(tenantId: string, id: string): Promise<TRecord | null>
  update(tenantId: string, id: string, patch: CrudPatch<TRecord>): Promise<TRecord | null>
  delete(tenantId: string, id: string): Promise<boolean>
  search(tenantId: string, query: CrudQuery): Promise<CrudPage<TRecord>>
}

export interface CrudRepositoryFactory<TRecord extends TenantCrudRecord = TenantCrudRecord> {
  forResource(resourceType: string): CrudRepository<TRecord>
}

export type CrudInput = CrudCreateData
