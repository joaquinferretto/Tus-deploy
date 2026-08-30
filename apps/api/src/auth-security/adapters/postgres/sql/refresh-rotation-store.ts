import {
  REFRESH_OUTBOX_EVENT_TYPE,
  REFRESH_ROTATION_CODE,
  type RefreshOutboxEvent,
  type RefreshRotationOutcome,
  type RefreshRotationRequest,
  type RefreshTokenFamily,
} from '../../../domain/refresh.js'
import type {
  OutboxPort,
  RefreshRotationSnapshot,
  RefreshRotationStore,
  SessionRevocationPort,
} from '../../../ports/refresh-rotation.js'
import {
  APPEND_REFRESH_OUTBOX_EVENT_SQL,
  LOCK_REFRESH_FAMILY_SQL,
  REVOKE_DEVICE_SESSIONS_SQL,
  REVOKE_REFRESH_FAMILY_SQL,
  UPDATE_REFRESH_FAMILY_SQL,
} from './refresh-rotation.sql.js'

export interface SqlQueryResult<TRow> {
  rows: TRow[]
  rowCount: number
}

export interface SqlTransaction {
  query<TRow>(sql: string, parameters: readonly unknown[]): Promise<SqlQueryResult<TRow>>
}

export interface SqlClient {
  transaction<T>(operation: (transaction: SqlTransaction) => Promise<T>): Promise<T>
}

export interface TransactionalOutboxWriter {
  append(transaction: SqlTransaction, event: RefreshOutboxEvent): Promise<void>
}

export interface RefreshFamilyRow {
  id: string
  accountId: string
  tenantId: string
  deviceId: string
  sessionId: string
  currentTokenDigest: string
  usedTokenDigests: string[]
  generation: number
  expiresAt: Date
  revokedAt: Date | null
  compromisedAt: Date | null
  lastRotationIdempotencyKey: string | null
  lastPresentedTokenDigest: string | null
  lastReplacementAccessTokenDigest: string | null
}

export class SqlOutboxWriter implements TransactionalOutboxWriter {
  private readonly ids: { next(): string }

  constructor(ids: { next(): string }) {
    this.ids = ids
  }

  async append(transaction: SqlTransaction, event: RefreshOutboxEvent): Promise<void> {
    await transaction.query(APPEND_REFRESH_OUTBOX_EVENT_SQL, [
      this.ids.next(),
      event.type,
      event.aggregateType,
      event.aggregateId,
      new Date(event.occurredAt),
      JSON.stringify(event),
    ])
  }
}

export interface PostgresRefreshRotationStoreOptions {
  client: SqlClient
  outbox: TransactionalOutboxWriter
  ids: { next(): string }
}

export class PostgresRefreshRotationStore implements RefreshRotationStore {
  private readonly options: PostgresRefreshRotationStoreOptions

  constructor(options: PostgresRefreshRotationStoreOptions) {
    this.options = options
  }

