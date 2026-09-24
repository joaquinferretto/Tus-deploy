import { randomUUID } from 'node:crypto'
import {
  ALCANCES_POLITICA_COMISION,
  RESPONSABLES_FEE_PSP,
  TUS_CONTRACT_VERSION,
  type AlcancePoliticaComision,
  type ConfiguracionPagosServicio,
  type MotivoPagoNoDisponible,
  type PoliticaComisionServicio,
  type ResponsableFeePsp,
} from '@factory/contracts'
import { REGLA_COMISION_SERVICIO_POR_DEFECTO, validarTasaComision } from './liquidacion.ts'
import { ErrorFinanzasServicio } from './modelo.ts'

// WEB-09D: product configuration for service payments. Commission policies and the payments
// switch are persisted, versioned and append-only, so they change without a redeploy and old
// payments keep the rate recorded in their commission snapshot. Secrets never live here: the
// operational state below only reports whether environment secrets are present.

export interface ReglaComisionAplicable {
  politicaId: string | null
  rateBps: number
  ruleVersion: string
  pspFeeBearer: ResponsableFeePsp
}

// Used only while no global policy has been recorded. It keeps the existing 10% rule and leaves
// the PSP fee bearer undecided, which keeps real payments unavailable.
export const REGLA_COMISION_APLICABLE_POR_DEFECTO: ReglaComisionAplicable = Object.freeze({
  politicaId: null,
  rateBps: REGLA_COMISION_SERVICIO_POR_DEFECTO.rateBps,
  ruleVersion: REGLA_COMISION_SERVICIO_POR_DEFECTO.ruleVersion,
  pspFeeBearer: 'undetermined',
})

export type PoliticaComisionDominio = Omit<PoliticaComisionServicio, 'contractVersion'> & {
  correlationId: string
}

export type ConfiguracionPagosDominio = Omit<ConfiguracionPagosServicio, 'contractVersion'> & {
  correlationId: string
}

export interface PuertoConfiguracionPagos {
  listarPoliticas(): Promise<PoliticaComisionDominio[]>
  // Must fail with a unique violation when (scope, scopeRef, version) already exists.
  agregarPolitica(politica: PoliticaComisionDominio): Promise<void>
  ultimaConfiguracion(): Promise<ConfiguracionPagosDominio | null>
  agregarConfiguracion(configuracion: ConfiguracionPagosDominio): Promise<void>
}

export class AlmacenConfiguracionPagosEnMemoria implements PuertoConfiguracionPagos {
  readonly politicas: PoliticaComisionDominio[] = []
  readonly configuraciones: ConfiguracionPagosDominio[] = []

  async listarPoliticas(): Promise<PoliticaComisionDominio[]> {
    return this.politicas.map((politica) => ({ ...politica }))
  }

  async agregarPolitica(politica: PoliticaComisionDominio): Promise<void> {
    if (
      this.politicas.some(
        (item) =>
          item.scope === politica.scope &&
          item.scopeRef === politica.scopeRef &&
          item.version === politica.version
      )
    )
      throw new ErrorFinanzasServicio(409, 'VERSION_CONFLICT', 'policy version already exists')
    this.politicas.push({ ...politica })
  }

  async ultimaConfiguracion(): Promise<ConfiguracionPagosDominio | null> {
    const last = this.configuraciones.at(-1)
    return last ? { ...last } : null
  }

  async agregarConfiguracion(configuracion: ConfiguracionPagosDominio): Promise<void> {
    if (this.configuraciones.some((item) => item.version === configuracion.version))
      throw new ErrorFinanzasServicio(
        409,
        'VERSION_CONFLICT',
        'configuration version already exists'
      )
    this.configuraciones.push({ ...configuracion })
  }
}

// Most specific scope wins: provider > category > global; within a scope the latest version.
export function resolverPoliticaComision(
  politicas: readonly PoliticaComisionDominio[],
  input: { prestadorId: string; categoria: string | null }
): ReglaComisionAplicable {
  const candidates: [AlcancePoliticaComision, string | null][] = [
    ['prestador', input.prestadorId],
    ['categoria', input.categoria],
    ['global', null],
  ]
  for (const [scope, scopeRef] of candidates) {
    if (scope !== 'global' && !scopeRef) continue
    const latest = ultimaVersion(politicas, scope, scopeRef)
    if (latest)
      return {
        politicaId: latest.politicaId,
        rateBps: latest.rateBps,
        ruleVersion: latest.ruleVersion,
        pspFeeBearer: latest.pspFeeBearer,
      }
  }
  return REGLA_COMISION_APLICABLE_POR_DEFECTO
}

