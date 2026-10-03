import type { EstadoSolicitudLiquidacion, MecanismoLiquidacion } from '@factory/contracts'
import { ErrorFinanzasServicio } from '../finance/servicios/modelo.ts'
import type {
  DecisionSolicitud,
  EstadoReservable,
  FiltroLiquidaciones,
  ItemLiquidacion,
  MovimientoConContexto,
  MovimientoGanancia,
  PuertoLedgerGanancias,
  PuertoSolicitudesLiquidacion,
  SolicitudLiquidacion,
  TipoMovimientoGanancia,
} from '../finance/servicios/ganancias.ts'
import { isSerializationFailure, isUniqueConstraint } from './prisma-work.ts'

// TUS-GANANCIAS-01 over PostgreSQL. The ledger is append-only in the database (trigger); a payout
// request, its items and its reserve are written in one serializable transaction; the unique
// indexes (one open request per provider, one active item per movement, one reserve / release /
// completion per request, one request per Mercado Pago payout) make a double payout impossible
// even when two operations race.

type Fila = Record<string, unknown>
interface Delegado {
  findFirst(input: Record<string, unknown>): Promise<Fila | null>
  findMany(input: Record<string, unknown>): Promise<Fila[]>
  count(input: Record<string, unknown>): Promise<number>
  create(input: { data: Record<string, unknown> }): Promise<unknown>
  createMany(input: { data: Record<string, unknown>[] }): Promise<unknown>
  updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
}

export interface ClienteLedgerGanancias {
  movimientoGananciaPrestador: Pick<Delegado, 'findFirst' | 'create'>
}

export interface ClientePrismaGanancias {
  movimientoGananciaPrestador: Delegado
  solicitudLiquidacion: Delegado
  itemSolicitudLiquidacion: Delegado
  cuentaCobroPrestador: Delegado
  prestador: Delegado
  perfilPublicoPrestador: Delegado
  obligacionPagoServicio: Delegado
  trabajo: Delegado
  reserva: Delegado
  instantaneaComision: Delegado
  $transaction<T>(callback: (tx: ClientePrismaGanancias) => Promise<T>, options?: { isolationLevel?: 'Serializable' }): Promise<T>
}

const fecha = (value: unknown): string => (value instanceof Date ? value : new Date(String(value))).toISOString()
const fechaNula = (value: unknown): string | null => (value === null || value === undefined ? null : fecha(value))
const textoNulo = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))

function movimientoDe(fila: Fila): MovimientoGanancia {
  return {
    movimientoId: String(fila['movimientoId']),
    prestadorTenantId: String(fila['prestadorTenantId']),
    prestadorId: String(fila['prestadorId']),
    tipo: fila['tipo'] as TipoMovimientoGanancia,
    amountMinor: BigInt(fila['monto'] as bigint),
    currency: 'ARS',
    obligacionTenantId: textoNulo(fila['obligacionTenantId']),
    obligacionId: textoNulo(fila['obligacionId']),
    trabajoId: textoNulo(fila['trabajoId']),
    solicitudId: textoNulo(fila['solicitudId']),
    relacionadoId: textoNulo(fila['movimientoRelacionadoId']),
    reason: String(fila['motivo']),
    actorId: String(fila['actorId']),
    correlationId: String(fila['correlacionId']),
    createdAt: fecha(fila['fechaCreacion']),
  }
}

function filaMovimiento(movimiento: MovimientoGanancia): Record<string, unknown> {
  return {
    id: `ganancia-${movimiento.prestadorTenantId}-${movimiento.movimientoId}`,
    movimientoId: movimiento.movimientoId,
    prestadorTenantId: movimiento.prestadorTenantId,
    prestadorId: movimiento.prestadorId,
    tipo: movimiento.tipo,
    monto: movimiento.amountMinor,
    moneda: movimiento.currency,
    obligacionTenantId: movimiento.obligacionTenantId,
    obligacionId: movimiento.obligacionId,
    trabajoId: movimiento.trabajoId,
    solicitudId: movimiento.solicitudId,
    movimientoRelacionadoId: movimiento.relacionadoId,
    motivo: movimiento.reason,
    actorId: movimiento.actorId,
    correlacionId: movimiento.correlationId,
    fechaCreacion: new Date(movimiento.createdAt),
  }
}

