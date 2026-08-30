const MONGO_COLLECTION = {
  OWNED_DOCUMENTS: 'owned_documents',
  TENANT_READ_MODEL: 'tenant_read_model',
} as const

export { MONGO_COLLECTION }

export type MongoCollection = (typeof MONGO_COLLECTION)[keyof typeof MONGO_COLLECTION]

const MONGO_OWNERSHIP_ERROR = {
  UNKNOWN_COLLECTION: 'UNKNOWN_MONGO_COLLECTION',
} as const

export interface MongoCollectionOwnership {
  collection: MongoCollection
  owner: 'mongodb'
  dataClass: 'document' | 'read-model'
  sourceOfTruth: 'mongodb' | 'postgresql'
  rebuildStrategy: 'restore-mongodb-backup' | 'replay-postgres-outbox'
  tenantScoped: true
}

export class UnknownMongoCollectionError extends Error {
  readonly code = MONGO_OWNERSHIP_ERROR.UNKNOWN_COLLECTION

  constructor(collection: unknown) {
    super(`Mongo collection is not explicitly owned: ${String(collection)}`)
    this.name = 'UnknownMongoCollectionError'
  }
}

const OWNERSHIP: Readonly<Record<MongoCollection, MongoCollectionOwnership>> = {
  [MONGO_COLLECTION.OWNED_DOCUMENTS]: {
    collection: MONGO_COLLECTION.OWNED_DOCUMENTS,
    owner: 'mongodb',
    dataClass: 'document',
    sourceOfTruth: 'mongodb',
    rebuildStrategy: 'restore-mongodb-backup',
    tenantScoped: true,
  },
  [MONGO_COLLECTION.TENANT_READ_MODEL]: {
    collection: MONGO_COLLECTION.TENANT_READ_MODEL,
    owner: 'mongodb',
    dataClass: 'read-model',
    sourceOfTruth: 'postgresql',
    rebuildStrategy: 'replay-postgres-outbox',
    tenantScoped: true,
  },
}

export function ownershipForMongoCollection(collection: unknown): MongoCollectionOwnership {
  if (typeof collection !== 'string' || !(collection in OWNERSHIP)) {
    throw new UnknownMongoCollectionError(collection)
  }
  return { ...OWNERSHIP[collection as MongoCollection] }
}

export default { MONGO_COLLECTION, ownershipForMongoCollection }
