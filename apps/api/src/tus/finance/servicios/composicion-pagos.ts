import {
  PoliticaCobroPersistida,
  ServicioConfiguracionPagos,
  leerEstadoOperativoPagos,
  oauthConfigurado,
  proveedorOperativo,
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
import {
  ProveedorPagosMercadoPago,
  type ConfiguracionProveedorMercadoPago,
} from './mercado-pago.ts'
import { ProveedorPagosServicioNoDisponible, type PuertoProveedorPagosServicio } from './pagos.ts'

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
}

export function crearModuloPagosServicio(input: {
  env: Record<string, string | undefined>
  configuracion: PuertoConfiguracionPagos
  cuentas: PuertoCuentasCobro
  now?: () => number
  oauth?: PuertoOAuthMercadoPago
  realProviderAdapterAvailable?: boolean
  // Evidence-based readiness for real money (production only). Defaults to "not authorized".
  produccionAutorizada?: () => Promise<boolean>
  // IDENTITY-NOSIS gate (provider identity verified). Absent only in isolated unit compositions.
  identidadVerificada?: (tenantId: string) => Promise<boolean>
  // Tests inject a fake HTTP transport for the Mercado Pago API.
  mercadoPago?: Pick<ConfiguracionProveedorMercadoPago, 'fetch' | 'apiBaseUrl'>
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
    input.identidadVerificada ?? null
  )
  const produccionAutorizada = input.produccionAutorizada ?? (async () => false)
  const proveedor: PuertoProveedorPagosServicio =
    oauthListo && proveedorOperativo(estado) && estado.environment !== 'unset'
      ? new ProveedorPagosMercadoPago(
          {
            environment: estado.environment,
            webhookSecret: env['MERCADO_PAGO_WEBHOOK_SECRET']!.trim(),
            notificationUrl: env['MERCADO_PAGO_NOTIFICATION_URL']!.trim(),
            webBaseUrl: env['TUS_WEB_BASE_URL']!.trim(),
            marketplace: env['MERCADO_PAGO_MARKETPLACE']?.trim() || null,
            now,
            ...input.mercadoPago,
          },
          cuentas
        )
      : new ProveedorPagosServicioNoDisponible()
  const platformAdminTenantId = env['TUS_PLATFORM_ADMIN_TENANT_ID']?.trim() || null
  return {
    configuracion: new ServicioConfiguracionPagos(
      input.configuracion,
      operativo,
      now,
      produccionAutorizada
    ),
    cuentas,
    politica: new PoliticaCobroPersistida(
      input.configuracion,
      operativo,
      (tenantId) => cuentas.cuentaConectada(tenantId),
      produccionAutorizada,
      input.identidadVerificada ?? null
    ),
    proveedor,
    operativo,
    platformAdminTenantId,
  }
}