function solicitudDe(fila: Fila): SolicitudLiquidacion {
  return {
    solicitudId: String(fila['solicitudId']),
    prestadorTenantId: String(fila['prestadorTenantId']),
    prestadorId: String(fila['prestadorId']),
    amountMinor: BigInt(fila['monto'] as bigint),
    currency: 'ARS',
    status: fila['estado'] as EstadoSolicitudLiquidacion,
    cuentaCobroId: String(fila['cuentaCobroId']),
    destinationEmail: String(fila['emailDestino']),
    destinationAccountId: textoNulo(fila['cuentaExternaDestino']),
    mechanism: textoNulo(fila['mecanismo']) as MecanismoLiquidacion | null,
    providerPayoutId: textoNulo(fila['payoutProveedorId']),
    providerTransactionId: textoNulo(fila['transaccionProveedorId']),
    providerStatus: textoNulo(fila['estadoProveedor']),
    externalReference: textoNulo(fila['referenciaExterna']),
    failureReason: textoNulo(fila['motivoFallo']),
    note: textoNulo(fila['observacion']),
    requestedBy: String(fila['solicitadaPor']),
    processedBy: textoNulo(fila['procesadaPor']),
    resolvedBy: textoNulo(fila['resueltaPor']),
    idempotencyKey: String(fila['claveIdempotencia']),
    correlationId: String(fila['correlacionId']),
    version: Number(fila['version']),
    createdAt: fecha(fila['fechaCreacion']),
    updatedAt: fecha(fila['fechaActualizacion']),
    processingAt: fechaNula(fila['procesandoEn']),
    paidAt: fechaNula(fila['pagadaEn']),
    failedAt: fechaNula(fila['fallidaEn']),
    cancelledAt: fechaNula(fila['canceladaEn']),
  }
}

// What can change on a request after its creation.
function camposSolicitud(solicitud: SolicitudLiquidacion): Record<string, unknown> {
  return {
    estado: solicitud.status,
    mecanismo: solicitud.mechanism,
    payoutProveedorId: solicitud.providerPayoutId,
    transaccionProveedorId: solicitud.providerTransactionId,
    estadoProveedor: solicitud.providerStatus,
    referenciaExterna: solicitud.externalReference,
    motivoFallo: solicitud.failureReason,
    observacion: solicitud.note,
    procesadaPor: solicitud.processedBy,
    resueltaPor: solicitud.resolvedBy,
    version: solicitud.version,
    fechaActualizacion: new Date(solicitud.updatedAt),
    procesandoEn: solicitud.processingAt ? new Date(solicitud.processingAt) : null,
    pagadaEn: solicitud.paidAt ? new Date(solicitud.paidAt) : null,
    fallidaEn: solicitud.failedAt ? new Date(solicitud.failedAt) : null,
    canceladaEn: solicitud.cancelledAt ? new Date(solicitud.cancelledAt) : null,
  }
}

const itemDe = (fila: Fila): ItemLiquidacion => ({ solicitudId: String(fila['solicitudId']), movimientoId: String(fila['movimientoId']), activo: Boolean(fila['activo']) })

// The ledger as the finance transaction sees it (same transactional client).
export class LedgerGananciasPrisma implements PuertoLedgerGanancias {
  constructor(private readonly client: ClienteLedgerGanancias) {}

  async buscar(input: { prestadorTenantId: string; movimientoId: string }): Promise<MovimientoGanancia | null> {
    const fila = await this.client.movimientoGananciaPrestador.findFirst({ where: { prestadorTenantId: input.prestadorTenantId, movimientoId: input.movimientoId } })
    return fila ? movimientoDe(fila) : null
  }

  async registrar(movimiento: MovimientoGanancia): Promise<void> {
    await this.client.movimientoGananciaPrestador.create({ data: filaMovimiento(movimiento) })
  }
}

