import {
  AlmacenReferenciasAuditoriaEnMemoria,
  InMemoryTusCommitmentStore,
  InMemoryTusCompensationStore,
  InMemoryTusIdempotencyStore,
  InMemoryTusOutboxStore,
  InMemoryTusSessionResolver,
  InMemoryTusTransaction,
} from '../adapters/in-memory.ts'
import { InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoStore, InMemoryTrabajoTransaction, ReservasTrabajoEnMemoria, ServicioTrabajo, type PuertoPagosTrabajo } from '../work/index.ts'
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
import { TransaccionFinanzasServicioPrisma, confirmarReservaPorPagoPrisma, type ClientePrismaFinanzasServicio } from '../adapters/prisma-finanzas-servicios.ts'
import { AlmacenConfiguracionPagosEnMemoria } from '../finance/servicios/configuracion.ts'
import { AlmacenCuentasCobroEnMemoria } from '../finance/servicios/cuentas-cobro.ts'
import { crearModuloPagosServicio } from '../finance/servicios/composicion-pagos.ts'
import { ALCANCE_PAGOS_SERVICIO, crearHabilitacionPagosServicio } from '../finance/servicios/habilitacion-pagos.ts'
import { ServicioEvidenciasHabilitacion } from '../readiness/evidencias-admin.ts'
import { AlmacenAdminEvidenciasPrisma, type ClientePrismaEvidenciasHabilitacion } from '../adapters/prisma-evidencias-habilitacion.ts'
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
import { montoSenaReserva } from '../finance/servicios/modelo.ts'

export interface TusApplicationFactoryOptions
  extends Pick<TusApplicationDependencies, 'now' | 'releasePolicy' | 'operationsTelemetry' | 'evaluadorHabilitacion' | 'perfilHabilitacion' | 'alcanceHabilitacion' | 'identity'> {
  whatsappAuthorizedSenders?: Readonly<Record<string, readonly string[]>>
  whatsappAuthorizeSender?: (tenantId: string, senderId: string) => boolean | Promise<boolean>
}

