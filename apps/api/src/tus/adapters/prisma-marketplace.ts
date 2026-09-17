import type { RegistroAuditoriaMercadoServicios, MarketplaceCheckoutResponse, MarketplaceCommitment, Publicacion, PerfilPrestador, MarketplaceOutboxRecord, MarketplaceStorePort } from '../catalog/index.ts'
import type { TusPrismaClient } from './prisma.ts'

export class PrismaMarketplaceStore implements MarketplaceStorePort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  readonly merchant = {
    save: async (profile: PerfilPrestador) => {
      await this.client.prestador.upsert({
        where: { tenantId: profile.tenantId },
        create: merchantRow(profile),
        update: merchantRow(profile),
      })
    },
    find: async (tenantId: string) => {
      const row = await this.client.prestador.findUnique({ where: { tenantId } })
      return row ? toMerchant(row) : null
    },
  }

  readonly listings = {
    save: async (listing: Publicacion) => {
      await this.client.publicacion.upsert({ where: { id: listing.listingId }, create: listingRow(listing), update: listingRow(listing) })
    },
    find: async (listingId: string) => {
      const row = await this.client.publicacion.findUnique({ where: { id: listingId } })
      return row ? toListing(row) : null
    },
    published: async () => (await this.client.publicacion.findMany({ where: { publicada: true } })).map(toListing),
    forTenant: async (tenantId: string) => (await this.client.publicacion.findMany({ where: { tenantId } })).map(toListing),
    reserveProduct: async ({ tenantId, listingId, availabilityVersion, quantity, updatedAt }: { tenantId: string; listingId: string; availabilityVersion: number; quantity: number; updatedAt: string }) => {
      const result = await this.client.publicacion.updateMany({
        where: { id: listingId, tenantId, tipo: 'product', publicada: true, versionDisponibilidad: availabilityVersion, existencias: { gte: quantity } },
        data: { existencias: { decrement: quantity }, versionDisponibilidad: { increment: 1 }, fechaActualizacion: new Date(updatedAt) },
      })
      return result.count === 1
    },
  }

  readonly commitments = {
    saveMany: async (commitments: readonly MarketplaceCommitment[]) => {
      await this.client.compromisoMercadoServicios.createMany({ data: commitments.map(commitmentRow) })
    },
    find: async (commitmentId: string) => {
      const row = await this.client.compromisoMercadoServicios.findUnique({ where: { id: commitmentId } })
      return row ? toCommitment(row) : null
    },
    forTenant: async (tenantId: string) => (await this.client.compromisoMercadoServicios.findMany({ where: { tenantId } })).map(toCommitment),
    forListing: async (listingId: string) => (await this.client.compromisoMercadoServicios.findMany({ where: { publicacionId: listingId } })).map(toCommitment),
  }

  readonly audit = {
    append: async (records: readonly RegistroAuditoriaMercadoServicios[]) => {
      await this.client.auditoriaMercadoServicios.createMany({ data: records.map((record) => ({
        id: record.auditId,
        tenantId: record.tenantId,
        actorId: record.actorId,
        correlacionId: record.correlationId,
        accion: record.action,
        tipoRecurso: record.resourceType,
        recursoId: record.resourceId,
        resultado: record.outcome,
        fechaCreacion: new Date(record.createdAt),
      })) })
    },
    list: async (tenantId: string): Promise<RegistroAuditoriaMercadoServicios[]> => (await this.client.auditoriaMercadoServicios.findMany({ where: { tenantId } })).map(mapearAuditoriaMercadoServicios),
  }

  readonly idempotency = {
    claim: async ({ tenantId, key, requestHash }: { tenantId: string; key: string; requestHash: string }) => {
      const existing = await this.client.idempotencyRecord.findUnique({ where: { tenantId_key: { tenantId, key } } })
      if (!existing) {
        try {
          await this.client.idempotencyRecord.create({ data: { id: `marketplace-idempotency-${tenantId}-${key}`, tenantId, key, requestHash, status: 'pending', response: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } })
          return { status: 'claimed' as const }
        } catch (error) {
          const raced = await this.client.idempotencyRecord.findUnique({ where: { tenantId_key: { tenantId, key } } })
          if (!raced) throw error
          return claimExistingMarketplaceIdempotency(raced, requestHash)
        }
      }
      return claimExistingMarketplaceIdempotency(existing, requestHash)
    },
    complete: async ({ tenantId, key, response }: { tenantId: string; key: string; response: MarketplaceCheckoutResponse }) => {
      await this.client.idempotencyRecord.update({ where: { tenantId_key: { tenantId, key } }, data: { status: 'completed', response: encodeMarketplaceResponse(response) } })
    },
    release: async ({ tenantId, key }: { tenantId: string; key: string }) => {
      await this.client.idempotencyRecord.delete({ where: { tenantId_key: { tenantId, key } } })
    },
  }

  readonly outbox = {
    append: async (record: MarketplaceOutboxRecord) => {
      await this.client.outboxEvent.create({ data: {
        id: record.eventId,
        tenantId: record.tenantId,
        aggregateType: record.aggregateType,
        aggregateId: record.aggregateId,
        eventType: record.eventType,
        payload: record.payload,
        status: 'pending',
        availableAt: new Date(record.createdAt),
        createdAt: new Date(record.createdAt),
      } })
    },
    list: async (tenantId: string): Promise<MarketplaceOutboxRecord[]> => (await this.client.outboxEvent.findMany({ where: { tenantId, eventType: { startsWith: 'tus.marketplace.' } } })).map(toOutbox),
  }

  async transaction<T>(operation: (store: MarketplaceStorePort) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.client.$transaction(async (client) => operation(new PrismaMarketplaceStore(client)), { isolationLevel: 'Serializable' })
      } catch (error) {
        if (!isSerializationFailure(error) || attempt === 2) throw error
      }
    }
    throw new Error('marketplace transaction retry limit exceeded')
  }
}

