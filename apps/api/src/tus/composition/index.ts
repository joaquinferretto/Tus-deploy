import {
  AlmacenReferenciasAuditoriaEnMemoria,
  InMemoryTusCommitmentStore,
  InMemoryTusCompensationStore,
  InMemoryTusIdempotencyStore,
  InMemoryTusOutboxStore,
  InMemoryTusSessionResolver,
  InMemoryTusTransaction,
} from '../adapters/in-memory.ts'
import { InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoStore, InMemoryTrabajoTransaction, ReservasTrabajoEnMemoria, ServicioTrabajo } from '../work/index.ts'
import { TusApplicationService, type TusApplicationDependencies } from '../application/tus-application-service.ts'
import { InMemoryMarketplaceStore, TusMarketplaceService } from '../catalog/index.ts'
import { InMemoryServiceCalendarStore, ServiceCalendarService } from '../calendar/index.ts'
import { SerializadorEnMemoria } from '../domain/serializador-en-memoria.ts'
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
import { ServicioFinanzasServicios } from '../finance/servicios/servicio.ts'
import { AlmacenFinanzasServicioEnMemoria, IdentidadServicioEnMemoria, TransaccionFinanzasServicioEnMemoria } from '../finance/servicios/memoria.ts'
import { TransaccionFinanzasServicioPrisma, type ClientePrismaFinanzasServicio } from '../adapters/prisma-finanzas-servicios.ts'
import { AlmacenConfiguracionPagosEnMemoria } from '../finance/servicios/configuracion.ts'
import { AlmacenCuentasCobroEnMemoria } from '../finance/servicios/cuentas-cobro.ts'
import { crearModuloPagosServicio } from '../finance/servicios/composicion-pagos.ts'
import { ConfiguracionPagosPrisma, CuentasCobroPrisma, type ClientePrismaConfiguracionPagos } from '../adapters/prisma-configuracion-pagos.ts'
import { InMemoryDeliveryStore, TusDeliveryService } from '../delivery/index.ts'
import { InMemoryPosStore, TusPosService } from '../pos/index.ts'
import { PrismaDeliveryStore, PrismaPosStore } from '../adapters/delivery-pos.ts'
import { InMemorySupportStore, PrismaSupportStore, TusSupportService } from '../support/index.ts'
import { InMemoryWhatsAppActionStore, PrismaWhatsAppActionStore, TusWhatsAppService } from '../whatsapp/index.ts'
import { InMemoryReportingStore, PrismaReportingStore, TusReportingService } from '../reporting/index.ts'
import { EvaluadorHabilitacion, PERFILES_HABILITACION } from '../readiness/index.ts'
import type { ServicioVerificacionIdentidad } from '../identidad/servicio.ts'
import { crearServicioIdentidad } from '../identidad/composicion.ts'
import { TransaccionIdentidadPrisma, type ClientePrismaIdentidad } from '../adapters/prisma-identidad.ts'

