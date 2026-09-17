import {
  AlmacenReferenciasAuditoriaEnMemoria,
  InMemoryTusCommitmentStore,
  InMemoryTusCompensationStore,
  InMemoryTusIdempotencyStore,
  InMemoryTusOutboxStore,
  InMemoryTusSessionResolver,
  InMemoryTusTransaction,
} from '../adapters/in-memory.ts'
import { InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoStore, InMemoryTrabajoTransaction, ServicioTrabajo } from '../work/index.ts'
import { TusApplicationService, type TusApplicationDependencies } from '../application/tus-application-service.ts'
import { InMemoryMarketplaceStore, TusMarketplaceService } from '../catalog/index.ts'
import { InMemoryServiceCalendarStore, ServiceCalendarService } from '../calendar/index.ts'
import {
  AlmacenPrismaReferenciasAuditoria,
  PrismaTusCommitmentStore,
  PrismaTusCompensationStore,
  PrismaTusIdempotencyStore,
  PrismaTusOutboxStore,
  PrismaTusTransaction,
  type TusPrismaClient,
  AlmacenPrismaEvidenciaHabilitacion,
} from '../adapters/prisma.ts'
import { PrismaTrabajoIdempotencyStore, PrismaTrabajoOutboxStore, PrismaTrabajoStore, PrismaTrabajoTransaction } from '../adapters/prisma-work.ts'
import { PrismaMarketplaceStore } from '../adapters/prisma-marketplace.ts'
import { PrismaServiceCalendarStore } from '../adapters/prisma-calendar.ts'
import {
  DeterministicMercadoPagoFinanceProvider,
  InMemoryFinanceStore,
  TusFinanceService,
  UnavailableMercadoPagoFinanceProvider,
} from '../finance/index.ts'
import { PrismaTusFinanceStore, type ClientePrismaFinanzas } from '../finance/prisma.ts'
import { InMemoryDeliveryStore, TusDeliveryService } from '../delivery/index.ts'
import { InMemoryPosStore, TusPosService } from '../pos/index.ts'
import { PrismaDeliveryStore, PrismaPosStore } from '../adapters/delivery-pos.ts'
import { InMemorySupportStore, PrismaSupportStore, TusSupportService } from '../support/index.ts'
import { InMemoryWhatsAppActionStore, PrismaWhatsAppActionStore, TusWhatsAppService } from '../whatsapp/index.ts'
import { InMemoryReportingStore, PrismaReportingStore, TusReportingService } from '../reporting/index.ts'
import { EvaluadorHabilitacion } from '../readiness/index.ts'

export function createTusApplication(
  options: Pick<TusApplicationDependencies, 'now' | 'releasePolicy' | 'operationsTelemetry' | 'evaluadorHabilitacion' | 'perfilHabilitacion' | 'alcanceHabilitacion'> = {},
): TusApplicationService {
  const commitments = new InMemoryTusCommitmentStore()
  const compensations = new InMemoryTusCompensationStore()
  const audits = new AlmacenReferenciasAuditoriaEnMemoria()
  const idempotency = new InMemoryTusIdempotencyStore()
  const outbox = new InMemoryTusOutboxStore()
  const marketplaceStore = new InMemoryMarketplaceStore()
  const calendar = new ServiceCalendarService(new InMemoryServiceCalendarStore(), options.now)
  const marketplace = new TusMarketplaceService(marketplaceStore, {
    evaluadorHabilitacion: options.evaluadorHabilitacion,
    perfilHabilitacion: options.perfilHabilitacion,
    alcanceHabilitacion: options.alcanceHabilitacion,
    calendarResolver: calendar,
  })
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
    evaluadorHabilitacion: options.evaluadorHabilitacion,
    perfilHabilitacion: options.perfilHabilitacion,
    alcanceHabilitacion: options.alcanceHabilitacion,
  })
  const pos = new TusPosService({ store: new InMemoryPosStore(), now: options.now, evaluadorHabilitacion: options.evaluadorHabilitacion, perfilHabilitacion: options.perfilHabilitacion, alcanceHabilitacion: options.alcanceHabilitacion })
  const support = new TusSupportService({ store: new InMemorySupportStore(), commitmentLookup, now: options.now, telemetry: options.operationsTelemetry, evaluadorHabilitacion: options.evaluadorHabilitacion, perfilHabilitacion: options.perfilHabilitacion, alcanceHabilitacion: options.alcanceHabilitacion })
  const whatsapp = new TusWhatsAppService({ store: new InMemoryWhatsAppActionStore(), now: options.now, telemetry: options.operationsTelemetry, evaluadorHabilitacion: options.evaluadorHabilitacion, perfilHabilitacion: options.perfilHabilitacion, alcanceHabilitacion: options.alcanceHabilitacion })
  const reporting = new TusReportingService({ store: new InMemoryReportingStore(), now: options.now, telemetry: options.operationsTelemetry })
  const workStore = new InMemoryTrabajoStore()
  const workIdempotency = new InMemoryTrabajoIdempotencyStore()
  const workOutbox = new InMemoryTrabajoOutboxStore()
  const work = new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: workStore, idempotency: workIdempotency, outbox: workOutbox }), options.now)
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
    work,
    ...options,
  })
}

