import express from 'express'
import type { Request, Response, Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../../tus/ports/index.ts'

// MODOS-01. ONE account, two ways of using TUS.
//
// - Identity: the account. There is no "client account" and "provider account".
// - Capabilities: what the account can really do. Every active account can act as a CLIENT; an
//   account whose provider (merchant) exists and is APPROVED can also act as a PROVIDER. They are
//   always derived here, on the server, from the real state — never from what a client sends.
// - Mode: how the person is using TUS right now (home, navigation, the view of shared screens).
//   It is CONTEXT. It grants nothing: every operation is authorized by the real capability, and a
//   stored mode that is no longer valid is ignored.
//
// The state of the ACCOUNT and the state of the PROVIDER are separate. A suspended account cannot
// do anything (its session does not even resolve). A suspended PROVIDER only loses the provider
// side: the same person keeps using TUS as a client.

export const MODOS = ['CLIENT', 'PROVIDER'] as const
export type Modo = (typeof MODOS)[number]

// The provider side of an account: none, approved (can operate) or suspended by the administration.
export type EstadoPrestadorCuenta = 'none' | 'approved' | 'suspended'

export interface ModosDeSesion {
  availableModes: Modo[]
  // null: both modes are available and the person has not chosen yet (the Web asks).
  activeMode: Modo | null
  providerStatus: EstadoPrestadorCuenta
  // The stored mode was PROVIDER and it is not available any more: the session fell back to CLIENT.
  modeNotice?: 'provider_unavailable'
}

const esModo = (value: unknown): value is Modo => typeof value === 'string' && (MODOS as readonly string[]).includes(value)

// The state of the merchant as the account sees it. Anything that is not exactly "approved" or
// "suspended" (an unknown or future state) is NOT an enabled provider.
export function estadoPrestadorDeCuenta(merchant: { status?: unknown } | null | undefined): EstadoPrestadorCuenta {
  if (!merchant) return 'none'
  return merchant.status === 'approved' ? 'approved' : 'suspended'
}

// Pure: the modes of a session from the real provider state and what is stored. Stored values are
// a preference; they are never trusted.
export function resolverModos(input: { estadoPrestador: EstadoPrestadorCuenta; activeMode: unknown; lastMode: unknown }): ModosDeSesion {
  const availableModes: Modo[] = input.estadoPrestador === 'approved' ? ['CLIENT', 'PROVIDER'] : ['CLIENT']
  const base = { availableModes, providerStatus: input.estadoPrestador }
  const disponible = (modo: unknown): modo is Modo => esModo(modo) && availableModes.includes(modo)
  if (disponible(input.activeMode)) return { ...base, activeMode: input.activeMode }
  // The session was working as a provider and that is no longer possible.
  if (input.activeMode === 'PROVIDER') return { ...base, activeMode: 'CLIENT', modeNotice: 'provider_unavailable' }
  if (availableModes.length === 1) return { ...base, activeMode: 'CLIENT' }
  // Both are available and this session has not chosen: the last mode, when it is still valid.
  return { ...base, activeMode: disponible(input.lastMode) ? input.lastMode : null }
}

export interface AlmacenModos {
  leer(sessionId: string, accountId: string): Promise<{ activeMode: string | null; lastMode: string | null }>
  // The mode of THIS session.
  fijarSesion(sessionId: string, accountId: string, modo: Modo): Promise<void>
  // The preference of the account for its next sign-in.
  fijarPreferencia(accountId: string, modo: Modo): Promise<void>
}

export class AlmacenModosEnMemoria implements AlmacenModos {
  readonly sesiones = new Map<string, string>()
  readonly cuentas = new Map<string, string>()

  async leer(sessionId: string, accountId: string) {
    return { activeMode: this.sesiones.get(`${accountId}|${sessionId}`) ?? null, lastMode: this.cuentas.get(accountId) ?? null }
  }

  async fijarSesion(sessionId: string, accountId: string, modo: Modo) {
    this.sesiones.set(`${accountId}|${sessionId}`, modo)
  }

  async fijarPreferencia(accountId: string, modo: Modo) {
    this.cuentas.set(accountId, modo)
  }
}

interface ClienteSqlModos {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

// PostgreSQL: "Session"."activeMode" and "Account"."lastMode" (20261106100000). A session is only
// ever touched together with ITS account.
export class AlmacenModosPrisma implements AlmacenModos {
  constructor(private readonly client: ClienteSqlModos) {}

  async leer(sessionId: string, accountId: string) {
    const filas = await this.client.$queryRawUnsafe<{ activeMode: string | null; lastMode: string | null }[]>(
      'SELECT s."activeMode", a."lastMode" FROM public."Account" a LEFT JOIN public."Session" s ON s."accountId" = a."id" AND s."id" = $1 WHERE a."id" = $2',
      sessionId, accountId
    )
    return { activeMode: filas[0]?.activeMode ?? null, lastMode: filas[0]?.lastMode ?? null }
  }

  async fijarSesion(sessionId: string, accountId: string, modo: Modo) {
    await this.client.$executeRawUnsafe('UPDATE public."Session" SET "activeMode" = $3 WHERE "id" = $1 AND "accountId" = $2', sessionId, accountId, modo)
  }

  async fijarPreferencia(accountId: string, modo: Modo) {
    await this.client.$executeRawUnsafe('UPDATE public."Account" SET "lastMode" = $2 WHERE "id" = $1', accountId, modo)
  }
}

export class ServicioModos {
  constructor(
    private readonly almacen: AlmacenModos,
    // The REAL provider state of the tenant of the session.
    private readonly estadoPrestador: (context: TusAuthenticatedTenantContext) => Promise<EstadoPrestadorCuenta>
  ) {}

  // The modes of a session. What it resolves is remembered in the session, so another session of
  // the same account changing its preference does not move this one.
  async deSesion(context: TusAuthenticatedTenantContext): Promise<ModosDeSesion> {
    const estado = await this.estadoPrestador(context)
    const guardado = await this.almacen.leer(context.sessionId, context.subjectId).catch(() => ({ activeMode: null, lastMode: null }))
    const modos = resolverModos({ estadoPrestador: estado, ...guardado })
    if (modos.activeMode && modos.activeMode !== guardado.activeMode) await this.almacen.fijarSesion(context.sessionId, context.subjectId, modos.activeMode).catch(() => undefined)
    return modos
  }

  // The person chooses a mode. PROVIDER only with the real capability, checked now.
  async cambiar(context: TusAuthenticatedTenantContext, modo: Modo): Promise<{ ok: true; modos: ModosDeSesion } | { ok: false; providerStatus: EstadoPrestadorCuenta }> {
    const estado = await this.estadoPrestador(context)
    const disponibles = resolverModos({ estadoPrestador: estado, activeMode: null, lastMode: null }).availableModes
    if (!disponibles.includes(modo)) return { ok: false, providerStatus: estado }
    await this.almacen.fijarSesion(context.sessionId, context.subjectId, modo)
    await this.almacen.fijarPreferencia(context.subjectId, modo)
    return { ok: true, modos: { availableModes: disponibles, activeMode: modo, providerStatus: estado } }
  }
}

async function autenticar(request: Request, sessions: TusSessionResolverPort): Promise<TusAuthenticatedTenantContext | null> {
  const authorization = request.header('authorization') ?? ''
  const correlationId = request.header('x-correlation-id')?.trim() ?? ''
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
  if (!accessToken || !correlationId) return null
  return sessions.resolve(accessToken, correlationId)
}

// POST /auth/session/mode { mode } — the only field. The account, the tenant and the session come
// from the session; nothing else in the body exists.
export function createModeRouter({ servicio, sessions }: { servicio: ServicioModos; sessions: TusSessionResolverPort }): Router {
  const router = express.Router()
  router.post('/auth/session/mode', asyncHandler(async (request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    const context = await autenticar(request, sessions)
    if (!context) return void response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'authentication required' } })
    const body = typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : {}
    const desconocidos = Object.keys(body).filter((key) => key !== 'mode')
    if (desconocidos.length > 0) return void response.status(422).json({ error: { code: 'INVALID_REQUEST', message: 'unknown fields' }, fields: desconocidos })
    if (!esModo(body['mode'])) return void response.status(422).json({ error: { code: 'INVALID_MODE', message: 'mode must be CLIENT or PROVIDER' }, fields: ['mode'] })
    const resultado = await servicio.cambiar(context, body['mode'])
    if (!resultado.ok) return void response.status(403).json({ error: { code: 'MODE_NOT_AVAILABLE', message: 'this account cannot use that mode' }, providerStatus: resultado.providerStatus })
    response.status(200).json(resultado.modos)
  }))
  return router
}