// What an earning was for, in words: the part of the payment and the service of the turno.
function conceptoDe(obligacion: Fila | undefined): string {
  if (!obligacion) return 'Pago de un servicio'
  if (obligacion['tramo'] === 'sena') return obligacion['origenImporte'] === 'booked_price' ? 'Seña de un turno' : 'Seña de un trabajo'
  if (obligacion['tramo'] === 'saldo') return 'Saldo de un trabajo'
  return 'Pago de un servicio'
}

export class AlmacenSolicitudesLiquidacionPrisma implements PuertoSolicitudesLiquidacion {
  constructor(private readonly client: ClientePrismaGanancias) {}

  async movimientos(prestadorTenantId: string): Promise<MovimientoConContexto[]> {
    const filas = await this.client.movimientoGananciaPrestador.findMany({ where: { prestadorTenantId }, orderBy: [{ fechaCreacion: 'asc' }, { movimientoId: 'asc' }] })
    const movimientos = filas.map(movimientoDe)
    const claves = movimientos.filter((item) => item.obligacionId)
    if (claves.length === 0) return movimientos
    // Three batched reads for the words of the history (no per-row query).
    const obligaciones = await this.client.obligacionPagoServicio.findMany({ where: { prestadorTenantId, obligacionId: { in: [...new Set(claves.map((item) => item.obligacionId!))] } } })
    const trabajos = await this.client.trabajo.findMany({ where: { prestadorTenantId, trabajoId: { in: [...new Set(claves.map((item) => item.trabajoId!))] } } })
    const reservas = await this.client.reserva.findMany({ where: { tenantId: prestadorTenantId, reservaId: { in: trabajos.map((item) => item['reservaId']).filter((value): value is string => typeof value === 'string') } } })
    const obligacionDe = new Map(obligaciones.map((fila) => [`${fila['tenantId']}\u0000${fila['obligacionId']}`, fila]))
    const reservaDeTrabajo = new Map(trabajos.map((fila) => [String(fila['trabajoId']), reservas.find((reserva) => reserva['reservaId'] === fila['reservaId'])]))
    return movimientos.map((movimiento) => {
      if (!movimiento.obligacionId) return movimiento
      const reserva = reservaDeTrabajo.get(movimiento.trabajoId!)
      return {
        ...movimiento,
        concepto: conceptoDe(obligacionDe.get(`${movimiento.obligacionTenantId}\u0000${movimiento.obligacionId}`)),
        servicio: (reserva?.['tarifaNombre'] as string | null | undefined) ?? null,
        turno: reserva ? fechaNula(reserva['fechaInicio']) : null,
      }
    })
  }

  async items(prestadorTenantId: string): Promise<ItemLiquidacion[]> {
    return (await this.client.itemSolicitudLiquidacion.findMany({ where: { prestadorTenantId } })).map(itemDe)
  }

  async solicitudes(prestadorTenantId: string): Promise<SolicitudLiquidacion[]> {
    return (await this.client.solicitudLiquidacion.findMany({ where: { prestadorTenantId }, orderBy: { fechaCreacion: 'asc' } })).map(solicitudDe)
  }

  async buscar(prestadorTenantId: string, solicitudId: string): Promise<SolicitudLiquidacion | null> {
    const fila = await this.client.solicitudLiquidacion.findFirst({ where: { prestadorTenantId, solicitudId } })
    return fila ? solicitudDe(fila) : null
  }

  async buscarPorId(solicitudId: string): Promise<SolicitudLiquidacion | null> {
    const fila = await this.client.solicitudLiquidacion.findFirst({ where: { solicitudId } })
    return fila ? solicitudDe(fila) : null
  }

  async buscarPorPayoutProveedor(providerPayoutId: string): Promise<SolicitudLiquidacion | null> {
    const fila = await this.client.solicitudLiquidacion.findFirst({ where: { payoutProveedorId: providerPayoutId } })
    return fila ? solicitudDe(fila) : null
  }