function claimExistingMarketplaceIdempotency(existing: { requestHash: string; status: string; response: unknown }, requestHash: string) {
  if (existing.requestHash !== requestHash) return { status: 'conflict' as const }
  if (existing.status === 'completed' && existing.response) return { status: 'replay' as const, response: decodeMarketplaceResponse(existing.response) }
  return { status: 'in_progress' as const }
}

function isSerializationFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034'
}

function merchantRow(profile: PerfilPrestador): Record<string, unknown> {
  return { id: profile.merchantId, tenantId: profile.tenantId, prestadorId: profile.merchantId, cohorte: profile.cohort, ubicacionId: profile.locationId, zonaHoraria: profile.timezone, rolesPersonal: profile.staffRoles, versionPoliticaOperativa: profile.operatingPolicyVersion, estado: profile.status, fechaCreacion: new Date(profile.createdAt), fechaActualizacion: new Date(profile.updatedAt) }
}

function listingRow(listing: Publicacion): Record<string, unknown> {
  return { id: listing.listingId, versionContrato: listing.contractVersion, tenantId: listing.tenantId, prestadorId: listing.merchantId, tipo: listing.kind, nombre: listing.name, descripcion: listing.description, cohorte: listing.cohort, ubicacionId: listing.locationId, moneda: listing.currency, precio: BigInt(listing.priceMinor), versionDisponibilidad: listing.availabilityVersion, publicada: listing.published, versionPolitica: listing.policyVersion, existencias: listing.stock, duracionMinutos: listing.durationMinutes, capacidad: listing.capacity, modalidadReserva: toStoredBookingMode(listing.bookingMode), duracionEstimadaMinutos: listing.estimatedDurationMinutes ?? null, modalidadPrecio: toStoredPriceMode(listing.priceMode), horarioTrabajo: listing.workingHours, fechaCreacion: new Date(listing.createdAt), fechaActualizacion: new Date(listing.updatedAt) }
}

function commitmentRow(commitment: MarketplaceCommitment): Record<string, unknown> {
  return { id: commitment.commitmentId, versionContrato: commitment.contractVersion, compromisoId: commitment.commitmentId, carritoId: commitment.cartId, tenantId: commitment.tenantId, prestadorId: commitment.merchantId, publicacionId: commitment.listingId, contexto: commitment.context, idsLineas: commitment.lineIds, cantidad: commitment.quantity, monto: BigInt(commitment.priceSnapshot.minor) * BigInt(commitment.quantity), moneda: commitment.priceSnapshot.currency, estado: commitment.status, versionDisponibilidad: commitment.availabilityVersion, versionPolitica: commitment.policyVersion, franjaInicio: commitment.slotStart ? new Date(commitment.slotStart) : null, franjaFin: commitment.slotEnd ? new Date(commitment.slotEnd) : null, fechaCreacion: new Date(commitment.createdAt), fechaActualizacion: new Date(commitment.createdAt) }
}

