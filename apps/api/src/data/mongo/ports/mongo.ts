import type { MongoCollection } from '../../ownership/mongo-ownership.js'
import type { MongoSession } from '../sessions/mongo-session.js'
import type { TenantScopedMongoFilter } from './tenant-filter.js'

export type { MongoSession } from '../sessions/mongo-session.js'

export interface MongoDocument {
  id: string
  tenantId: string
  collection: MongoCollection
  version: number
  payload: Record<string, unknown>
}

export interface MongoDocumentStore {
  find(filter: TenantScopedMongoFilter): Promise<readonly MongoDocument[]>
  upsert(document: MongoDocument, session?: MongoSession): Promise<void>
  delete(filter: TenantScopedMongoFilter, session?: MongoSession): Promise<void>
  withSession<T>(operation: (session: MongoSession) => Promise<T>): Promise<T>
}

export const PROJECTION_OPERATION = {
  UPSERT: 'upsert',
  DELETE: 'delete',
} as const

export type ProjectionOperation = (typeof PROJECTION_OPERATION)[keyof typeof PROJECTION_OPERATION]

export interface ProjectionEvent {
  eventId: string
  tenantId: string
  collection: MongoCollection
  documentId: string
  version: number
  operation: ProjectionOperation
  payload: Record<string, unknown>
}

export interface ProjectionSourcePort {
  listEvents(input: { tenantId: string; collection: MongoCollection }): Promise<readonly ProjectionEvent[]>
  acknowledge(eventId: string): void
}