function ultimaVersion(
  politicas: readonly PoliticaComisionDominio[],
  scope: AlcancePoliticaComision,
  scopeRef: string | null
): PoliticaComisionDominio | null {
  return politicas
    .filter((politica) => politica.scope === scope && politica.scopeRef === scopeRef)
    .reduce<PoliticaComisionDominio | null>(
      (best, politica) => (!best || politica.version > best.version ? politica : best),
      null
    )
}

// Operational state derived from the environment at request time. Values are never exposed:
// only whether each required secret/setting is present.
export interface EstadoOperativoPagos {
  mercadoPagoEnabled: boolean
  environment: 'sandbox' | 'production' | 'unset'
  clientIdConfigured: boolean
  clientSecretConfigured: boolean
  webhookSecretConfigured: boolean
  redirectUriConfigured: boolean
  credentialsKeyConfigured: boolean
  webBaseUrlConfigured: boolean
  realProviderAdapterAvailable: boolean
}

export function leerEstadoOperativoPagos(
  env: Record<string, string | undefined>,
  realProviderAdapterAvailable: boolean
): EstadoOperativoPagos {
  const present = (key: string) => typeof env[key] === 'string' && env[key]!.trim().length > 0
  const environment = env['MERCADO_PAGO_ENVIRONMENT']?.trim()
  return {
    mercadoPagoEnabled: env['TUS_MERCADOPAGO_ENABLED']?.trim() === 'true',
    environment: environment === 'sandbox' || environment === 'production' ? environment : 'unset',
    clientIdConfigured: present('MERCADO_PAGO_CLIENT_ID'),
    clientSecretConfigured: present('MERCADO_PAGO_CLIENT_SECRET'),
    webhookSecretConfigured: present('MERCADO_PAGO_WEBHOOK_SECRET'),
    redirectUriConfigured: present('MERCADO_PAGO_OAUTH_REDIRECT_URI'),
    credentialsKeyConfigured: present('TUS_PAYMENT_CREDENTIALS_KEY'),
    webBaseUrlConfigured: present('TUS_WEB_BASE_URL'),
    realProviderAdapterAvailable,
  }
}

export function oauthConfigurado(estado: EstadoOperativoPagos): boolean {
  return (
    estado.mercadoPagoEnabled &&
    estado.environment !== 'unset' &&
    estado.clientIdConfigured &&
    estado.clientSecretConfigured &&
    estado.redirectUriConfigured &&
    estado.credentialsKeyConfigured &&
    estado.webBaseUrlConfigured
  )
}

export function proveedorOperativo(estado: EstadoOperativoPagos): boolean {
  return (
    oauthConfigurado(estado) &&
    estado.webhookSecretConfigured &&
    estado.realProviderAdapterAvailable
  )
}

// Answers "can a customer pay this provider now?" without touching the finance transaction.
export interface PuertoPoliticaCobro {
  reglaComision(input: {
    prestadorTenantId: string
    prestadorId: string
    categoria: string | null
  }): Promise<ReglaComisionAplicable>
  disponibilidad(input: {
    prestadorTenantId: string
    prestadorId: string
    categoria: string | null
  }): Promise<{ available: boolean; reason: MotivoPagoNoDisponible | null }>
}

// Fixed policy: tests and fixtures. Availability only depends on the injected provider.
export class PoliticaCobroFija implements PuertoPoliticaCobro {
  constructor(
    private readonly rule: ReglaComisionAplicable,
    private readonly providerAvailable: boolean
  ) {}

  async reglaComision(): Promise<ReglaComisionAplicable> {
    return this.rule
  }

  async disponibilidad(): Promise<{ available: boolean; reason: MotivoPagoNoDisponible | null }> {
    return this.providerAvailable
      ? { available: true, reason: null }
      : { available: false, reason: 'PROVIDER_NOT_CONFIGURED' }
  }
}

// Runtime policy: persisted configuration + environment + provider account link, fail closed.
export class PoliticaCobroPersistida implements PuertoPoliticaCobro {
  constructor(
    private readonly store: PuertoConfiguracionPagos,
    private readonly operativo: () => EstadoOperativoPagos,
    private readonly cuentaConectada: (prestadorTenantId: string) => Promise<boolean>
  ) {}

  async reglaComision(input: {
    prestadorId: string
    categoria: string | null
  }): Promise<ReglaComisionAplicable> {
    return resolverPoliticaComision(await this.store.listarPoliticas(), input)
  }