export function createTusApplication(
  // `identity` (optional here) turns on the IDENTITY-NOSIS provider gates in memory as well.
  options: Pick<TusApplicationDependencies, 'now' | 'releasePolicy' | 'operationsTelemetry' | 'evaluadorHabilitacion' | 'perfilHabilitacion' | 'alcanceHabilitacion' | 'identity'> = {},
): TusApplicationService {
  const identidadVerificada = options.identity ? (tenantId: string) => options.identity!.identidadVerificada(tenantId) : undefined
  const commitments = new InMemoryTusCommitmentStore()
  const compensations = new InMemoryTusCompensationStore()
  const audits = new AlmacenReferenciasAuditoriaEnMemoria()
  const idempotency = new InMemoryTusIdempotencyStore()
  const outbox = new InMemoryTusOutboxStore()
  const marketplaceStore = new InMemoryMarketplaceStore()
  // WEB-08I: Trabajo y calendario comparten un serializador en memoria y el vinculo reserva-trabajo.
  const reservationSerializer = new SerializadorEnMemoria()
  const workStore = new InMemoryTrabajoStore()
  const calendarStore = new InMemoryServiceCalendarStore({
    serializer: reservationSerializer,
    linkedWorkId: async (ownerTenantId, bookingId) => (await workStore.findByReservation({ prestadorTenantId: ownerTenantId, reservationId: bookingId }))?.trabajoId ?? null,
  })
  const calendar = new ServiceCalendarService(calendarStore, options.now)
  const marketplace = new TusMarketplaceService(marketplaceStore, {
    evaluadorHabilitacion: options.evaluadorHabilitacion,
    perfilHabilitacion: options.perfilHabilitacion,
    alcanceHabilitacion: options.alcanceHabilitacion,
    calendarResolver: calendar,
    identidadVerificada,
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
  const workIdempotency = new InMemoryTrabajoIdempotencyStore()
  const workOutbox = new InMemoryTrabajoOutboxStore()
  const work = new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: workStore, idempotency: workIdempotency, outbox: workOutbox, reservations: new ReservasTrabajoEnMemoria((ownerTenantId, reservationId) => calendar.findBookingForProvider(ownerTenantId, reservationId), async (ownerTenantId, reservationId, updatedAt) => {
    const booking = await calendarStore.bookings.find(reservationId)
    if (!booking || booking.ownerTenantId !== ownerTenantId || booking.status !== 'confirmed') return false
    await calendarStore.bookings.save({ ...booking, status: 'cancelled', version: booking.version + 1, updatedAt })
    return true
  }) }, reservationSerializer), options.now)
  // In-memory composition never reads process.env: payments stay unavailable unless a test
  // injects its own module. The preview still works.
  const servicePayments = crearModuloPagosServicio({ env: {}, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria(), now: options.now, identidadVerificada })
  const serviceFinance = new ServicioFinanzasServicios(
    new TransaccionFinanzasServicioEnMemoria(new AlmacenFinanzasServicioEnMemoria(), new IdentidadServicioEnMemoria(workStore, marketplaceStore)),
    options.now,
    servicePayments.proveedor,
    undefined,
    servicePayments.politica
  )
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
    serviceFinance,
    servicePayments,
    ...options,
  })
}

export function createPrismaTusApplication(client: TusPrismaClient, env: Record<string, string | undefined> = process.env): TusApplicationService {
  const evaluadorHabilitacion = new EvaluadorHabilitacion(new AlmacenPrismaEvidenciaHabilitacion(client))
  const marketplaceStore = new PrismaMarketplaceStore(client)
  const calendar = new ServiceCalendarService(new PrismaServiceCalendarStore(client))
  // IDENTITY-NOSIS: always enforced with PostgreSQL. Until a provider is verified it cannot
  // publish services, accept work, link Mercado Pago or receive payments.
  const identity: ServicioVerificacionIdentidad = crearServicioIdentidad({ transaction: new TransaccionIdentidadPrisma(client as unknown as ClientePrismaIdentidad), env })
  const identidadVerificada = (tenantId: string) => identity.identidadVerificada(tenantId)
  const marketplace = new TusMarketplaceService(marketplaceStore, { evaluadorHabilitacion, calendarResolver: calendar, identidadVerificada })
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
  const paymentsClient = client as unknown as ClientePrismaConfiguracionPagos
  // WEB-09E: real money in production also needs the evidence-based `settlement` readiness
  // decision; a blocked or failing evaluation keeps payments unavailable.
  const perfilPagos = PERFILES_HABILITACION.find((perfil) => perfil === env['TUS_DEPLOYMENT_PROFILE']) ?? 'render-native'
  const produccionAutorizada = async () => {
    try {
      const decision = await evaluadorHabilitacion.require({ tenantId: env['TUS_PLATFORM_ADMIN_TENANT_ID']?.trim() || 'tus-platform', actorId: 'system:service-payments', correlationId: `service-payments-readiness-${Date.now()}`, capability: 'settlement', profile: perfilPagos, scope: 'argentina-stage-1' })
      return decision.enabled && decision.disposition === 'authorized'
    } catch {
      return false
    }
  }
  const servicePayments = crearModuloPagosServicio({ env, configuracion: new ConfiguracionPagosPrisma(paymentsClient), cuentas: new CuentasCobroPrisma(paymentsClient), produccionAutorizada, identidadVerificada })
  // The provider is Mercado Pago only when every variable is present; otherwise unavailable.
  const serviceFinance = new ServicioFinanzasServicios(new TransaccionFinanzasServicioPrisma(client as unknown as ClientePrismaFinanzasServicio), () => Date.now(), servicePayments.proveedor, undefined, servicePayments.politica)
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
    serviceFinance,
    servicePayments,
    identity,
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
