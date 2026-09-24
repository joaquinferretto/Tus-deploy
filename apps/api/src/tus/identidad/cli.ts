import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
  BackendSesionPrisma,
  TransaccionIdentidadPrisma,
  type ClientePrismaIdentidad,
} from '../adapters/prisma-identidad.ts'
import {
  configuracionNosisBrowser,
  crearSesionesNosis,
  crearWorkerIdentidad,
  leerConfiguracionIdentidad,
} from './composicion.ts'
import {
  compararNombre,
  enmascararCuil,
  enmascararDni,
  normalizarDni,
  validarCuil,
} from './modelo.ts'
import { NosisBrowserIdentityProvider } from './nosis-browser.ts'
import { ErrorProveedorIdentidad } from './proveedor.ts'
import { VENTANA_LIMITE_MS, marcarSesionRestaurada } from './worker.ts'

// IDENTITY-NOSIS command line (root package.json):
//   pnpm tus:identity:worker        separate worker process (concurrency 1)
//   pnpm tus:identity:nosis-login   headful Chromium: a human logs into Mi Nosis (and completes
//                                   any external challenge by hand); the session is stored
//                                   encrypted and the worker resumes
//   pnpm tus:identity:nosis-check -- --dni <DNI> --confirm
//                                   ONE authorized real search; consumes a 7/hour slot; output
//                                   is redacted (counts and masked values only)
// Never prints secrets, cookies, full DNI/CUIL or page HTML.

const env = process.env
const command = process.argv[2]
const out = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }))

async function main() {
  const config = leerConfiguracionIdentidad(env)
  if (config.problems.length > 0) {
    out('identity.config_invalid', { problems: config.problems })
    process.exitCode = 2
    return
  }
  const prisma = new PrismaClient({ log: ['error'] })
  const client = prisma as unknown as ClientePrismaIdentidad
  const transaction = new TransaccionIdentidadPrisma(client)
  const sessions = () => crearSesionesNosis(env, new BackendSesionPrisma(client))
  try {
    if (command === 'worker') await worker(transaction, sessions)
    else if (command === 'nosis-login') await login(transaction, sessions)
    else if (command === 'nosis-check') await check(transaction, sessions)
    else {
      out('identity.usage', {
        commands: ['worker', 'nosis-login', 'nosis-check --dni <DNI> --confirm'],
      })
      process.exitCode = 2
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function worker(
  transaction: TransaccionIdentidadPrisma,
  sessions: () => ReturnType<typeof crearSesionesNosis>
) {
  const config = leerConfiguracionIdentidad(env)
  out('identity.worker_starting', {
    provider: config.provider,
    maxChecksPerHour: config.maxChecksPerHour,
    headless: config.headless,
    documentsKey: config.documentsKeyConfigured,
    sessionKey: config.sessionKeyConfigured,
    groq: config.groqConfigured,
    nosisCredentials: config.nosisCredentialsConfigured,
  })
  const controller = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => controller.abort())
  const instance = crearWorkerIdentidad({
    transaction,
    env,
    sessions,
    log: (event, fields) => out(event, fields),
  })
  out('identity.worker_started', { workerId: instance.workerId })
  await instance.ejecutar({
    signal: controller.signal,
    idleMs: Number(env['IDENTITY_WORKER_IDLE_MS'] ?? '') || 5_000,
    onCycle: (result) => {
      if (result.outcome !== 'idle' && result.outcome !== 'paused')
        out('identity.cycle', { ...result })
    },
  })
  out('identity.worker_stopped')
}

async function login(
  transaction: TransaccionIdentidadPrisma,
  sessions: () => ReturnType<typeof crearSesionesNosis>
) {
  const config = leerConfiguracionIdentidad(env)
  if (config.provider !== 'nosis-browser' || !config.nosisUrlsConfigured) {
    out('identity.login_unavailable', {
      reason: 'IDENTITY_PROVIDER=nosis-browser and NOSIS_BROWSER_*_URL are required',
    })
    process.exitCode = 2
    return
  }
  const provider = new NosisBrowserIdentityProvider(
    configuracionNosisBrowser(env, { headless: false }),
    sessions()
  )
  const waitMs = Number(env['NOSIS_LOGIN_WAIT_MS'] ?? '') || 10 * 60_000
  out('identity.login_waiting', {
    waitMinutes: Math.round(waitMs / 60_000),
    note: 'complete the Mi Nosis login in the Chromium window',
  })
  try {
    await provider.loginInteractivo({ waitMs })
    const state = await marcarSesionRestaurada(transaction, config.provider, 'operator:nosis-login')
    out('identity.login_saved', { encrypted: true, workerStatus: state.status })
  } catch {
    out('identity.login_failed', { reason: 'session was not confirmed before the timeout' })
    process.exitCode = 1
  } finally {
    await provider.cerrar()
  }
}

async function check(
  transaction: TransaccionIdentidadPrisma,
  sessions: () => ReturnType<typeof crearSesionesNosis>
) {
  const config = leerConfiguracionIdentidad(env)
  const args = process.argv.slice(3)
  const dni = normalizarDni(args[args.indexOf('--dni') + 1] ?? null)
  const expectedName = args.includes('--name') ? (args[args.indexOf('--name') + 1] ?? null) : null
  if (
    config.provider !== 'nosis-browser' ||
    !config.nosisUrlsConfigured ||
    !dni ||
    !args.includes('--confirm')
  ) {
    out('identity.check_refused', {
      reason:
        'requires IDENTITY_PROVIDER=nosis-browser, NOSIS_BROWSER_*_URL, --dni <DNI> of an authorized person and --confirm',
    })
    process.exitCode = 2
    return
  }
  const provider = new NosisBrowserIdentityProvider(configuracionNosisBrowser(env), sessions())
  let slot: { granted: boolean; used: number; nextEligibleAt: string | null } | null = null
  try {
    await provider.prepararSesion()
    const result = await provider.consultar({ documentNumber: dni }, async () => {
      slot = await transaction.ejecutar((repositories) =>
        repositories.limite.reservar({
          providerId: config.provider,
          verificationId: 'manual-smoke-check',
          max: config.maxChecksPerHour,
          windowMs: VENTANA_LIMITE_MS,
          now: new Date().toISOString(),
        })
      )
      return slot.granted
    })
    out('identity.check_result', {
      document: enmascararDni(dni),
      resultCount: result.results.length,
      results: result.results.map((person) => ({
        document: enmascararDni(person.documentNumber),
        documentMatches: normalizarDni(person.documentNumber) === dni,
        cuil: person.cuil ? enmascararCuil(person.cuil) : null,
        cuilValid: validarCuil(person.cuil, dni).valid,
        nameReadable: Boolean(person.fullName),
        ...(expectedName
          ? {
              nameMatch: compararNombre(
                {
                  firstName: expectedName.split(',')[1] ?? null,
                  lastName: expectedName.split(',')[0] ?? null,
                },
                person.fullName
              ),
            }
          : {}),
      })),
      slotsUsed: (slot as { used: number } | null)?.used ?? null,
      max: config.maxChecksPerHour,
    })
  } catch (error) {
    out('identity.check_failed', {
      code: error instanceof ErrorProveedorIdentidad ? error.code : 'UNEXPECTED',
      searchSubmitted: error instanceof ErrorProveedorIdentidad ? error.searchSubmitted : null,
      nextEligibleAt: (slot as { nextEligibleAt: string | null } | null)?.nextEligibleAt ?? null,
    })
    process.exitCode = 1
  } finally {
    await provider.cerrar()
  }
}

main().catch(() => {
  out('identity.cli_failed')
  process.exitCode = 1
})