export function createTusApplication(
  // `identity` (optional here) turns on the IDENTITY-NOSIS provider gates in memory as well.
  options: TusApplicationFactoryOptions = {},
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
  const whatsapp = new TusWhatsAppService({ store: new InMemoryWhatsAppActionStore(), now: options.now, telemetry: options.operationsTelemetry, evaluadorHabilitacion: options.evaluadorHabilitacion, perfilHabilitacion: options.perfilHabilitacion, alcanceHabilitacion: options.alcanceHabilitacion, authorizedSenders: options.whatsappAuthorizedSenders, authorizeSender: options.whatsappAuthorizeSender })
  const reporting = new TusReportingService({ store: new InMemoryReportingStore(), now: options.now, telemetry: options.operationsTelemetry })
  const workIdempotency = new InMemoryTrabajoIdempotencyStore()
  const workOutbox = new InMemoryTrabajoOutboxStore()
  const work = new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: workStore, idempotency: workIdempotency, outbox: workOutbox, reservations: new ReservasTrabajoEnMemoria((ownerTenantId, reservationId) => calendar.findBookingForProvider(ownerTenantId, reservationId), async (ownerTenantId, reservationId, updatedAt) => {
    const booking = await calendarStore.bookings.find(reservationId)
    if (!booking || booking.ownerTenantId !== ownerTenantId || booking.status !== 'confirmed') return false
    await calendarStore.bookings.save({ ...booking, status: 'cancelled', version: booking.version + 1, updatedAt })
    return true
  }, async (ownerTenantId, reservationId, updatedAt) => {
    // TURNOS-SOLICITUD-01: the provider accepted the work of a request still waiting.
    const booking = await calendarStore.bookings.find(reservationId)
    if (!booking || booking.ownerTenantId !== ownerTenantId || booking.status !== 'pending') return false
    await calendarStore.bookings.save({ ...booking, status: 'confirmed', version: booking.version + 1, updatedAt })
    return true
  }) }, reservationSerializer), options.now)
  // In-memory composition never reads process.env: payments stay unavailable unless a test
  // injects its own module. The preview still works.
  const servicePayments = crearModuloPagosServicio({ env: {}, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria(), now: options.now, identidadVerificada })
  const serviceFinance = new ServicioFinanzasServicios(
    new TransaccionFinanzasServicioEnMemoria(new AlmacenFinanzasServicioEnMemoria(), new IdentidadServicioEnMemoria(workStore, marketplaceStore), {
      completarPorPagoFinal: (input) => work.completarPorPagoFinal({ work: workStore, outbox: workOutbox }, input),
      confirmarReservaPorPago: async (input) => {
        const currentTime = options.now?.() ?? Date.now()
        const booking = await calendarStore.bookings.find(input.reservaId)
        const expiresAt = Date.parse(booking?.requestExpiresAt ?? '')
        if (
          !booking ||
          booking.status !== 'awaiting_payment' ||
          booking.ownerTenantId !== input.prestadorTenantId ||
          booking.tenantId !== input.clienteTenantId ||
          !Number.isFinite(expiresAt) ||
          expiresAt <= currentTime
        ) return false
        const currency = booking.moneda ?? booking.priceSnapshot?.currency
        const expected = booking.precioFinal && currency ? montoSenaReserva(booking.precioFinal, currency) : undefined
        if (currency !== input.currency || expected !== input.amountMinor) return false
        const updatedAt = new Date(currentTime).toISOString()
        await calendarStore.bookings.save({ ...booking, status: 'confirmed', requestExpiresAt: undefined, version: booking.version + 1, updatedAt })
        return true
      },
    }),
    options.now,
    servicePayments.proveedor,
    undefined,
    servicePayments.politica
  )
  work.conPagos(pagosTrabajo(serviceFinance))
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
  // WEB-09E: real money in production also needs the evidence-based readiness decision of the
  // `service-payments` capability (not `settlement`, the gate of the general marketplace); a
  // blocked or failing evaluation keeps payments unavailable.
  const perfilPagos = PERFILES_HABILITACION.find((perfil) => perfil === env['TUS_DEPLOYMENT_PROFILE']) ?? 'render-native'
  const tenantPlataforma = env['TUS_PLATFORM_ADMIN_TENANT_ID']?.trim() || 'tus-platform'
  const habilitacionPagos = crearHabilitacionPagosServicio(evaluadorHabilitacion, { tenantId: tenantPlataforma, profile: perfilPagos })
  // The registry writes for the same tenant, profile and scope that decision is evaluated for.
  const readinessEvidence = new ServicioEvidenciasHabilitacion(new AlmacenAdminEvidenciasPrisma(client as unknown as ClientePrismaEvidenciasHabilitacion), { tenantId: tenantPlataforma, profile: perfilPagos, scope: ALCANCE_PAGOS_SERVICIO })
  const servicePayments = crearModuloPagosServicio({ env, configuracion: new ConfiguracionPagosPrisma(paymentsClient), cuentas: new CuentasCobroPrisma(paymentsClient), produccionAutorizada: habilitacionPagos.autorizada, habilitaciones: habilitacionPagos.estado, identidadVerificada })
  // The provider is Mercado Pago only when every variable is present; otherwise unavailable.
  // The approved balance of a request-born work completes it with the SAME transactional client.
  const serviceFinance = new ServicioFinanzasServicios(
    new TransaccionFinanzasServicioPrisma(client as unknown as ClientePrismaFinanzasServicio, (tx) => ({
      completarPorPagoFinal: (input) => work.completarPorPagoFinal({ work: new PrismaTrabajoStore(tx as unknown as TusPrismaClient), outbox: new PrismaTrabajoOutboxStore(tx as unknown as TusPrismaClient) }, input),
      confirmarReservaPorPago: (input) => confirmarReservaPorPagoPrisma(tx, input),
    })),
    () => Date.now(),
    servicePayments.proveedor,
    undefined,
    servicePayments.politica
  )
  work.conPagos(pagosTrabajo(serviceFinance))
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
    readinessEvidence,
    identity,
    evaluadorHabilitacion,
    perfilHabilitacion: 'native-local',
    alcanceHabilitacion: 'argentina-stage-1',
  })
}

// Deposit gate / finish mode of request-born works, read from the finance module.
export function pagosTrabajo(finance: ServicioFinanzasServicios): PuertoPagosTrabajo {
  return {
    async estado(work) {
      const estado = await finance.estadoPagosTrabajo(work)
      return estado ? { required: estado.required, online: estado.online, depositPaid: estado.deposit.status === 'paid' } : null
    },
  }
}

export * from '../application/index.ts'
export * from '../ports/index.ts'
export * from '../adapters/index.ts'
export { InMemoryTusSessionResolver } from '../adapters/in-memory.ts'
export * from '../adapters/prisma.ts'
export * from '../work/index.ts'

export default { createPrismaTusApplication, createTusApplication }