  async disponibilidad(input: {
    prestadorTenantId: string
    prestadorId: string
    categoria: string | null
  }): Promise<{ available: boolean; reason: MotivoPagoNoDisponible | null }> {
    const configuracion = await this.store.ultimaConfiguracion()
    if (!configuracion?.paymentsEnabled) return { available: false, reason: 'PAYMENTS_DISABLED' }
    if (!proveedorOperativo(this.operativo()))
      return { available: false, reason: 'PROVIDER_NOT_CONFIGURED' }
    const rule = await this.reglaComision(input)
    if (rule.pspFeeBearer === 'undetermined')
      return { available: false, reason: 'PSP_FEE_POLICY_UNDECIDED' }
    if (!(await this.cuentaConectada(input.prestadorTenantId)))
      return { available: false, reason: 'PROVIDER_ACCOUNT_NOT_CONNECTED' }
    return { available: true, reason: null }
  }
}

export interface ContextoAdministracionPagos {
  actorId: string
  correlationId: string
}

// Administrative commands. Callers must have verified the platform-admin authority already.
export class ServicioConfiguracionPagos {
  constructor(
    private readonly store: PuertoConfiguracionPagos,
    private readonly operativo: () => EstadoOperativoPagos,
    private readonly now: () => number = () => Date.now()
  ) {}

  async listarPoliticas(): Promise<PoliticaComisionServicio[]> {
    return (await this.store.listarPoliticas())
      .sort((left, right) =>
        left.scope === right.scope
          ? String(left.scopeRef).localeCompare(String(right.scopeRef)) ||
            left.version - right.version
          : left.scope.localeCompare(right.scope)
      )
      .map(proyectarPolitica)
  }

  async registrarPolitica(
    context: ContextoAdministracionPagos,
    input: Record<string, unknown>
  ): Promise<PoliticaComisionServicio> {
    const scope = input['scope']
    if (!ALCANCES_POLITICA_COMISION.includes(scope as AlcancePoliticaComision))
      throw new ErrorFinanzasServicio(
        400,
        'INVALID',
        'scope must be global, categoria or prestador'
      )
    const scopeRef = scope === 'global' ? null : texto(input['scopeRef'])
    if (scope !== 'global' && !scopeRef)
      throw new ErrorFinanzasServicio(400, 'INVALID', 'scopeRef is required for scoped policies')
    const rateBps = validarTasaComision(input['rateBps'])
    const pspFeeBearer = input['pspFeeBearer'] ?? 'undetermined'
    if (!RESPONSABLES_FEE_PSP.includes(pspFeeBearer as ResponsableFeePsp))
      throw new ErrorFinanzasServicio(
        400,
        'INVALID',
        'pspFeeBearer must be undetermined, provider or platform'
      )
    const reason = texto(input['reason'])
    if (!reason) throw new ErrorFinanzasServicio(400, 'INVALID', 'reason is required')
    const politicas = await this.store.listarPoliticas()
    const current = ultimaVersion(politicas, scope as AlcancePoliticaComision, scopeRef)
    const expectedVersion = input['expectedVersion']
    if ((current?.version ?? 0) !== expectedVersion)
      throw new ErrorFinanzasServicio(
        409,
        'VERSION_CONFLICT',
        'commission policy changed; reload it'
      )
    const version = (current?.version ?? 0) + 1
    const politica: PoliticaComisionDominio = {
      politicaId: `politica-comision-${randomUUID()}`,
      scope: scope as AlcancePoliticaComision,
      scopeRef,
      version,
      rateBps,
      ruleVersion: `${scope}${scopeRef ? `:${scopeRef}` : ''}:v${version}:${rateBps}bps`,
      pspFeeBearer: pspFeeBearer as ResponsableFeePsp,
      reason,
      actorId: context.actorId,
      correlationId: context.correlationId,
      createdAt: new Date(this.now()).toISOString(),
    }
    await this.store.agregarPolitica(politica)
    return proyectarPolitica(politica)
  }

  async configuracionActual(): Promise<{
    configuration: ConfiguracionPagosServicio | null
    effective: { paymentsEnabled: boolean; provider: 'mercado-pago'; currency: string }
  }> {
    const current = await this.store.ultimaConfiguracion()
    return {
      configuration: current ? proyectarConfiguracion(current) : null,
      effective: {
        paymentsEnabled: current?.paymentsEnabled ?? false,
        provider: 'mercado-pago',
        currency: current?.currency ?? 'ARS',
      },
    }
  }

