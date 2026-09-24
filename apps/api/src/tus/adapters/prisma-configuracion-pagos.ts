import type {
  ConfiguracionPagosDominio,
  PoliticaComisionDominio,
  PuertoConfiguracionPagos,
} from '../finance/servicios/configuracion.ts'
import type {
  CuentaCobroDominio,
  EstadoOAuthDominio,
  PuertoCuentasCobro,
} from '../finance/servicios/cuentas-cobro.ts'
import { ErrorFinanzasServicio } from '../finance/servicios/modelo.ts'

// WEB-09D Prisma adapters. Policies and configuration are insert-only (database triggers reject
// UPDATE/DELETE); provider accounts use optimistic versions; OAuth states are consumed atomically.

type Fila = Record<string, unknown>

interface Delegado {
  findMany(args?: unknown): Promise<Fila[]>
  findFirst(args: unknown): Promise<Fila | null>
  create(args: unknown): Promise<unknown>
  updateMany(args: unknown): Promise<{ count: number }>
  deleteMany(args: unknown): Promise<{ count: number }>
}

export interface ClientePrismaConfiguracionPagos {
  politicaComisionServicio: Delegado
  configuracionPagosServicio: Delegado
  cuentaCobroPrestador: Delegado
  credencialCuentaCobro: Delegado
  estadoOAuthCobro: Delegado
}

const PROVEEDOR = 'mercado-pago'

export class ConfiguracionPagosPrisma implements PuertoConfiguracionPagos {
  constructor(private readonly client: ClientePrismaConfiguracionPagos) {}

  async listarPoliticas(): Promise<PoliticaComisionDominio[]> {
    const rows = await this.client.politicaComisionServicio.findMany({
      orderBy: { fechaCreacion: 'asc' },
    })
    return rows.map((row) => ({
      politicaId: String(row['politicaId']),
      scope: String(row['alcance']) as PoliticaComisionDominio['scope'],
      scopeRef: row['alcanceRef'] == null ? null : String(row['alcanceRef']),
      version: Number(row['version']),
      rateBps: Number(row['tasaPuntosBase']),
      ruleVersion: String(row['versionRegla']),
      pspFeeBearer: String(row['feePspACargo']) as PoliticaComisionDominio['pspFeeBearer'],
      reason: String(row['motivo']),
      actorId: String(row['actorId']),
      correlationId: String(row['correlacionId']),
      createdAt: fecha(row['fechaCreacion']),
    }))
  }

  async agregarPolitica(politica: PoliticaComisionDominio): Promise<void> {
    await crearUnico(() =>
      this.client.politicaComisionServicio.create({
        data: {
          id: politica.politicaId,
          politicaId: politica.politicaId,
          alcance: politica.scope,
          alcanceRef: politica.scopeRef,
          claveAlcance:
            politica.scope === 'global' ? 'global' : `${politica.scope}:${politica.scopeRef}`,
          version: politica.version,
          tasaPuntosBase: politica.rateBps,
          versionRegla: politica.ruleVersion,
          feePspACargo: politica.pspFeeBearer,
          motivo: politica.reason,
          actorId: politica.actorId,
          correlacionId: politica.correlationId,
          fechaCreacion: new Date(politica.createdAt),
        },
      })
    )
  }

  async ultimaConfiguracion(): Promise<ConfiguracionPagosDominio | null> {
    const row = await this.client.configuracionPagosServicio.findFirst({
      orderBy: { version: 'desc' },
    })
    if (!row) return null
    return {
      configuracionId: String(row['configuracionId']),
      version: Number(row['version']),
      paymentsEnabled: row['pagosHabilitados'] === true,
      provider: PROVEEDOR,
      currency: String(row['moneda']),
      reason: String(row['motivo']),
      actorId: String(row['actorId']),
      correlationId: String(row['correlacionId']),
      createdAt: fecha(row['fechaCreacion']),
    }
  }

  async agregarConfiguracion(configuracion: ConfiguracionPagosDominio): Promise<void> {
    await crearUnico(() =>
      this.client.configuracionPagosServicio.create({
        data: {
          id: configuracion.configuracionId,
          configuracionId: configuracion.configuracionId,
          version: configuracion.version,
          pagosHabilitados: configuracion.paymentsEnabled,
          proveedor: PROVEEDOR,
          moneda: configuracion.currency,
          motivo: configuracion.reason,
          actorId: configuracion.actorId,
          correlacionId: configuracion.correlationId,
          fechaCreacion: new Date(configuracion.createdAt),
        },
      })
    )
  }
}

export class CuentasCobroPrisma implements PuertoCuentasCobro {
  constructor(private readonly client: ClientePrismaConfiguracionPagos) {}

  async buscarCuenta(prestadorTenantId: string): Promise<CuentaCobroDominio | null> {
    const row = await this.client.cuentaCobroPrestador.findFirst({
      where: { prestadorTenantId, proveedor: PROVEEDOR },
    })
    if (!row) return null
    return {
      prestadorTenantId: String(row['prestadorTenantId']),
      provider: PROVEEDOR,
      status: String(row['estado']) as CuentaCobroDominio['status'],
      externalAccountId: row['cuentaExternaId'] == null ? null : String(row['cuentaExternaId']),
      liveMode: typeof row['modoProductivo'] === 'boolean' ? row['modoProductivo'] : null,
      scopes: String(row['alcances'] ?? '')
        .split(' ')
        .filter(Boolean),
      connectedAt: row['conectadaEn'] == null ? null : fecha(row['conectadaEn']),
      expiresAt: row['expiraEn'] == null ? null : fecha(row['expiraEn']),
      version: Number(row['version']),
      actorId: String(row['actorId']),
      correlationId: String(row['correlacionId']),
      createdAt: fecha(row['fechaCreacion']),
      updatedAt: fecha(row['fechaActualizacion']),
    }
  }

