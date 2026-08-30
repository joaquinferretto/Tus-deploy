import type { MongoDocument, MongoDocumentStore, MongoSession } from '../ports/mongo.js'
import type { TenantScopedMongoFilter } from '../ports/tenant-filter.js'

export class MongoUnavailableError extends Error {
  readonly code = 'MONGO_UNAVAILABLE'

  constructor(reason = 'MongoDB is unavailable') {
    super('MongoDB is unavailable')
    this.name = 'MongoUnavailableError'
    this.cause = reason
  }
}

export class UnavailableMongoDocumentStore implements MongoDocumentStore {
  private readonly error: MongoUnavailableError

  constructor(reason?: string) {
    this.error = new MongoUnavailableError(reason)
  }

  async find(_filter: TenantScopedMongoFilter): Promise<readonly MongoDocument[]> {
    throw this.error
  }

  async upsert(_document: MongoDocument, _session?: MongoSession): Promise<void> {
    throw this.error
  }

  async delete(_filter: TenantScopedMongoFilter, _session?: MongoSession): Promise<void> {
    throw this.error
  }

  async withSession<T>(_operation: (session: MongoSession) => Promise<T>): Promise<T> {
    throw this.error
  }
}

export default { UnavailableMongoDocumentStore, MongoUnavailableError }
