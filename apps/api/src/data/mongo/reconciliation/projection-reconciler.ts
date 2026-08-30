import {
  ownershipForMongoCollection,
  type MongoCollection,
} from '../../ownership/mongo-ownership.js'
import type {
  MongoDocument,
  MongoDocumentStore,
  MongoSession,
  ProjectionEvent,
  ProjectionSourcePort,
} from '../ports/mongo.js'
import { buildTenantFilter } from '../ports/tenant-filter.js'

const RECONCILIATION_STATUS = {
  COMPLETED: 'completed',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed',
} as const

export type ReconciliationStatus =
  (typeof RECONCILIATION_STATUS)[keyof typeof RECONCILIATION_STATUS]

export interface ProjectionRebuildInput {
  tenantId: string
  collection: MongoCollection
}

export interface ProjectionRebuildReport {
  status: ReconciliationStatus
  tenantId: string
  collection: MongoCollection
  applied: number
  failed: number
  retryable: boolean
  lastEventId: string | null
  reason?: string
}

export class ProjectionReconciler {
  constructor(
    private readonly store: MongoDocumentStore,
    private readonly source: ProjectionSourcePort
  ) {}

  async rebuild(input: ProjectionRebuildInput): Promise<ProjectionRebuildReport> {
    const scoped = buildTenantFilter(input.tenantId, { collection: input.collection })
    ownershipForMongoCollection(scoped.collection)
    const events = await this.source.listEvents({
      tenantId: scoped.tenantId,
      collection: input.collection,
    })
    const appliedEvents: ProjectionEvent[] = []

    try {
      await this.store.withSession(async (session) => {
        for (const event of events) {
          await applyEvent(this.store, event, session)
          appliedEvents.push(event)
        }
      })
    } catch (error) {
      const unavailable = error instanceof Error && error.name === 'MongoUnavailableError'
      return {
        status: unavailable ? RECONCILIATION_STATUS.UNAVAILABLE : RECONCILIATION_STATUS.FAILED,
        tenantId: scoped.tenantId,
        collection: input.collection,
        applied: 0,
        failed: events.length === 0 ? 1 : events.length,
        retryable: unavailable,
        lastEventId: null,
        reason: error instanceof Error ? error.message : 'Mongo projection rebuild failed',
      }
    }

    for (const event of appliedEvents) this.source.acknowledge(event.eventId)
    return {
      status: RECONCILIATION_STATUS.COMPLETED,
      tenantId: scoped.tenantId,
      collection: input.collection,
      applied: appliedEvents.length,
      failed: 0,
      retryable: false,
      lastEventId: appliedEvents.at(-1)?.eventId ?? null,
    }
  }
}

export class InMemoryProjectionSource implements ProjectionSourcePort {
  private readonly acknowledged = new Set<string>()

  constructor(private readonly events: readonly ProjectionEvent[]) {}

  async listEvents(input: {
    tenantId: string
    collection: MongoCollection
  }): Promise<readonly ProjectionEvent[]> {
    return this.events.filter(
      (event) =>
        !this.acknowledged.has(event.eventId) &&
        event.tenantId === input.tenantId &&
        event.collection === input.collection
    )
  }

  acknowledge(eventId: string): void {
    this.acknowledged.add(eventId)
  }

  pending(tenantId: string, collection: MongoCollection): number {
    return this.events.filter(
      (event) =>
        !this.acknowledged.has(event.eventId) &&
        event.tenantId === tenantId &&
        event.collection === collection
    ).length
  }
}

async function applyEvent(
  store: MongoDocumentStore,
  event: ProjectionEvent,
  session: MongoSession
): Promise<void> {
  const document: MongoDocument = {
    id: event.documentId,
    tenantId: event.tenantId,
    collection: event.collection,
    version: event.version,
    payload: { ...event.payload },
  }
  if (event.operation === 'delete') {
    await store.delete(
      buildTenantFilter(event.tenantId, {
        id: event.documentId,
        collection: event.collection,
      }),
      session
    )
    return
  }
  await store.upsert(document, session)
}

export default { InMemoryProjectionSource, ProjectionReconciler }
