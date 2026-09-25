import { BovedaCredencialesAesGcm } from '../finance/servicios/cuentas-cobro.ts'
import { crearPoolCredencialesGroq, tieneCredencialesGroq } from '../../providers/groq/index.ts'
import {
  MotorOcrTesseract,
  ModeloVisionGroq,
  OcrIdentityDocumentReader,
  VisionIdentityDocumentReader,
} from './lectores.ts'
import { SesionNavegadorCifrada } from './memoria.ts'
import { NosisBrowserIdentityProvider, type ConfiguracionNosisBrowser } from './nosis-browser.ts'
import { NosisDemoIdentityProvider, type IdentityVerificationProvider } from './proveedor.ts'
import type { BrowserSessionStore, PuertoTransaccionIdentidad } from './puertos.ts'
import { ServicioVerificacionIdentidad } from './servicio.ts'
import { WorkerVerificacionIdentidad, type LoggerWorkerIdentidad } from './worker.ts'

export type TipoProveedorIdentidad = 'nosis-browser' | 'demo' | 'nosis-api'

export interface ConfiguracionIdentidad {
  provider: TipoProveedorIdentidad
  maxChecksPerHour: number
  concurrency: 1
  headless: boolean
  production: boolean
  documentsKeyConfigured: boolean
  sessionKeyConfigured: boolean
  groqConfigured: boolean
  nosisCredentialsConfigured: boolean
  nosisUrlsConfigured: boolean
  problems: string[]
}

// Reads configuration without ever returning secret values.
export function leerConfiguracionIdentidad(
  env: Record<string, string | undefined>
): ConfiguracionIdentidad {
  const problems: string[] = []
  const raw = env['IDENTITY_PROVIDER']?.trim() || 'nosis-browser'
  const production = env['NODE_ENV']?.trim() === 'production'
  let provider: TipoProveedorIdentidad = 'nosis-browser'
  if (raw === 'demo' || raw === 'nosis-browser' || raw === 'nosis-api') provider = raw
  else problems.push('IDENTITY_PROVIDER must be nosis-browser or demo')
  if (provider === 'demo' && production)
    problems.push('IDENTITY_PROVIDER=demo is not allowed in production')
  if (provider === 'nosis-api') problems.push('IDENTITY_PROVIDER=nosis-api is not implemented yet')
  const max = Number(env['NOSIS_BROWSER_MAX_CHECKS_PER_HOUR'] ?? '7')
  const maxChecksPerHour = Number.isInteger(max) && max >= 1 && max <= 7 ? max : 7
  if (env['NOSIS_BROWSER_MAX_CHECKS_PER_HOUR'] && maxChecksPerHour !== max)
    problems.push('NOSIS_BROWSER_MAX_CHECKS_PER_HOUR must be an integer between 1 and 7')
  if ((env['NOSIS_BROWSER_CONCURRENCY']?.trim() || '1') !== '1')
    problems.push('NOSIS_BROWSER_CONCURRENCY must be 1')
  const keyOk = (name: string) => {
    try {
      return Boolean(env[name]?.trim()) && Buffer.from(env[name]!.trim(), 'base64').length === 32
    } catch {
      return false
    }
  }
  return {
    provider,
    maxChecksPerHour,
    concurrency: 1,
    headless: env['NOSIS_BROWSER_HEADLESS']?.trim() !== 'false',
    production,
    documentsKeyConfigured: keyOk('TUS_IDENTITY_DOCUMENTS_KEY'),
    sessionKeyConfigured: keyOk('TUS_NOSIS_SESSION_KEY'),
    groqConfigured: tieneCredencialesGroq(env),
    nosisCredentialsConfigured: Boolean(
      env['NOSIS_BROWSER_DOCUMENTO']?.trim() && env['NOSIS_BROWSER_CLAVE']?.trim()
    ),
    nosisUrlsConfigured: Boolean(
      env['NOSIS_BROWSER_LOGIN_URL']?.trim() && env['NOSIS_BROWSER_LOCALIZADOR_URL']?.trim()
    ),
    problems,
  }
}

export function providerIdDe(config: ConfiguracionIdentidad): string {
  return config.provider
}

// HTTP side: consent, uploads, submit (queue only) and admin. Never launches a browser.
export function crearServicioIdentidad(input: {
  transaction: PuertoTransaccionIdentidad
  env: Record<string, string | undefined>
  now?: () => number
}): ServicioVerificacionIdentidad {
  const config = leerConfiguracionIdentidad(input.env)
  const boveda = config.documentsKeyConfigured
    ? new BovedaCredencialesAesGcm(input.env['TUS_IDENTITY_DOCUMENTS_KEY']!.trim(), 'v1')
    : null
  return new ServicioVerificacionIdentidad(
    input.transaction,
    boveda,
    { providerId: providerIdDe(config), maxChecksPerHour: config.maxChecksPerHour },
    input.now
  )
}

