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

// Used only while no global policy has been recorded: the existing 10% rule. WEB-09E product
// decision: the customer pays exactly the accepted budget and the Mercado Pago fee is deducted
// from the provider (Split 1:1 native behaviour), so the default bearer is `provider`.
export const REGLA_COMISION_APLICABLE_POR_DEFECTO: ReglaComisionAplicable = Object.freeze({
  politicaId: null,
  rateBps: REGLA_COMISION_SERVICIO_POR_DEFECTO.rateBps,
  ruleVersion: REGLA_COMISION_SERVICIO_POR_DEFECTO.ruleVersion,
  pspFeeBearer: 'provider',
})

// TUS-GANANCIAS-01: minimum of a provider payout request while no configuration says otherwise
// ($10.000,00). The ONLY place of this default in code; the database column has the same DEFAULT
// for configurations recorded before the field existed. Changed by recording a configuration.
export const MONTO_MINIMO_LIQUIDACION_POR_DEFECTO_MINOR = 1_000_000n
const MONTO_MINIMO_LIQUIDACION_MAXIMO_MINOR = 100_000_000_000n

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
  notificationUrlConfigured: boolean
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
    notificationUrlConfigured: /^https:\/\//u.test(
      env['MERCADO_PAGO_NOTIFICATION_URL']?.trim() ?? ''
    ),
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
    estado.notificationUrlConfigured &&
    estado.realProviderAdapterAvailable
  )
}

// Evidence-based readiness of one capability, as an operator reads it: `blockers` lists each
// requirement still lacking valid evidence as `gate:reason` (never a secret, never a value).
export interface EstadoHabilitacionPagos {
  capability: 'service-payments' | 'settlement'
  authorized: boolean
  blockers: string[]
}

// PAGOS-HABILITACION-TECNICA-01. Readiness for the public launch of service payments: the
// commercial and legal approvals (legal, kyc, kyb, tax, mercadoPago, runtimeProvider), each with
// the state of its evidence. It never decides whether a payment can be charged.
export const REQUISITOS_LANZAMIENTO_PUBLICO = ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider'] as const
export type EstadoRequisitoLanzamiento = 'current' | 'pending' | 'expired' | 'revoked' | 'invalid'
export interface EstadoLanzamientoPublico {
  capability: 'public-launch-readiness'
  ready: boolean
  gates: { gate: string; status: EstadoRequisitoLanzamiento }[]
}

const ESTADO_POR_MOTIVO: Record<string, EstadoRequisitoLanzamiento> = {
  evidence_missing: 'pending',
  evidence_out_of_scope: 'pending',
  evidence_not_yet_valid: 'pending',
  evidence_expired: 'expired',
  evidence_revoked: 'revoked',
}

// From the evaluation of the stored evidence (`gate:reason` for what is not valid).
export function lanzamientoPublicoDesde(evaluacion: EstadoHabilitacionPagos): EstadoLanzamientoPublico {
  const motivos = new Map(evaluacion.blockers.filter((item) => item.includes(':')).map((item) => item.split(':') as [string, string]))
  // The evaluation itself failed: nothing can be said to be current.
  const sinDetalle = !evaluacion.authorized && motivos.size === 0
  return {
    capability: 'public-launch-readiness',
    ready: evaluacion.authorized,
    gates: REQUISITOS_LANZAMIENTO_PUBLICO.map((gate) => ({
      gate,
      status: evaluacion.authorized ? 'current' : sinDetalle ? 'pending' : motivos.has(gate) ? (ESTADO_POR_MOTIVO[motivos.get(gate)!] ?? 'invalid') : 'current',
    })),
  }
}