export function createPrismaTusApplication(client: TusPrismaClient): TusApplicationService {
  const evaluadorHabilitacion = new EvaluadorHabilitacion(new AlmacenPrismaEvidenciaHabilitacion(client))
  const marketplaceStore = new PrismaMarketplaceStore(client)
  const calendar = new ServiceCalendarService(new PrismaServiceCalendarStore(client))
  const marketplace = new TusMarketplaceService(marketplaceStore, { evaluadorHabilitacion, calendarResolver: calendar })
  const commitmentStore = new PrismaTusCommitmentStore(client)
  const commitmentLookup = async (commitmentId: string) => (await commitmentStore.find(commitmentId)) ?? marketplace.store.commitments.find(commitmentId)
  const delivery = new TusDeliveryService({
    store: new PrismaDeliveryStore(client),
    commitmentLookup,
    evaluadorHabilitacion,
  })
  const pos = new TusPosService({ store: new PrismaPosStore(client), evaluadorHabilitacion })
  const support = new TusSupportService({ store: new PrismaSupportStore(client as never), commitmentLookup, evaluadorHabilitacion })
  const whatsapp = new TusWhatsAppService({ store: new PrismaWhatsAppActionStore(client as never), evaluadorHabilitacion })
  const reporting = new TusReportingService({ store: new PrismaReportingStore(client as never) })
  const work = new ServicioTrabajo(new PrismaTrabajoTransaction(client), () => Date.now())
  return new TusApplicationService({
    commitments: commitmentStore,
    compensations: new PrismaTusCompensationStore(client),
    audits: new AlmacenPrismaReferenciasAuditoria(client),
    idempotency: new PrismaTusIdempotencyStore(client),
    outbox: new PrismaTusOutboxStore(client),
    transaction: new PrismaTusTransaction(client),
    marketplace,
    calendar,
    finance: new TusFinanceService({
      store: new PrismaTusFinanceStore(client as unknown as ClientePrismaFinanzas),
      provider: new UnavailableMercadoPagoFinanceProvider(),
      commitmentLookup,
       evaluadorHabilitacion,
    }),
    delivery,
    pos,
    support,
    whatsapp,
    reporting,
    work,
    evaluadorHabilitacion,
    perfilHabilitacion: 'native-local',
    alcanceHabilitacion: 'argentina-stage-1',
  })
}

export * from '../application/index.ts'
export * from '../ports/index.ts'
export * from '../adapters/index.ts'
export { InMemoryTusSessionResolver } from '../adapters/in-memory.ts'
export * from '../adapters/prisma.ts'
export * from '../work/index.ts'

export default { createPrismaTusApplication, createTusApplication }