export function configuracionNosisBrowser(
  env: Record<string, string | undefined>,
  overrides: Partial<ConfiguracionNosisBrowser> = {}
): ConfiguracionNosisBrowser {
  let selectors: ConfiguracionNosisBrowser['selectors']
  if (env['NOSIS_BROWSER_SELECTORS']?.trim()) {
    try {
      selectors = JSON.parse(env['NOSIS_BROWSER_SELECTORS'])
    } catch {
      throw new Error('NOSIS_BROWSER_SELECTORS must be a JSON object')
    }
  }
  return {
    loginUrl: env['NOSIS_BROWSER_LOGIN_URL']?.trim() ?? '',
    localizadorUrl: env['NOSIS_BROWSER_LOCALIZADOR_URL']?.trim() ?? '',
    documento: env['NOSIS_BROWSER_DOCUMENTO']?.trim() || undefined,
    clave: env['NOSIS_BROWSER_CLAVE'] || undefined,
    headless: env['NOSIS_BROWSER_HEADLESS']?.trim() !== 'false',
    autoLogin: env['NOSIS_BROWSER_AUTO_LOGIN']?.trim() !== 'false',
    timeoutMs: Number(env['NOSIS_BROWSER_TIMEOUT_MS'] ?? '') || 20_000,
    executablePath: env['NOSIS_BROWSER_EXECUTABLE_PATH']?.trim() || undefined,
    ...(selectors ? { selectors } : {}),
    ...overrides,
  }
}

export function crearSesionesNosis(
  env: Record<string, string | undefined>,
  backend: ConstructorParameters<typeof SesionNavegadorCifrada>[1]
): BrowserSessionStore {
  if (!leerConfiguracionIdentidad(env).sessionKeyConfigured)
    throw new Error(
      'TUS_NOSIS_SESSION_KEY (32 bytes, base64) is required to store the Mi Nosis session'
    )
  return new SesionNavegadorCifrada(
    new BovedaCredencialesAesGcm(env['TUS_NOSIS_SESSION_KEY']!.trim(), 'v1'),
    backend
  )
}

export function crearProveedorIdentidad(
  env: Record<string, string | undefined>,
  sessions: () => BrowserSessionStore
): IdentityVerificationProvider {
  const config = leerConfiguracionIdentidad(env)
  if (config.problems.length > 0)
    throw new Error(`identity configuration is invalid: ${config.problems.join('; ')}`)
  if (config.provider === 'demo') return new NosisDemoIdentityProvider()
  if (!config.nosisUrlsConfigured)
    throw new Error(
      'NOSIS_BROWSER_LOGIN_URL and NOSIS_BROWSER_LOCALIZADOR_URL are required for nosis-browser'
    )
  return new NosisBrowserIdentityProvider(configuracionNosisBrowser(env), sessions())
}

// Worker process: readers (tesseract.js OCR + Groq vision) and the configured provider.
export function crearWorkerIdentidad(input: {
  transaction: PuertoTransaccionIdentidad
  env: Record<string, string | undefined>
  sessions: () => BrowserSessionStore
  log?: LoggerWorkerIdentidad
  now?: () => number
}): WorkerVerificacionIdentidad {
  const config = leerConfiguracionIdentidad(input.env)
  if (!config.documentsKeyConfigured)
    throw new Error(
      'TUS_IDENTITY_DOCUMENTS_KEY (32 bytes, base64) is required by the identity worker'
    )
  const env = input.env
  const groqPool = crearPoolCredencialesGroq(env, {
    log: (message) => input.log?.('groq.credential.selected', { message }),
  })
  const vision = config.groqConfigured
    ? new ModeloVisionGroq({
        pool: groqPool!,
        model: env['GROQ_VISION_MODEL']?.trim() || undefined,
        responseFormat:
          env['GROQ_VISION_RESPONSE_FORMAT']?.trim() === 'json_schema'
            ? 'json_schema'
            : 'json_object',
      })
    : null
  return new WorkerVerificacionIdentidad(input.transaction, {
    provider: crearProveedorIdentidad(env, input.sessions),
    ocr: new OcrIdentityDocumentReader(
      new MotorOcrTesseract({ langPath: env['TESSERACT_LANG_PATH']?.trim() || undefined })
    ),
    vision: new VisionIdentityDocumentReader(vision),
    boveda: new BovedaCredencialesAesGcm(env['TUS_IDENTITY_DOCUMENTS_KEY']!.trim(), 'v1'),
    config: { providerId: providerIdDe(config), maxChecksPerHour: config.maxChecksPerHour },
    log: input.log,
    now: input.now,
  })
}
