import {
  ownershipForMongoCollection,
  type MongoCollection,
} from '../../ownership/mongo-ownership.js'
import type {
  MongoDocument,
  MongoDocumentStore,
  MongoSession,
} from '../ports/mongo.js'
import { assertTenantFilter, buildTenantFilter, type TenantScopedMongoFilter } from '../ports/tenant-filter.js'

export interface InMemoryMongoOptions {
  failTransactions?: boolean
}

export class MongoSessionFailureError extends Error {
  readonly code = 'MONGO_SESSION_FAILED'

  constructor(reason = 'Mongo session transaction failed') {
    super(reason)
    this.name = 'MongoSessionFailureError'
  }
}

class InMemoryMongoSession implements MongoSession {
  readonly supportsTransactions = true

  constructor(
    readonly id: string,
    readonly state: Map<string, MongoDocument>
  ) {}
}

export class InMemoryMongoDocumentStore implements MongoDocumentStore {
  private documents = new Map<string, MongoDocument>()
  private sequence = 0

  constructor(private readonly options: InMemoryMongoOptions = {}) {}

  async find(filter: TenantScopedMongoFilter): Promise<readonly MongoDocument[]> {
    const scoped = assertTenantFilter(filter)
    return [...this.documents.values()]
      .filter((document) => matches(document, scoped))
      .map(cloneDocument)
  }

  async upsert(document: MongoDocument, session?: MongoSession): Promise<void> {
    const scoped = buildTenantFilter(document.tenantId, {
      id: document.id,
      collection: document.collection,
    })
    ownershipForMongoCollection(document.collection)
    if (document.version < 1) throw new Error('Mongo documents require a positive version')

    const state = this.stateFor(session)
    const key = documentKey(scoped.tenantId, document.collection, document.id)
    const previous = state.get(key)
    if (!previous || document.version >= previous.version) state.set(key, cloneDocument(document))
  }

  async delete(filter: TenantScopedMongoFilter, session?: MongoSession): Promise<void> {
    const scoped = assertTenantFilter(filter)
    if (!scoped.id || !scoped.collection) {
      throw new Error('Mongo deletes require tenant, collection, and id filters')
    }
    ownershipForMongoCollection(scoped.collection)
    this.stateFor(session).delete(documentKey(scoped.tenantId, scoped.collection, scoped.id))
  }

  async withSession<T>(operation: (session: MongoSession) => Promise<T>): Promise<T> {
    const session = new InMemoryMongoSession(
      `mongo-session-${++this.sequence}`,
      cloneState(this.documents)
    )
    try {
      const result = await operation(session)
      if (this.options.failTransactions) throw new MongoSessionFailureError()
      this.documents = cloneState(session.state)
      return result
    } catch (error) {
      if (this.options.failTransactions && !(error instanceof MongoSessionFailureError)) {
        throw new MongoSessionFailureError(error instanceof Error ? error.message : undefined)
      }
      throw error
    }
  }

  private stateFor(session?: MongoSession): Map<string, MongoDocument> {
    if (session === undefined) return this.documents
    if (!(session instanceof InMemoryMongoSession)) {
      throw new MongoSessionFailureError('Mongo writes require a session created by this adapter')
    }
    return session.state
  }
}

function documentKey(tenantId: string, collection: MongoCollection | string, id: string): string {
  return `${tenantId}:${collection}:${id}`
}

function matches(document: MongoDocument, filter: TenantScopedMongoFilter): boolean {
  return (
    document.tenantId === filter.tenantId &&
    (filter.collection === undefined || document.collection === filter.collection) &&
    (filter.id === undefined || document.id === filter.id)
  )
}

function cloneDocument(document: MongoDocument): MongoDocument {
  return { ...document, payload: { ...document.payload } }
}

function cloneState(state: Map<string, MongoDocument>): Map<string, MongoDocument> {
  return new Map([...state.entries()].map(([key, value]) => [key, cloneDocument(value)]))
}

export default { InMemoryMongoDocumentStore, MongoSessionFailureError }