  async listar(filtro: FiltroLiquidaciones): Promise<{ items: SolicitudLiquidacion[]; total: number }> {
    const where = { estado: { in: [...filtro.estados] }, ...(filtro.prestadorTenantId ? { prestadorTenantId: filtro.prestadorTenantId } : {}) }
    const [filas, total] = await Promise.all([
      this.client.solicitudLiquidacion.findMany({ where, orderBy: { fechaCreacion: 'desc' }, take: filtro.limite, skip: filtro.desplazamiento }),
      this.client.solicitudLiquidacion.count({ where }),
    ])
    return { items: filas.map(solicitudDe), total }
  }

  async nombrePrestador(prestadorTenantId: string): Promise<string | null> {
    const fila = await this.client.perfilPublicoPrestador.findFirst({ where: { tenantId: prestadorTenantId }, orderBy: { fechaCreacion: 'asc' } })
    return fila ? String(fila['nombrePublico']) : null
  }

  async prestadorDe(prestadorTenantId: string): Promise<string | null> {
    const fila = await this.client.prestador.findFirst({ where: { tenantId: prestadorTenantId }, orderBy: { fechaCreacion: 'asc' } })
    return fila ? String(fila['prestadorId']) : null
  }

  async cuentaParaLiquidar(prestadorTenantId: string) {
    const fila = await this.client.cuentaCobroPrestador.findFirst({ where: { prestadorTenantId, proveedor: 'mercado-pago', estado: 'connected' } })
    return fila ? { cuentaCobroId: String(fila['id']), externalAccountId: textoNulo(fila['cuentaExternaId']) } : null
  }

  async cuentaActual(prestadorTenantId: string) {
    const fila = await this.client.cuentaCobroPrestador.findFirst({ where: { prestadorTenantId, proveedor: 'mercado-pago' } })
    return fila ? { status: String(fila['estado']), externalAccountId: textoNulo(fila['cuentaExternaId']), liveMode: fila['modoProductivo'] === null || fila['modoProductivo'] === undefined ? null : Boolean(fila['modoProductivo']) } : null
  }

  async registrarMovimiento(movimiento: MovimientoGanancia): Promise<boolean> {
    try {
      await this.client.movimientoGananciaPrestador.create({ data: filaMovimiento(movimiento) })
      return true
    } catch (error) {
      if (isUniqueConstraint(error)) return false
      throw error
    }
  }

  async prestadoresConDebitos(): Promise<string[]> {
    const filas = await this.client.movimientoGananciaPrestador.findMany({
      where: { tipo: { in: ['psp_fee_debit', 'refund_debit', 'chargeback_debit', 'adjustment_debit'] } },
      distinct: ['prestadorTenantId'],
      select: { prestadorTenantId: true },
      take: 500,
    })
    return filas.map((fila) => String(fila['prestadorTenantId']))
  }

  async desgloses(prestadorTenantId: string) {
    const ganancias = await this.client.movimientoGananciaPrestador.findMany({ where: { prestadorTenantId, tipo: 'earning_credit' }, select: { obligacionTenantId: true, obligacionId: true } })
    const resultado = new Map<string, { grossMinor: bigint; commissionMinor: bigint; pspFeeMinor: bigint | null }>()
    if (ganancias.length === 0) return resultado
    const instantaneas = await this.client.instantaneaComision.findMany({ where: { OR: ganancias.map((fila) => ({ tenantId: fila['obligacionTenantId'], obligacionId: fila['obligacionId'] })) } })
    for (const fila of instantaneas)
      resultado.set(String(fila['obligacionId']), { grossMinor: BigInt(fila['montoBruto'] as bigint), commissionMinor: BigInt(fila['montoComision'] as bigint), pspFeeMinor: fila['comisionProveedorPago'] === null || fila['comisionProveedorPago'] === undefined ? null : BigInt(fila['comisionProveedorPago'] as bigint) })
    return resultado
  }