// A SUSPENDED provider cannot operate professionally, whatever the channel or the screen: every
// write on the provider surface of the API is refused, and so is taking new work. Reading stays
// (history, earnings, past works), and so does everything the same person does as a client.
const SUPERFICIE_PRESTADOR = /^\/tus\/v1\/(?:prestador|provider)\//u
const TOMAR_TRABAJO = /^\/tus(?:\/v1)?\/(?:work|trabajos)\/commitments\/[^/]+\/accept$/u

export function createProviderSuspensionGuard({ sessions, estadoPrestador }: { sessions: TusSessionResolverPort; estadoPrestador: (context: TusAuthenticatedTenantContext) => Promise<EstadoPrestadorCuenta> }): express.RequestHandler {
  return asyncHandler(async (request: Request, response: Response, next: express.NextFunction) => {
    const escritura = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    if (!escritura || !(SUPERFICIE_PRESTADOR.test(request.path) || TOMAR_TRABAJO.test(request.path))) return void next()
    const context = await autenticar(request, sessions).catch(() => null)
    // No session: the route itself answers (401).
    if (!context) return void next()
    if ((await estadoPrestador(context)) === 'suspended') {
      response.setHeader('cache-control', 'no-store')
      return void response.status(403).json({ code: 'PROVIDER_SUSPENDED', error: 'Tu perfil de prestador está suspendido. Podés seguir usando TUS como cliente.' })
    }
    next()
  })
}