  async guardarCuenta(
    cuenta: CuentaCobroDominio,
    expectedVersion: number | null
  ): Promise<boolean> {
    const data = {
      estado: cuenta.status,
      cuentaExternaId: cuenta.externalAccountId,
      modoProductivo: cuenta.liveMode,
      alcances: cuenta.scopes.join(' '),
      conectadaEn: cuenta.connectedAt ? new Date(cuenta.connectedAt) : null,
      expiraEn: cuenta.expiresAt ? new Date(cuenta.expiresAt) : null,
      version: cuenta.version,
      actorId: cuenta.actorId,
      correlacionId: cuenta.correlationId,
      fechaActualizacion: new Date(cuenta.updatedAt),
    }
    if (expectedVersion === null) {
      try {
        await this.client.cuentaCobroPrestador.create({
          data: {
            ...data,
            id: `cuenta-cobro-${cuenta.prestadorTenantId}-${PROVEEDOR}`,
            prestadorTenantId: cuenta.prestadorTenantId,
            proveedor: PROVEEDOR,
            fechaCreacion: new Date(cuenta.createdAt),
          },
        })
        return true
      } catch (error) {
        if (codigoPrisma(error) === 'P2002') return false
        throw error
      }
    }
    const result = await this.client.cuentaCobroPrestador.updateMany({
      where: {
        prestadorTenantId: cuenta.prestadorTenantId,
        proveedor: PROVEEDOR,
        version: expectedVersion,
      },
      data,
    })
    return result.count === 1
  }

  async guardarCredencial(input: {
    prestadorTenantId: string
    ciphertext: string
    keyVersion: string
    updatedAt: string
  }): Promise<void> {
    await this.client.credencialCuentaCobro.deleteMany({
      where: { prestadorTenantId: input.prestadorTenantId, proveedor: PROVEEDOR },
    })
    await this.client.credencialCuentaCobro.create({
      data: {
        id: `credencial-cobro-${input.prestadorTenantId}-${PROVEEDOR}`,
        prestadorTenantId: input.prestadorTenantId,
        proveedor: PROVEEDOR,
        credencialCifrada: input.ciphertext,
        versionClave: input.keyVersion,
        fechaActualizacion: new Date(input.updatedAt),
      },
    })
  }

  async borrarCredencial(prestadorTenantId: string): Promise<void> {
    await this.client.credencialCuentaCobro.deleteMany({
      where: { prestadorTenantId, proveedor: PROVEEDOR },
    })
  }

  async leerCredencial(
    prestadorTenantId: string
  ): Promise<{ ciphertext: string; keyVersion: string } | null> {
    const row = await this.client.credencialCuentaCobro.findFirst({
      where: { prestadorTenantId, proveedor: PROVEEDOR },
    })
    return row
      ? { ciphertext: String(row['credencialCifrada']), keyVersion: String(row['versionClave']) }
      : null
  }

  async buscarCuentaPorExterna(externalAccountId: string): Promise<CuentaCobroDominio | null> {
    const row = await this.client.cuentaCobroPrestador.findFirst({
      where: { cuentaExternaId: externalAccountId, proveedor: PROVEEDOR, estado: 'connected' },
    })
    return row ? this.buscarCuenta(String(row['prestadorTenantId'])) : null
  }

  async crearEstado(estado: EstadoOAuthDominio): Promise<void> {
    await crearUnico(() =>
      this.client.estadoOAuthCobro.create({
        data: {
          id: `oauth-${estado.stateDigest}`,
          huellaEstado: estado.stateDigest,
          prestadorTenantId: estado.prestadorTenantId,
          actorId: estado.actorId,
          proveedor: PROVEEDOR,
          verificadorCifrado: estado.verifierCiphertext,
          expiraEn: new Date(estado.expiresAt),
          consumidoEn: null,
          fechaCreacion: new Date(estado.createdAt),
        },
      })
    )
  }

  async consumirEstado(stateDigest: string, now: string): Promise<EstadoOAuthDominio | null> {
    const consumed = await this.client.estadoOAuthCobro.updateMany({
      where: { huellaEstado: stateDigest, consumidoEn: null, expiraEn: { gt: new Date(now) } },
      data: { consumidoEn: new Date(now) },
    })
    if (consumed.count !== 1) return null
    const row = await this.client.estadoOAuthCobro.findFirst({
      where: { huellaEstado: stateDigest },
    })
    if (!row) return null
    return {
      stateDigest,
      prestadorTenantId: String(row['prestadorTenantId']),
      actorId: String(row['actorId']),
      verifierCiphertext: String(row['verificadorCifrado']),
      expiresAt: fecha(row['expiraEn']),
      consumedAt: now,
      createdAt: fecha(row['fechaCreacion']),
    }
  }
}

async function crearUnico(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation()
  } catch (error) {
    if (codigoPrisma(error) === 'P2002')
      throw new ErrorFinanzasServicio(
        409,
        'VERSION_CONFLICT',
        'a concurrent version was recorded; reload it'
      )
    throw error
  }
}

function codigoPrisma(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

function fecha(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}