function toMerchant(row: Record<string, unknown>): PerfilPrestador {
  return { tenantId: String(row['tenantId']), merchantId: String(row['prestadorId']), cohort: row['cohorte'] as PerfilPrestador['cohort'], locationId: String(row['ubicacionId']), timezone: String(row['zonaHoraria']), staffRoles: Array.isArray(row['rolesPersonal']) ? row['rolesPersonal'].map(String) : [], operatingPolicyVersion: String(row['versionPoliticaOperativa']), status: 'approved', createdAt: new Date(String(row['fechaCreacion'])).toISOString(), updatedAt: new Date(String(row['fechaActualizacion'])).toISOString() }
}

function toListing(row: Record<string, unknown>): Publicacion {
  const priceMinor = toBigInt(row['precio'])
  const durationMinutes = row['duracionMinutos'] === null ? null : Number(row['duracionMinutos'])
  const storedBookingMode = row['modalidadReserva'] === null || row['modalidadReserva'] === undefined ? undefined : String(row['modalidadReserva'])
  const storedPriceMode = row['modalidadPrecio'] === null || row['modalidadPrecio'] === undefined ? undefined : String(row['modalidadPrecio'])
  const bookingMode = toBookingMode(storedBookingMode, durationMinutes)
  const priceMode = toPriceMode(storedPriceMode ?? (storedBookingMode === 'requiere_presupuesto' ? 'presupuesto' : undefined))
  return { listingId: String(row['id']), contractVersion: String(row['versionContrato']) as Publicacion['contractVersion'], tenantId: String(row['tenantId']), merchantId: String(row['prestadorId']), kind: row['tipo'] as Publicacion['kind'], name: String(row['nombre']), description: String(row['descripcion']), cohort: row['cohorte'] as Publicacion['cohort'], locationId: String(row['ubicacionId']), currency: String(row['moneda']).toUpperCase(), price: Number(priceMinor) / 100, priceMinor, priceSnapshot: { currency: String(row['moneda']).toUpperCase(), minor: priceMinor }, availabilityVersion: Number(row['versionDisponibilidad']), published: Boolean(row['publicada']), policyVersion: String(row['versionPolitica']), stock: row['existencias'] === null ? null : Number(row['existencias']), durationMinutes, capacity: row['capacidad'] === null ? null : Number(row['capacidad']), ...(bookingMode === undefined ? {} : { bookingMode }), ...(row['duracionEstimadaMinutos'] === null || row['duracionEstimadaMinutos'] === undefined ? {} : { estimatedDurationMinutes: Number(row['duracionEstimadaMinutos']) }), ...(priceMode === undefined ? {} : { priceMode }), workingHours: row['horarioTrabajo'] as Publicacion['workingHours'], createdAt: new Date(String(row['fechaCreacion'])).toISOString(), updatedAt: new Date(String(row['fechaActualizacion'])).toISOString() }
}

function toStoredBookingMode(mode: Publicacion['bookingMode']): string | null {
  if (mode === 'fixed_shift') return 'turno_fijo'
  if (mode === 'variable_duration') return 'duracion_estimada'
  if (mode === 'visita_diagnostico' || mode === 'duracion_estimada' || mode === 'requiere_presupuesto') return mode
  return null
}

function toStoredPriceMode(mode: Publicacion['priceMode']): string | null {
  if (mode === 'fixed') return 'precio_fijo'
  if (mode === 'requires_budget') return 'presupuesto'
  if (mode === 'precio_fijo' || mode === 'precio_desde' || mode === 'por_hora' || mode === 'presupuesto') return mode
  return null
}

function toBookingMode(value: string | undefined, durationMinutes: number | null): Publicacion['bookingMode'] {
  if (value === 'turno_fijo' || value === 'visita_diagnostico' || value === 'duracion_estimada' || value === 'requiere_presupuesto') return value as Publicacion['bookingMode']
  if (value === 'fixed_shift') return 'fixed_shift'
  if (value === 'variable_duration') return 'variable_duration'
  return durationMinutes === null ? undefined : 'fixed_shift'
}