  async createFamily(family: RefreshTokenFamily): Promise<void> {
    await this.options.client.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO "RefreshTokenFamily" ("id", "accountId", "tenantId", "deviceId", "sessionId", "currentTokenDigest", "usedTokenDigests", "generation", "expiresAt", "createdAt", "updatedAt", "revokedAt", "compromisedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          family.id,
          family.accountId,
          family.tenantId,
          family.deviceId,
          family.sessionId,
          family.currentTokenDigest,
          family.usedTokenDigests,
          family.generation,
          new Date(family.expiresAt),
          new Date(family.createdAt),
          new Date(family.updatedAt),
          family.revokedAt === null ? null : new Date(family.revokedAt),
          family.compromisedAt === null ? null : new Date(family.compromisedAt),
        ]
      )
    })
  }

  async rotate(input: RefreshRotationRequest): Promise<RefreshRotationOutcome> {
    return this.options.client.transaction(async (transaction) => {
      const locked = await transaction.query<RefreshFamilyRow>(LOCK_REFRESH_FAMILY_SQL, [
        input.presentedTokenDigest,
      ])
      const row = locked.rows[0]
      if (!row) return { ok: false, code: REFRESH_ROTATION_CODE.INVALID, familyCompromised: false }
      if (row.revokedAt !== null) {
        return { ok: false, code: REFRESH_ROTATION_CODE.FAMILY_REVOKED, familyCompromised: false }
      }
      if (
        row.lastRotationIdempotencyKey === input.idempotencyKey &&
        row.lastPresentedTokenDigest === input.presentedTokenDigest
      ) {
        return {
          ok: true,
          familyId: row.id,
          accountId: row.accountId,
          tenantId: row.tenantId,
          deviceId: row.deviceId,
          sessionId: row.sessionId,
          generation: row.generation,
          replacementTokenDigest: row.currentTokenDigest,
          replacementAccessTokenDigest: row.lastReplacementAccessTokenDigest ?? '',
          idempotent: true,
        }
      }
      if (row.expiresAt.getTime() <= input.now) {
        return { ok: false, code: REFRESH_ROTATION_CODE.EXPIRED, familyCompromised: false }
      }
      if (row.currentTokenDigest !== input.presentedTokenDigest) {
        await transaction.query(REVOKE_REFRESH_FAMILY_SQL, [new Date(input.now), row.id])
        await transaction.query(REVOKE_DEVICE_SESSIONS_SQL, [
          new Date(input.now),
          row.accountId,
          row.deviceId,
        ])
        await this.options.outbox.append(transaction, compromiseEvent(row, input.now))
        return { ok: false, code: REFRESH_ROTATION_CODE.REPLAY, familyCompromised: true }
      }

      const updated = await transaction.query<RefreshFamilyRow>(UPDATE_REFRESH_FAMILY_SQL, [
        input.replacementTokenDigest,
        input.presentedTokenDigest,
        new Date(input.now),
        row.id,
        input.idempotencyKey,
        input.presentedTokenDigest,
        input.replacementAccessTokenDigest,
      ])
      const result = updated.rows[0]
      if (!result) return { ok: false, code: REFRESH_ROTATION_CODE.REPLAY, familyCompromised: true }
      await this.options.outbox.append(transaction, rotationEvent(result, input.now))
      return {
        ok: true,
        familyId: result.id,
        accountId: result.accountId,
        tenantId: result.tenantId,
        deviceId: result.deviceId,
        sessionId: result.sessionId,
        generation: result.generation,
        replacementTokenDigest: input.replacementTokenDigest,
        replacementAccessTokenDigest: input.replacementAccessTokenDigest,
        idempotent: false,
      }
    })
  }

  async revokeFamily(familyId: string, revokedAt: number): Promise<void> {
    await this.options.client.transaction(async (transaction) => {
      await transaction.query(REVOKE_REFRESH_FAMILY_SQL, [new Date(revokedAt), familyId])
    })
  }

  exportState(): RefreshRotationSnapshot {
    throw new Error('PostgreSQL refresh rotation state is durable and cannot be exported')
  }
}

function rotationEvent(row: RefreshFamilyRow, now: number): RefreshOutboxEvent {
  return {
    contractVersion: '1.0.0',
    type: REFRESH_OUTBOX_EVENT_TYPE.ROTATED,
    aggregateType: 'refresh_token_family',
    aggregateId: row.id,
    occurredAt: new Date(now).toISOString(),
    payload: {
      accountId: row.accountId,
      tenantId: row.tenantId,
      deviceId: row.deviceId,
      sessionId: row.sessionId,
      generation: row.generation,
    },
  }
}

function compromiseEvent(row: RefreshFamilyRow, now: number): RefreshOutboxEvent {
  return {
    ...rotationEvent(row, now),
    type: REFRESH_OUTBOX_EVENT_TYPE.FAMILY_COMPROMISED,
  }
}

export class PostgresSessionRevocationAdapter implements SessionRevocationPort {
  private readonly client: SqlClient

  constructor(client: SqlClient) {
    this.client = client
  }

  async revokeDeviceSessions(
    accountId: string,
    deviceId: string,
    revokedAt: number
  ): Promise<void> {
    await this.client.transaction(async (transaction) => {
      await transaction.query(REVOKE_DEVICE_SESSIONS_SQL, [
        new Date(revokedAt),
        accountId,
        deviceId,
      ])
    })
  }

  snapshot() {
    return []
  }

  restore(): void {}
}

export class DirectOutboxPort implements OutboxPort {
  private readonly writer: TransactionalOutboxWriter
  private readonly client: SqlClient

  constructor(writer: TransactionalOutboxWriter, client: SqlClient) {
    this.writer = writer
    this.client = client
  }

  async append(event: RefreshOutboxEvent): Promise<void> {
    await this.client.transaction((transaction) => this.writer.append(transaction, event))
  }
}