// `servicePayments` is the gate service payments depend on. `settlement` is the gate of the
// general marketplace, reported only so the two are never confused.
export interface EstadoHabilitacionesPagos {
  servicePayments: EstadoHabilitacionPagos
  settlement: EstadoHabilitacionPagos
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
    // PAGOS-RETENCION-01. The payment is made before the work is completed (a deposit, a total
    // paid in advance): TUS must be the one that collects it, so it can hold the money.
    anticipado?: boolean
  }): Promise<{ available: boolean; reason: MotivoPagoNoDisponible | null; mode?: 'split' | 'plataforma' }>
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
    private readonly cuentaConectada: (prestadorTenantId: string) => Promise<boolean>,
    // PAGOS-HABILITACION-TECNICA-01. Readiness for the public launch (legal, tax, KYC, KYB,
    // Mercado Pago and runtime approvals, by evidence). Reported; it does NOT decide whether a
    // payment can be charged: that is every real control checked in `disponibilidad`.
    private readonly lanzamientoPublico: () => Promise<boolean> = async () => false,
    // PAGOS-MP-VINCULADO-01: TUS no longer asks for its own identity verification (KYC/KYB) to
    // charge. The position is kept so callers need no change; whatever is passed is NOT consulted.
    _verificacionPropiaEnDesuso: unknown = null,
    // TUS-GANANCIAS-01: TUS can collect with its own Mercado Pago account (platform access token
    // and user configured). Then a provider without a linked account can still be paid: TUS
    // collects and the provider's share becomes an earning to be paid out later.
    private readonly cobroPlataforma: () => boolean = () => false
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
    anticipado?: boolean
  }): Promise<{ available: boolean; reason: MotivoPagoNoDisponible | null; mode?: 'split' | 'plataforma' }> {
    const configuracion = await this.store.ultimaConfiguracion()
    if (!configuracion?.paymentsEnabled) return { available: false, reason: 'PAYMENTS_DISABLED' }
    const operativo = this.operativo()
    if (!proveedorOperativo(operativo))
      return { available: false, reason: 'PROVIDER_NOT_CONFIGURED' }
    const rule = await this.reglaComision(input)
    if (rule.pspFeeBearer === 'undetermined')
      return { available: false, reason: 'PSP_FEE_POLICY_UNDECIDED' }
    // Split 1:1 deducts the Mercado Pago fee from the seller; a platform-paid fee would need a
    // different product and is not supported.
    if (rule.pspFeeBearer === 'platform')
      return { available: false, reason: 'PSP_FEE_POLICY_UNSUPPORTED' }
    // PAGOS-MP-VINCULADO-01. What a provider needs to charge: its Mercado Pago account linked
    // (OAuth), by the ids TUS stored. Mercado Pago already verified the owner of that account
    // (a person, a monotributista, a company): TUS does not repeat it and never compares names.
    const vinculada = await this.cuentaConectada(input.prestadorTenantId)
    if (!vinculada) return { available: false, reason: 'PROVIDER_ACCOUNT_NOT_CONNECTED' }
    // PAGOS-RETENCION-01. An advance payment (anything paid before the service is done) must be
    // money TUS can hold until the work reaches its release milestone, so TUS collects it with
    // its own account (the provider's linked one receives its payouts). A payment Mercado Pago pays
    // straight to the provider (split) is in its hands the moment it is approved. Without an
    // account of TUS an advance payment is NOT sent there: it is refused as a configuration
    // error. The split stays for payments made after the service.
    if (input.anticipado)
      return this.cobroPlataforma() ? { available: true, reason: null, mode: 'plataforma' } : { available: false, reason: 'PLATFORM_ACCOUNT_REQUIRED' }
    return { available: true, reason: null, mode: 'split' }
  }

  // Whether TUS holds every approval for the public launch. Information for an operator.
  async listoParaLanzamientoPublico(): Promise<boolean> {
    return this.lanzamientoPublico().catch(() => false)
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
    private readonly now: () => number = () => Date.now(),
    private readonly produccionAutorizada: () => Promise<boolean> = async () => false,
    // Detail of the readiness gates for the status. Absent in isolated compositions: the status
    // then only knows whether service payments are authorized.
    private readonly habilitaciones: (() => Promise<EstadoHabilitacionesPagos>) | null = null
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
    effective: { paymentsEnabled: boolean; provider: 'mercado-pago'; currency: string; minimumPayoutMinor: string }
  }> {
    const current = await this.store.ultimaConfiguracion()
    return {
      configuration: current ? proyectarConfiguracion(current) : null,
      effective: {
        paymentsEnabled: current?.paymentsEnabled ?? false,
        provider: 'mercado-pago',
        currency: current?.currency ?? 'ARS',
        minimumPayoutMinor: current?.minimumPayoutMinor ?? MONTO_MINIMO_LIQUIDACION_POR_DEFECTO_MINOR.toString(10),
      },
    }
  }

  // The minimum of a provider payout request in force (centavos).
  async minimoLiquidacion(): Promise<bigint> {
    const current = await this.store.ultimaConfiguracion()
    return current ? BigInt(current.minimumPayoutMinor) : MONTO_MINIMO_LIQUIDACION_POR_DEFECTO_MINOR
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
    // Optional: absent keeps the minimum in force.
    const minimo = input['minimumPayoutMinor']
    if (minimo !== undefined && (typeof minimo !== 'string' || !/^[1-9]\d{0,14}$/u.test(minimo) || BigInt(minimo) > MONTO_MINIMO_LIQUIDACION_MAXIMO_MINOR))
      throw new ErrorFinanzasServicio(400, 'INVALID', 'minimumPayoutMinor must be a positive integer of centavos')
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
      minimumPayoutMinor: typeof minimo === 'string' ? minimo : (current?.minimumPayoutMinor ?? MONTO_MINIMO_LIQUIDACION_POR_DEFECTO_MINOR.toString(10)),
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
      version: number
      since: string | null
      actorId: string | null
      reason: string | null
      previousRateBps: number | null
    }
    // The evidence registries, as stored. `requiredNow` is always false since
    // PAGOS-HABILITACION-TECNICA-01: no evidence decides whether a payment can be charged.
    readiness: { gate: 'service-payments'; requiredNow: boolean } & EstadoHabilitacionesPagos
    // Every real control of the payment engine passes (`blockers` is empty) and the switch is on.
    technicallyEnabled: boolean
    // The approvals for the public launch, each pending, current or expired. Never a blocker.
    publicLaunchReadiness: EstadoLanzamientoPublico
    blockers: string[]
  }> {
    const operational = this.operativo()
    const configuracion = await this.store.ultimaConfiguracion()
    const politicas = await this.store.listarPoliticas()
    const global = resolverPoliticaComision(politicas, {
      prestadorId: '',
      categoria: null,
    })
    const globales = politicas.filter((politica) => politica.scope === 'global').sort((a, b) => b.version - a.version)
    const vigente = globales[0] ?? null
    const anterior = globales[1] ?? null
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
    if (!operational.notificationUrlConfigured)
      blockers.push('MERCADO_PAGO_NOTIFICATION_URL_MISSING')
    if (!operational.realProviderAdapterAvailable) blockers.push('REAL_PAYMENT_ADAPTER_UNAVAILABLE')
    if (global.pspFeeBearer === 'undetermined') blockers.push('PSP_FEE_POLICY_UNDECIDED')
    if (global.pspFeeBearer === 'platform') blockers.push('PSP_FEE_POLICY_UNSUPPORTED')
    const habilitaciones = this.habilitaciones
      ? await this.habilitaciones()
      : await this.habilitacionesSinDetalle()
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
        // COMISION-TRABAJO-01: its version (to change it), since when and who set it, and what it was before.
        version: vigente?.version ?? 0,
        since: vigente?.createdAt ?? null,
        actorId: vigente?.actorId ?? null,
        reason: vigente?.reason ?? null,
        previousRateBps: anterior?.rateBps ?? (vigente ? REGLA_COMISION_SERVICIO_POR_DEFECTO.rateBps : null),
      },
      readiness: { gate: 'service-payments', requiredNow: false, ...habilitaciones },
      technicallyEnabled: blockers.length === 0,
      publicLaunchReadiness: lanzamientoPublicoDesde(habilitaciones.servicePayments),
      blockers,
    }
  }

  private async habilitacionesSinDetalle(): Promise<EstadoHabilitacionesPagos> {
    const authorized = await this.produccionAutorizada()
    return {
      servicePayments: {
        capability: 'service-payments',
        authorized,
        blockers: authorized ? [] : ['READINESS_NOT_AUTHORIZED'],
      },
      settlement: { capability: 'settlement', authorized: false, blockers: ['NOT_EVALUATED'] },
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
    minimumPayoutMinor: configuracion.minimumPayoutMinor,
    reason: configuracion.reason,
    actorId: configuracion.actorId,
    createdAt: configuracion.createdAt,
  }
}

function texto(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 500) : null
}
