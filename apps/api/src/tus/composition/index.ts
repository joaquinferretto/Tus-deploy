import {
  InMemoryTusAuditStore,
  InMemoryTusCommitmentStore,
  InMemoryTusCompensationStore,
  InMemoryTusIdempotencyStore,
  InMemoryTusOutboxStore,
  InMemoryTusSessionResolver,
  InMemoryTusTransaction,
} from '../adapters/in-memory.ts'
import { TusApplicationService, type TusApplicationDependencies } from '../application/tus-application-service.ts'
import { InMemoryMarketplaceStore, TusMarketplaceService } from '../catalog/index.ts'
import { InMemoryServiceCalendarStore, ServiceCalendarService } from '../calendar/index.ts'
import {
  PrismaTusAuditStore,
  PrismaTusCommitmentStore,
  PrismaTusCompensationStore,
  PrismaTusIdempotencyStore,
  PrismaTusOutboxStore,
  PrismaTusTransaction,
  type TusPrismaClient,
  PrismaTusReadinessEvidenceStore,
} from '../adapters/prisma.ts'
import { PrismaMarketplaceStore } from '../adapters/prisma-marketplace.ts'
import { PrismaServiceCalendarStore } from '../adapters/prisma-calendar.ts'
import {
  DeterministicMercadoPagoFinanceProvider,
  InMemoryFinanceStore,
  TusFinanceService,
  UnavailableMercadoPagoFinanceProvider,
} from '../finance/index.ts'
import { PrismaTusFinanceStore, type PrismaFinanceClient } from '../finance/prisma.ts'
import { InMemoryDeliveryStore, TusDeliveryService } from '../delivery/index.ts'
import { InMemoryPosStore, TusPosService } from '../pos/index.ts'
import { PrismaDeliveryStore, PrismaPosStore } from '../adapters/delivery-pos.ts'
import { InMemorySupportStore, PrismaSupportStore, TusSupportService } from '../support/index.ts'
import { InMemoryWhatsAppActionStore, PrismaWhatsAppActionStore, TusWhatsAppService } from '../whatsapp/index.ts'
import { InMemoryReportingStore, PrismaReportingStore, TusReportingService } from '../reporting/index.ts'
import { TusReadinessGuard } from '../readiness/index.ts'

export function createTusApplication(
  options: Pick<TusApplicationDependencies, 'now' | 'releasePolicy' | 'operationsTelemetry' | 'readinessGuard' | 'readinessProfile' | 'readinessScope'> = {},
): TusApplicationService {
  const commitments = new InMemoryTusCommitmentStore()
  const compensations = new InMemoryTusCompensationStore()
  const audits = new InMemoryTusAuditStore()
  const idempotency = new InMemoryTusIdempotencyStore()
  const outbox = new InMemoryTusOutboxStore()
  const marketplace = new TusMarketplaceService(new InMemoryMarketplaceStore(), {
    readinessGuard: options.readinessGuard,
    readinessProfile: options.readinessProfile,
    readinessScope: options.readinessScope,
  })
  const calendar = new ServiceCalendarService(new InMemoryServiceCalendarStore(), options.now)
  const commitmentLookup = async (commitmentId: string) => (await commitments.find(commitmentId)) ?? marketplace.store.commitments.find(commitmentId)
  const finance = new TusFinanceService({
    store: new InMemoryFinanceStore(),
    provider: new DeterministicMercadoPagoFinanceProvider(),
    commitmentLookup,
    ...options,
  })
  const delivery = new TusDeliveryService({
    store: new InMemoryDeliveryStore(),
    commitmentLookup,
    now: options.now,
    readinessGuard: options.readinessGuard,
    readinessProfile: options.readinessProfile,
    readinessScope: options.readinessScope,
  })
  const pos = new TusPosService({ store: new InMemoryPosStore(), now: options.now, readinessGuard: options.readinessGuard, readinessProfile: options.readinessProfile, readinessScope: options.readinessScope })
  const support = new TusSupportService({ store: new InMemorySupportStore(), commitmentLookup, now: options.now, telemetry: options.operationsTelemetry, readinessGuard: options.readinessGuard, readinessProfile: options.readinessProfile, readinessScope: options.readinessScope })
  const whatsapp = new TusWhatsAppService({ store: new InMemoryWhatsAppActionStore(), now: options.now, telemetry: options.operationsTelemetry, readinessGuard: options.readinessGuard, readinessProfile: options.readinessProfile, readinessScope: options.readinessScope })
  const reporting = new TusReportingService({ store: new InMemoryReportingStore(), now: options.now, telemetry: options.operationsTelemetry })
  return new TusApplicationService({
    commitments,
    audits,
    idempotency,
    outbox,
    compensations,
    transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }),
    marketplace,
    calendar,
    finance,
    delivery,
    pos,
    support,
    whatsapp,
    reporting,
    ...options,
  })
}

export function createPrismaTusApplication(client: TusPrismaClient): TusApplicationService {
  const readinessGuard = new TusReadinessGuard(new PrismaTusReadinessEvidenceStore(client))
  const marketplace = createPrismaMarketplaceService(client, readinessGuard)
  const calendar = new ServiceCalendarService(new PrismaServiceCalendarStore(client))
  const commitmentStore = new PrismaTusCommitmentStore(client)
  const commitmentLookup = async (commitmentId: string) => (await commitmentStore.find(commitmentId)) ?? marketplace.store.commitments.find(commitmentId)
  const delivery = new TusDeliveryService({
    store: new PrismaDeliveryStore(client),
    commitmentLookup,
    readinessGuard,
  })
  const pos = new TusPosService({ store: new PrismaPosStore(client), readinessGuard })
  const support = new TusSupportService({ store: new PrismaSupportStore(client as never), commitmentLookup, readinessGuard })
  const whatsapp = new TusWhatsAppService({ store: new PrismaWhatsAppActionStore(client as never), readinessGuard })
  const reporting = new TusReportingService({ store: new PrismaReportingStore(client as never) })
  return new TusApplicationService({
    commitments: commitmentStore,
    compensations: new PrismaTusCompensationStore(client),
    audits: new PrismaTusAuditStore(client),
    idempotency: new PrismaTusIdempotencyStore(client),
    outbox: new PrismaTusOutboxStore(client),
    transaction: new PrismaTusTransaction(client),
    marketplace,
    calendar,
    finance: new TusFinanceService({
      store: new PrismaTusFinanceStore(client as unknown as PrismaFinanceClient),
      provider: new UnavailableMercadoPagoFinanceProvider(),
      commitmentLookup,
      readinessGuard,
    }),
    delivery,
    pos,
    support,
    whatsapp,
    reporting,
    readinessGuard,
    readinessProfile: 'native-local',
    readinessScope: 'argentina-stage-1',
  })
}

function createPrismaMarketplaceService(client: TusPrismaClient, readinessGuard?: TusReadinessGuard): TusMarketplaceService {
  return new TusMarketplaceService(new PrismaMarketplaceStore(client), { readinessGuard })
}

export * from '../application/index.ts'
export * from '../ports/index.ts'
export * from '../adapters/index.ts'
export { InMemoryTusSessionResolver } from '../adapters/in-memory.ts'
export * from '../adapters/prisma.ts'

export default { createPrismaTusApplication, createTusApplication }
