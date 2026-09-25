import { createHash } from 'node:crypto'
import type { OAuthTransaction } from '../../oauth-oidc/domain.js'
import type { OAuthTransactionStore } from '../../oauth-oidc/ports.js'
import type { FederatedIdentity, LoginCode } from '../domain.js'
import type { FederatedIdentityStore, LoginCodeStore } from '../ports.js'

const unique = () => Object.assign(new Error('unique violation'), { code: 'P2002' })
const replayed = () => Object.assign(new Error('oauth state already consumed'), { code: 'OAUTH_REPLAYED' })

// ---- in memory (tests and local composition) -----------------------------------------------

export class InMemoryFederatedIdentityStore implements FederatedIdentityStore {
  readonly identities = new Map<string, FederatedIdentity>()

  async find(providerId: string, issuer: string, subject: string) {
    const found = [...this.identities.values()].find((item) => item.providerId === providerId && item.issuer === issuer && item.subject === subject)
    return found ? { ...found } : undefined
  }

  async save(identity: FederatedIdentity) {
    if (await this.find(identity.providerId, identity.issuer, identity.subject)) throw unique()
    this.identities.set(identity.id, { ...identity })
  }

  async listForAccount(accountId: string) {
    return [...this.identities.values()].filter((item) => item.accountId === accountId).map((item) => ({ ...item }))
  }
}

export class InMemoryLoginCodeStore implements LoginCodeStore {
  readonly codes = new Map<string, LoginCode>()

  async save(code: LoginCode) {
    this.codes.set(code.codeHash, structuredClone(code))
  }

  async peek(codeHash: string, now: number) {
    const code = this.codes.get(codeHash)
    return code && code.usedAt === null && code.expiresAt > now ? structuredClone(code) : undefined
  }

  async consume(codeHash: string, now: number) {
    const code = this.codes.get(codeHash)
    if (!code || code.usedAt !== null || code.expiresAt <= now) return undefined
    code.usedAt = now
    return structuredClone(code)
  }
}

// ---- PostgreSQL ------------------------------------------------------------------------------

type Row = Record<string, unknown>

interface Delegate {
  findFirst(input: { where: Row }): Promise<Row | null>
  findMany(input: { where: Row }): Promise<Row[]>
  create(input: { data: Row }): Promise<Row>
  updateMany(input: { where: Row; data: Row }): Promise<{ count: number }>
}

export interface FederatedPrismaClient {
  identidadExterna: Delegate
  transaccionOAuth: Delegate
  codigoIngresoOAuth: Delegate
}

const ms = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value))

export class PrismaFederatedIdentityStore implements FederatedIdentityStore {
  constructor(private readonly client: FederatedPrismaClient) {}

  private map(row: Row): FederatedIdentity {
    return {
      id: String(row['id']),
      accountId: String(row['cuentaId']),
      providerId: String(row['proveedor']),
      issuer: String(row['emisor']),
      subject: String(row['sujeto']),
      email: row['email'] === null || row['email'] === undefined ? null : String(row['email']),
      linkedAt: ms(row['vinculadaEn']),
    }
  }

  async find(providerId: string, issuer: string, subject: string) {
    const row = await this.client.identidadExterna.findFirst({ where: { proveedor: providerId, emisor: issuer, sujeto: subject } })
    return row ? this.map(row) : undefined
  }

  async save(identity: FederatedIdentity) {
    await this.client.identidadExterna.create({
      data: { id: identity.id, cuentaId: identity.accountId, proveedor: identity.providerId, emisor: identity.issuer, sujeto: identity.subject, email: identity.email, vinculadaEn: new Date(identity.linkedAt) },
    })
  }

  async listForAccount(accountId: string) {
    return (await this.client.identidadExterna.findMany({ where: { cuentaId: accountId } })).map((row) => this.map(row))
  }
}

export class PrismaLoginCodeStore implements LoginCodeStore {
  constructor(private readonly client: FederatedPrismaClient) {}

  private map(row: Row): LoginCode {
    return {
      id: String(row['id']),
      codeHash: String(row['hashCodigo']),
      kind: String(row['tipo']) as LoginCode['kind'],
      payload: (row['datos'] as LoginCode['payload']) ?? {},
      expiresAt: ms(row['expiraEn']),
      usedAt: row['usadoEn'] ? ms(row['usadoEn']) : null,
    }
  }

  async save(code: LoginCode) {
    await this.client.codigoIngresoOAuth.create({
      data: { id: code.id, hashCodigo: code.codeHash, tipo: code.kind, datos: code.payload, expiraEn: new Date(code.expiresAt), usadoEn: null },
    })
  }

  async peek(codeHash: string, now: number) {
    const row = await this.client.codigoIngresoOAuth.findFirst({ where: { hashCodigo: codeHash, usadoEn: null, expiraEn: { gt: new Date(now) } } })
    return row ? this.map(row) : undefined
  }

  async consume(codeHash: string, now: number) {
    const current = await this.peek(codeHash, now)
    if (!current) return undefined
    const claimed = await this.client.codigoIngresoOAuth.updateMany({ where: { hashCodigo: codeHash, usadoEn: null, expiraEn: { gt: new Date(now) } }, data: { usadoEn: new Date(now) } })
    return claimed.count === 1 ? { ...current, usedAt: now } : undefined
  }
}

// Durable OAuth transactions (several API instances). Only a hash of `state` is stored and the
// consumption is conditional, so a replayed callback cannot run twice.
export class PrismaOAuthTransactionStore implements OAuthTransactionStore {
  readonly transactions = new Map<string, OAuthTransaction>()

  constructor(private readonly client: FederatedPrismaClient) {}

  private hash(state: string) {
    return createHash('sha256').update(`tus-oauth-state:${state}`).digest('hex')
  }

  async save(transaction: OAuthTransaction) {
    const stateHash = this.hash(transaction.state)
    if (transaction.consumedAt !== null) {
      const claimed = await this.client.transaccionOAuth.updateMany({ where: { hashState: stateHash, consumidaEn: null }, data: { consumidaEn: new Date(transaction.consumedAt) } })
      if (claimed.count !== 1) throw replayed()
      return
    }
    await this.client.transaccionOAuth.create({
      data: { id: transaction.id, proveedor: transaction.providerId, hashState: stateHash, nonce: transaction.nonce, codeVerifier: transaction.codeVerifier, redirectUri: transaction.redirectUri, expiraEn: new Date(transaction.expiresAt), consumidaEn: null },
    })
  }

  async find(state: string) {
    const row = await this.client.transaccionOAuth.findFirst({ where: { hashState: this.hash(state) } })
    if (!row) return undefined
    return {
      id: String(row['id']),
      providerId: String(row['proveedor']),
      state,
      nonce: String(row['nonce']),
      codeVerifier: String(row['codeVerifier']),
      redirectUri: String(row['redirectUri']),
      expiresAt: ms(row['expiraEn']),
      consumedAt: row['consumidaEn'] ? ms(row['consumidaEn']) : null,
    }
  }
}
