import {
  PoliticaCobroPersistida,
  ServicioConfiguracionPagos,
  leerEstadoOperativoPagos,
  oauthConfigurado,
  proveedorOperativo,
  type EstadoHabilitacionesPagos,
  type EstadoOperativoPagos,
  type PuertoConfiguracionPagos,
} from './configuracion.ts'
import {
  BovedaCredencialesAesGcm,
  ClienteOAuthMercadoPagoHttp,
  ServicioCuentasCobro,
  type EventoCuentaCobro,
  type PuertoCuentasCobro,
  type PuertoOAuthMercadoPago,
} from './cuentas-cobro.ts'
import {
  ProveedorPagosMercadoPago,
  type ConfiguracionProveedorMercadoPago,
} from './mercado-pago.ts'
import { ProveedorPagosServicioNoDisponible, type PuertoProveedorPagosServicio } from './pagos.ts'
import { EjecucionLiquidacionNoConfigurada, type PuertoEjecucionLiquidacion } from './ganancias.ts'
import { EjecucionLiquidacionMercadoPago, clavePrivadaPayouts, type ConfiguracionPayoutsMercadoPago } from './payouts-mercado-pago.ts'

// WEB-09E: the real Mercado Pago adapter exists. It is only composed when every variable is
// present; otherwise the runtime keeps `ProveedorPagosServicioNoDisponible` (fail closed).
export const ADAPTADOR_PAGO_REAL_DISPONIBLE = true

export interface ModuloPagosServicio {
  configuracion: ServicioConfiguracionPagos
  cuentas: ServicioCuentasCobro
  politica: PoliticaCobroPersistida
  proveedor: PuertoProveedorPagosServicio
  operativo: () => EstadoOperativoPagos
  platformAdminTenantId: string | null
  // TUS collects with its own account for providers without a linked one (earnings regime).
  cobroPlataforma: boolean
  // How provider earnings are paid out: Mercado Pago Payouts when configured; otherwise nothing
  // can be sent (fail closed).
  liquidaciones: PuertoEjecucionLiquidacion
}