function toPriceMode(value: string | undefined): Publicacion['priceMode'] {
  if (value === 'precio_fijo' || value === 'precio_desde' || value === 'por_hora' || value === 'presupuesto') return value
  if (value === 'fixed' || value === 'requires_budget') return value
  return undefined
}

function toCommitment(row: Record<string, unknown>): MarketplaceCommitment {
  const amountMinor = toBigInt(row['monto'])
  const currency = String(row['moneda']).toUpperCase()
  return { contractVersion: String(row['versionContrato']) as MarketplaceCommitment['contractVersion'], commitmentId: String(row['compromisoId']), cartId: String(row['carritoId']), tenantId: String(row['tenantId']), merchantId: String(row['prestadorId']), context: row['contexto'] as MarketplaceCommitment['context'], amount: Number(amountMinor) / 100, currency, status: row['estado'] as MarketplaceCommitment['status'], lineIds: Array.isArray(row['idsLineas']) ? row['idsLineas'].map(String) : [], version: Number(row['version'] ?? 1), createdAt: new Date(String(row['fechaCreacion'])).toISOString(), listingId: String(row['publicacionId']), quantity: Number(row['cantidad']), availabilityVersion: Number(row['versionDisponibilidad']), policyVersion: String(row['versionPolitica']), priceSnapshot: { currency, minor: Number(row['cantidad']) > 0 ? amountMinor / BigInt(Number(row['cantidad'])) : amountMinor }, ...(row['franjaInicio'] ? { slotStart: new Date(String(row['franjaInicio'])).toISOString() } : {}), ...(row['franjaFin'] ? { slotEnd: new Date(String(row['franjaFin'])).toISOString() } : {}) }
}

function mapearAuditoriaMercadoServicios(row: Record<string, unknown>): RegistroAuditoriaMercadoServicios {
  return {
    auditId: String(row['id'] ?? row['auditId']),
    tenantId: String(row['tenantId']),
    actorId: String(row['actorId']),
    correlationId: String(row['correlacionId']),
    action: String(row['accion']),
    resourceType: row['tipoRecurso'] as RegistroAuditoriaMercadoServicios['resourceType'],
    resourceId: String(row['recursoId']),
    outcome: row['resultado'] as RegistroAuditoriaMercadoServicios['outcome'],
    createdAt: toIsoString(row['fechaCreacion']),
  }
}

function toOutbox(row: Record<string, unknown>): MarketplaceOutboxRecord {
  const payload = isRecord(row['payload']) ? row['payload'] : {}
  const auditIds = Array.isArray(payload['auditIds']) ? payload['auditIds'].map(String) : []
  const commitmentIds = Array.isArray(payload['commitmentIds']) ? payload['commitmentIds'].map(String) : undefined
  return {
    eventId: String(row['id'] ?? row['eventId']),
    tenantId: String(row['tenantId']),
    eventType: row['eventType'] as MarketplaceOutboxRecord['eventType'],
    aggregateType: row['aggregateType'] as MarketplaceOutboxRecord['aggregateType'],
    aggregateId: String(row['aggregateId']),
    correlationId: typeof payload['correlationId'] === 'string' ? payload['correlationId'] : '',
    payload: { auditIds, ...(commitmentIds === undefined ? {} : { commitmentIds }) },
    createdAt: toTimestamp(row['createdAt']),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

function toTimestamp(value: unknown): number {
  return value instanceof Date ? value.getTime() : Date.parse(String(value))
}

function toBigInt(value: unknown): bigint {
  return typeof value === 'bigint' ? value : BigInt(String(value))
}

function encodeMarketplaceResponse(value: MarketplaceCheckoutResponse): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? `${item}n` : item))
}

function decodeMarketplaceResponse(value: unknown): MarketplaceCheckoutResponse {
  return JSON.parse(JSON.stringify(value), (key, item) => key === 'minor' && typeof item === 'string' && /^\d+n$/u.test(item) ? BigInt(item.slice(0, -1)) : item) as MarketplaceCheckoutResponse
}

export default { PrismaMarketplaceStore }