  async crearAtomica(prestadorTenantId: string, idempotencyKey: string, armar: (estado: EstadoReservable) => DecisionSolicitud | SolicitudLiquidacion): Promise<{ solicitud: SolicitudLiquidacion; nueva: boolean }> {
    try {
      return await this.client.$transaction(
        async (tx) => {
          const [movimientos, items, solicitudes] = await Promise.all([
            tx.movimientoGananciaPrestador.findMany({ where: { prestadorTenantId }, orderBy: [{ fechaCreacion: 'asc' }, { movimientoId: 'asc' }] }),
            tx.itemSolicitudLiquidacion.findMany({ where: { prestadorTenantId, activo: true } }),
            tx.solicitudLiquidacion.findMany({ where: { prestadorTenantId } }),
          ])
          const propias = solicitudes.map(solicitudDe)
          const decision = armar({
            movimientos: movimientos.map(movimientoDe),
            itemsActivos: items.map(itemDe),
            solicitudes: propias,
            abierta: propias.find((item) => item.status === 'pending' || item.status === 'processing') ?? null,
            porClave: propias.find((item) => item.idempotencyKey === idempotencyKey) ?? null,
          })
          if (!('movimientoIds' in decision)) return { solicitud: decision, nueva: false }
          const { solicitud, movimientoIds, reserva } = decision
          const creada = new Date(solicitud.createdAt)
          await tx.solicitudLiquidacion.create({
            data: {
              id: `solicitud-liquidacion-${solicitud.solicitudId}`,
              solicitudId: solicitud.solicitudId,
              prestadorTenantId: solicitud.prestadorTenantId,
              prestadorId: solicitud.prestadorId,
              monto: solicitud.amountMinor,
              moneda: solicitud.currency,
              cuentaCobroId: solicitud.cuentaCobroId,
              emailDestino: solicitud.destinationEmail,
              cuentaExternaDestino: solicitud.destinationAccountId,
              solicitadaPor: solicitud.requestedBy,
              claveIdempotencia: solicitud.idempotencyKey,
              correlacionId: solicitud.correlationId,
              fechaCreacion: creada,
              ...camposSolicitud(solicitud),
            },
          })
          if (movimientoIds.length > 0)
            await tx.itemSolicitudLiquidacion.createMany({
              data: movimientoIds.map((movimientoId) => ({ id: `item-liquidacion-${solicitud.solicitudId}-${movimientoId}`, prestadorTenantId, solicitudId: solicitud.solicitudId, movimientoId, activo: true, fechaCreacion: creada })),
            })
          await tx.movimientoGananciaPrestador.create({ data: filaMovimiento(reserva) })
          return { solicitud, nueva: true }
        },
        { isolationLevel: 'Serializable' }
      )
    } catch (error) {
      if (error instanceof ErrorFinanzasServicio) throw error
      if (!isUniqueConstraint(error) && !isSerializationFailure(error)) throw error
      // Somebody else won the race: the same key returns that request; anything else is a
      // second open request for the same money.
      const existente = await this.client.solicitudLiquidacion.findFirst({ where: { prestadorTenantId, claveIdempotencia: idempotencyKey } })
      if (existente) return { solicitud: solicitudDe(existente), nueva: false }
      throw new ErrorFinanzasServicio(409, 'PAYOUT_ALREADY_OPEN', 'a payout request is already in progress')
    }
  }

  async transicionar(input: { actual: SolicitudLiquidacion; siguiente: SolicitudLiquidacion; liberar: boolean; movimientos: MovimientoGanancia[]; at: string }): Promise<boolean> {
    try {
      return await this.client.$transaction(
        async (tx) => {
          const movida = await tx.solicitudLiquidacion.updateMany({
            where: { prestadorTenantId: input.actual.prestadorTenantId, solicitudId: input.actual.solicitudId, version: input.actual.version, estado: input.actual.status },
            data: camposSolicitud(input.siguiente),
          })
          if (movida.count !== 1) return false
          if (input.liberar)
            await tx.itemSolicitudLiquidacion.updateMany({ where: { prestadorTenantId: input.actual.prestadorTenantId, solicitudId: input.actual.solicitudId, activo: true }, data: { activo: false, fechaLiberacion: new Date(input.at) } })
          for (const movimiento of input.movimientos) await tx.movimientoGananciaPrestador.create({ data: filaMovimiento(movimiento) })
          return true
        },
        { isolationLevel: 'Serializable' }
      )
    } catch (error) {
      if (isUniqueConstraint(error) || isSerializationFailure(error)) return false
      throw error
    }
  }
}