export function crearModuloPagosServicio(input: {
  env: Record<string, string | undefined>
  configuracion: PuertoConfiguracionPagos
  cuentas: PuertoCuentasCobro
  now?: () => number
  oauth?: PuertoOAuthMercadoPago
  realProviderAdapterAvailable?: boolean
  // Evidence-based readiness of the `service-payments` capability for real money (production
  // only). Defaults to "not authorized".
  produccionAutorizada?: () => Promise<boolean>
  // The same decision with its detail, next to the `settlement` gate, for the admin status.
  habilitaciones?: () => Promise<EstadoHabilitacionesPagos>
  // PAGOS-MP-VINCULADO-01: audit of every link, reconnection and unlink of a provider account.
  auditarCuenta?: (evento: EventoCuentaCobro) => Promise<void>
  // Tests inject a fake HTTP transport for the Mercado Pago API.
  mercadoPago?: Pick<ConfiguracionProveedorMercadoPago, 'fetch' | 'apiBaseUrl'>
  payouts?: Pick<ConfiguracionPayoutsMercadoPago, 'fetch' | 'apiBaseUrl'>
}): ModuloPagosServicio {
  const now = input.now ?? (() => Date.now())
  const env = input.env
  const operativo = () =>
    leerEstadoOperativoPagos(
      env,
      input.realProviderAdapterAvailable ?? ADAPTADOR_PAGO_REAL_DISPONIBLE
    )
  const estado = operativo()
  let boveda: BovedaCredencialesAesGcm | null = null
  if (estado.credentialsKeyConfigured) {
    try {
      boveda = new BovedaCredencialesAesGcm(env['TUS_PAYMENT_CREDENTIALS_KEY'] ?? '')
    } catch {
      // Invalid key length: linking stays unavailable instead of storing weakly protected tokens.
      boveda = null
    }
  }
  const oauthListo = oauthConfigurado(estado) && boveda !== null
  const oauth = oauthListo
    ? (input.oauth ??
      new ClienteOAuthMercadoPagoHttp({
        clientId: env['MERCADO_PAGO_CLIENT_ID']!.trim(),
        clientSecret: env['MERCADO_PAGO_CLIENT_SECRET']!.trim(),
        testToken: estado.environment === 'sandbox',
      }))
    : null
  const cuentas = new ServicioCuentasCobro(
    input.cuentas,
    oauthListo
      ? {
          clientId: env['MERCADO_PAGO_CLIENT_ID']!.trim(),
          redirectUri: env['MERCADO_PAGO_OAUTH_REDIRECT_URI']!.trim(),
          webBaseUrl: env['TUS_WEB_BASE_URL']!.trim(),
        }
      : null,
    oauthListo ? boveda : null,
    oauth,
    now,
    input.auditarCuenta ?? null
  )
  const produccionAutorizada = input.produccionAutorizada ?? (async () => false)
  // TUS-GANANCIAS-01: TUS's own account, to collect for providers without a linked account.
  const tokenPlataforma = env['MERCADO_PAGO_PLATFORM_ACCESS_TOKEN']?.trim() ?? ''
  const usuarioPlataforma = env['MERCADO_PAGO_PLATFORM_USER_ID']?.trim() ?? ''
  const plataforma = tokenPlataforma && /^\d{3,20}$/u.test(usuarioPlataforma) ? { accessToken: tokenPlataforma, userId: usuarioPlataforma } : null
  const proveedor: PuertoProveedorPagosServicio =
    oauthListo && proveedorOperativo(estado) && estado.environment !== 'unset'
      ? new ProveedorPagosMercadoPago(
          {
            environment: estado.environment,
            webhookSecret: env['MERCADO_PAGO_WEBHOOK_SECRET']!.trim(),
            notificationUrl: env['MERCADO_PAGO_NOTIFICATION_URL']!.trim(),
            webBaseUrl: env['TUS_WEB_BASE_URL']!.trim(),
            marketplace: env['MERCADO_PAGO_MARKETPLACE']?.trim() || null,
            plataforma,
            now,
            ...input.mercadoPago,
          },
          cuentas
        )
      : new ProveedorPagosServicioNoDisponible()
  const platformAdminTenantId = env['TUS_PLATFORM_ADMIN_TENANT_ID']?.trim() || null
  const liquidaciones = crearEjecucionLiquidaciones(env, estado.environment, plataforma, proveedor.source === 'authorized', input.payouts)
  return {
    configuracion: new ServicioConfiguracionPagos(
      input.configuracion,
      operativo,
      now,
      produccionAutorizada,
      input.habilitaciones ?? null
    ),
    cuentas,
    politica: new PoliticaCobroPersistida(
      input.configuracion,
      operativo,
      (tenantId) => cuentas.cuentaConectada(tenantId),
      produccionAutorizada,
      null,
      // Only with the real adapter configured: a fake or missing provider never collects for TUS.
      () => plataforma !== null && proveedor.source === 'authorized'
    ),
    proveedor,
    operativo,
    platformAdminTenantId,
    cobroPlataforma: plataforma !== null && proveedor.source === 'authorized',
    liquidaciones,
  }
}

// TUS-GANANCIAS-01: Mercado Pago Payouts with TUS's own account. Composed only when explicitly
// enabled (TUS_MERCADOPAGO_PAYOUTS_ENABLED=true), with the real payment adapter and the platform
// account configured, and, in production, with a valid Ed25519 request-signing key. Anything
// missing or invalid leaves payouts unavailable (no transfer can be sent).
function crearEjecucionLiquidaciones(
  env: Record<string, string | undefined>,
  environment: EstadoOperativoPagos['environment'],
  plataforma: { accessToken: string; userId: string } | null,
  proveedorReal: boolean,
  transporte: Pick<ConfiguracionPayoutsMercadoPago, 'fetch' | 'apiBaseUrl'> | undefined
): PuertoEjecucionLiquidacion {
  if (env['TUS_MERCADOPAGO_PAYOUTS_ENABLED']?.trim() !== 'true' || !plataforma || !proveedorReal) return new EjecucionLiquidacionNoConfigurada()
  if (environment !== 'sandbox' && environment !== 'production') return new EjecucionLiquidacionNoConfigurada()
  const notificationUrl = env['MERCADO_PAGO_PAYOUTS_NOTIFICATION_URL']?.trim() || null
  try {
    const pem = env['MERCADO_PAGO_PAYOUTS_SIGNING_KEY']?.trim() ?? ''
    const signingKey = pem ? clavePrivadaPayouts(pem) : null
    return new EjecucionLiquidacionMercadoPago({ environment, accessToken: plataforma.accessToken, signingKey, notificationUrl, ...transporte })
  } catch {
    // Invalid key or URL, or production without its signing key.
    return new EjecucionLiquidacionNoConfigurada()
  }
}
