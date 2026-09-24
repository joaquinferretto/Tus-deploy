import {
  PoliticaCobroPersistida,
  ServicioConfiguracionPagos,
  leerEstadoOperativoPagos,
  oauthConfigurado,
  type EstadoOperativoPagos,
  type PuertoConfiguracionPagos,
} from './configuracion.ts'
import {
  BovedaCredencialesAesGcm,
  ClienteOAuthMercadoPagoHttp,
  ServicioCuentasCobro,
  type PuertoCuentasCobro,
  type PuertoOAuthMercadoPago,
} from './cuentas-cobro.ts'

// WEB-09E (real Mercado Pago payment adapter) is not implemented, so the runtime can never make
// a payment available even when every variable is present. Flip only together with that adapter.
export const ADAPTADOR_PAGO_REAL_DISPONIBLE = false

export interface ModuloPagosServicio {
  configuracion: ServicioConfiguracionPagos
  cuentas: ServicioCuentasCobro
  politica: PoliticaCobroPersistida
  operativo: () => EstadoOperativoPagos
  platformAdminTenantId: string | null
}

export function crearModuloPagosServicio(input: {
  env: Record<string, string | undefined>
  configuracion: PuertoConfiguracionPagos
  cuentas: PuertoCuentasCobro
  now?: () => number
  oauth?: PuertoOAuthMercadoPago
  realProviderAdapterAvailable?: boolean
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
    now
  )
  const platformAdminTenantId = env['TUS_PLATFORM_ADMIN_TENANT_ID']?.trim() || null
  return {
    configuracion: new ServicioConfiguracionPagos(input.configuracion, operativo, now),
    cuentas,
    politica: new PoliticaCobroPersistida(input.configuracion, operativo, (tenantId) =>
      cuentas.cuentaConectada(tenantId)
    ),
    operativo,
    platformAdminTenantId,
  }
}
