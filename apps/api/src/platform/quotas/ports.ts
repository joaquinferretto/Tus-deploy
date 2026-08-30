import type {
  QuotaContext,
  QuotaPolicy,
  QuotaPolicyInput,
  QuotaReservation,
  UsageSnapshot,
} from './domain.js'

export interface QuotaPolicyStore {
  save(policy: QuotaPolicy): Promise<void>
  history(scopeKey: string): Promise<QuotaPolicy[]>
  find(scopeKey: string, version: number): Promise<QuotaPolicy | undefined>
  active(scopeKey: string): Promise<QuotaPolicy | undefined>
  activate(scopeKey: string, version: number): Promise<void>
  resolve(context: QuotaContext, resource: string): Promise<QuotaPolicy | undefined>
}

export interface QuotaLedgerStore {
  findUsage(key: string): Promise<UsageSnapshot | undefined>
  saveUsage(snapshot: UsageSnapshot): Promise<void>
  findReservation(reservationId: string): Promise<QuotaReservation | undefined>
  saveReservation(reservation: QuotaReservation): Promise<void>
}

export interface QuotaClock {
  now(): number
}

export interface QuotaIdGenerator {
  next(prefix: string): string
}

export interface QuotaProviderUsage {
  tenantId: string
  resource: string
  units: number
  costUnits: number
}

export interface QuotaProviderPort {
  record(input: QuotaProviderUsage): Promise<void>
}

export interface QuotaServiceDependencies {
  policies: QuotaPolicyStore
  ledger: QuotaLedgerStore
  clock: QuotaClock
  ids: QuotaIdGenerator
}

export interface PublishQuotaPolicyInput extends QuotaPolicyInput {}

export interface ResolveQuotaPolicyInput {
  context: QuotaContext
  resource: string
}

export interface ReserveQuotaInput {
  context: QuotaContext
  resource: string
  unit?: UsageSnapshot['unit']
  units: number
  costUnits: number
  now?: number
}

export interface ReservationActionInput {
  context: QuotaContext
  reservationId: string
  now?: number
}

export interface UsageQueryInput {
  context: QuotaContext
  resource: string
  now?: number
}

export type QuotaReservationInput = ReserveQuotaInput
export type QuotaReservationAction = ReservationActionInput

export interface QuotaServiceOptions {
  reservationTtlMs?: number
}