  async registrarConfiguracion(
    context: ContextoAdministracionPagos,
    input: Record<string, unknown>
  ): Promise<ConfiguracionPagosServicio> {
    if (typeof input['paymentsEnabled'] !== 'boolean')
      throw new ErrorFinanzasServicio(400, 'INVALID', 'paymentsEnabled must be a boolean')
    const reason = texto(input['reason'])
    if (!reason) throw new ErrorFinanzasServicio(400, 'INVALID', 'reason is required')
    const currency = texto(input['currency']) ?? 'ARS'
    if (currency !== 'ARS')
      throw new ErrorFinanzasServicio(400, 'INVALID', 'only ARS service payments are supported')
    const current = await this.store.ultimaConfiguracion()
    if ((current?.version ?? 0) !== input['expectedVersion'])
      throw new ErrorFinanzasServicio(
        409,
        'VERSION_CONFLICT',
        'payment configuration changed; reload it'
      )
    const configuracion: ConfiguracionPagosDominio = {
      configuracionId: `configuracion-pagos-${randomUUID()}`,
      version: (current?.version ?? 0) + 1,
      paymentsEnabled: input['paymentsEnabled'],
      provider: 'mercado-pago',
      currency,
      reason,
      actorId: context.actorId,
      correlationId: context.correlationId,
      createdAt: new Date(this.now()).toISOString(),
    }
    await this.store.agregarConfiguracion(configuracion)
    return proyectarConfiguracion(configuracion)
  }

  // Readiness snapshot for operators: booleans only, never secret values.
  async estado(): Promise<{
    checkedAt: string
    productEnabled: boolean
    operational: EstadoOperativoPagos
    oauthReady: boolean
    providerReady: boolean
    globalPolicy: {
      rateBps: number
      ruleVersion: string
      pspFeeBearer: ResponsableFeePsp
      persisted: boolean
    }
    blockers: string[]
  }> {
    const operational = this.operativo()
    const configuracion = await this.store.ultimaConfiguracion()
    const global = resolverPoliticaComision(await this.store.listarPoliticas(), {
      prestadorId: '',
      categoria: null,
    })
    const blockers: string[] = []
    if (!configuracion?.paymentsEnabled) blockers.push('PAYMENTS_DISABLED')
    if (!operational.mercadoPagoEnabled) blockers.push('TUS_MERCADOPAGO_ENABLED_FALSE')
    if (operational.environment === 'unset') blockers.push('MERCADO_PAGO_ENVIRONMENT_UNSET')
    if (!operational.clientIdConfigured) blockers.push('MERCADO_PAGO_CLIENT_ID_MISSING')
    if (!operational.clientSecretConfigured) blockers.push('MERCADO_PAGO_CLIENT_SECRET_MISSING')
    if (!operational.webhookSecretConfigured) blockers.push('MERCADO_PAGO_WEBHOOK_SECRET_MISSING')
    if (!operational.redirectUriConfigured) blockers.push('MERCADO_PAGO_OAUTH_REDIRECT_URI_MISSING')
    if (!operational.credentialsKeyConfigured) blockers.push('TUS_PAYMENT_CREDENTIALS_KEY_MISSING')
    if (!operational.webBaseUrlConfigured) blockers.push('TUS_WEB_BASE_URL_MISSING')
    if (!operational.realProviderAdapterAvailable)
      blockers.push('REAL_PAYMENT_ADAPTER_NOT_IMPLEMENTED')
    if (global.pspFeeBearer === 'undetermined') blockers.push('PSP_FEE_POLICY_UNDECIDED')
    return {
      checkedAt: new Date(this.now()).toISOString(),
      productEnabled: configuracion?.paymentsEnabled ?? false,
      operational,
      oauthReady: oauthConfigurado(operational),
      providerReady: proveedorOperativo(operational),
      globalPolicy: {
        rateBps: global.rateBps,
        ruleVersion: global.ruleVersion,
        pspFeeBearer: global.pspFeeBearer,
        persisted: global.politicaId !== null,
      },
      blockers,
    }
  }
}

function proyectarPolitica(politica: PoliticaComisionDominio): PoliticaComisionServicio {
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    politicaId: politica.politicaId,
    scope: politica.scope,
    scopeRef: politica.scopeRef,
    version: politica.version,
    rateBps: politica.rateBps,
    ruleVersion: politica.ruleVersion,
    pspFeeBearer: politica.pspFeeBearer,
    reason: politica.reason,
    actorId: politica.actorId,
    createdAt: politica.createdAt,
  }
}

function proyectarConfiguracion(
  configuracion: ConfiguracionPagosDominio
): ConfiguracionPagosServicio {
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    configuracionId: configuracion.configuracionId,
    version: configuracion.version,
    paymentsEnabled: configuracion.paymentsEnabled,
    provider: configuracion.provider,
    currency: configuracion.currency,
    reason: configuracion.reason,
    actorId: configuracion.actorId,
    createdAt: configuracion.createdAt,
  }
}

function texto(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 500) : null
}
