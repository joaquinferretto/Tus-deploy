import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import {
  TUS_CONTRACT_VERSION,
  type CuentaCobroPrestador,
  type EstadoCuentaCobro,
} from '@factory/contracts'
import { ErrorFinanzasServicio } from './modelo.ts'

// WEB-09D: a provider (prestador) links its own Mercado Pago account through OAuth
// (authorization code + PKCE S256 + single-use state), as required by Mercado Pago's
// marketplace split: payments are created with the seller's access token and TUS takes its
// commission as `marketplace_fee`/`application_fee`. The database keeps only safe references;
// tokens are encrypted with a key that lives outside the database and are never returned.

export interface CuentaCobroDominio {
  prestadorTenantId: string
  provider: 'mercado-pago'
  status: EstadoCuentaCobro
  externalAccountId: string | null
  liveMode: boolean | null
  scopes: string[]
  connectedAt: string | null
  expiresAt: string | null
  version: number
  actorId: string
  correlationId: string
  createdAt: string
  updatedAt: string
}

export interface EstadoOAuthDominio {
  stateDigest: string
  prestadorTenantId: string
  actorId: string
  verifierCiphertext: string
  expiresAt: string
  consumedAt: string | null
  createdAt: string
}

export interface PuertoCuentasCobro {
  buscarCuenta(prestadorTenantId: string): Promise<CuentaCobroDominio | null>
  // `expectedVersion` null means "create"; returns false on a concurrent change.
  guardarCuenta(cuenta: CuentaCobroDominio, expectedVersion: number | null): Promise<boolean>
  guardarCredencial(input: {
    prestadorTenantId: string
    ciphertext: string
    keyVersion: string
    updatedAt: string
  }): Promise<void>
  borrarCredencial(prestadorTenantId: string): Promise<void>
  // WEB-09E: encrypted tokens are read only server-side to call Mercado Pago as the seller.
  leerCredencial(
    prestadorTenantId: string
  ): Promise<{ ciphertext: string; keyVersion: string } | null>
  // Maps a Mercado Pago `user_id` (collector) back to the linked provider account.
  buscarCuentaPorExterna(externalAccountId: string): Promise<CuentaCobroDominio | null>
  crearEstado(estado: EstadoOAuthDominio): Promise<void>
  // Atomically marks the state consumed; null when unknown, expired or already used.
  consumirEstado(stateDigest: string, now: string): Promise<EstadoOAuthDominio | null>
}

export class AlmacenCuentasCobroEnMemoria implements PuertoCuentasCobro {
  readonly cuentas = new Map<string, CuentaCobroDominio>()
  readonly credenciales = new Map<
    string,
    { ciphertext: string; keyVersion: string; updatedAt: string }
  >()
  readonly estados = new Map<string, EstadoOAuthDominio>()

  async buscarCuenta(prestadorTenantId: string): Promise<CuentaCobroDominio | null> {
    const cuenta = this.cuentas.get(prestadorTenantId)
    return cuenta ? { ...cuenta, scopes: [...cuenta.scopes] } : null
  }

  async guardarCuenta(
    cuenta: CuentaCobroDominio,
    expectedVersion: number | null
  ): Promise<boolean> {
    const current = this.cuentas.get(cuenta.prestadorTenantId)
    if ((current?.version ?? null) !== expectedVersion) return false
    this.cuentas.set(cuenta.prestadorTenantId, { ...cuenta, scopes: [...cuenta.scopes] })
    return true
  }

  async guardarCredencial(input: {
    prestadorTenantId: string
    ciphertext: string
    keyVersion: string
    updatedAt: string
  }): Promise<void> {
    this.credenciales.set(input.prestadorTenantId, { ...input })
  }

  async borrarCredencial(prestadorTenantId: string): Promise<void> {
    this.credenciales.delete(prestadorTenantId)
  }

  async leerCredencial(
    prestadorTenantId: string
  ): Promise<{ ciphertext: string; keyVersion: string } | null> {
    const credential = this.credenciales.get(prestadorTenantId)
    return credential
      ? { ciphertext: credential.ciphertext, keyVersion: credential.keyVersion }
      : null
  }

  async buscarCuentaPorExterna(externalAccountId: string): Promise<CuentaCobroDominio | null> {
    const cuenta = [...this.cuentas.values()].find(
      (item) => item.externalAccountId === externalAccountId && item.status === 'connected'
    )
    return cuenta ? { ...cuenta, scopes: [...cuenta.scopes] } : null
  }

  async crearEstado(estado: EstadoOAuthDominio): Promise<void> {
    if (this.estados.has(estado.stateDigest))
      throw new ErrorFinanzasServicio(409, 'CONFLICT', 'oauth state already exists')
    this.estados.set(estado.stateDigest, { ...estado })
  }

  async consumirEstado(stateDigest: string, now: string): Promise<EstadoOAuthDominio | null> {
    const estado = this.estados.get(stateDigest)
    if (!estado || estado.consumedAt || Date.parse(estado.expiresAt) <= Date.parse(now)) return null
    const consumed = { ...estado, consumedAt: now }
    this.estados.set(stateDigest, consumed)
    return consumed
  }
}

// AES-256-GCM envelope `v1.<iv>.<tag>.<ciphertext>` (base64url). The additional authenticated
// data binds each ciphertext to its tenant, so a row copied to another tenant fails to decrypt.
export class BovedaCredencialesAesGcm {
  private readonly key: Buffer

  constructor(
    keyBase64: string,
    readonly keyVersion = 'v1'
  ) {
    const key = Buffer.from(keyBase64.trim(), 'base64')
    if (key.length !== 32)
      throw new Error('TUS_PAYMENT_CREDENTIALS_KEY must be 32 bytes encoded in base64')
    this.key = key
  }

  cifrar(plaintext: string, aad: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return [this.keyVersion, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.')
  }

  descifrar(envelope: string, aad: string): string {
    const [version, iv, tag, ciphertext] = envelope.split('.')
    if (version !== this.keyVersion || !iv || !tag || ciphertext === undefined)
      throw new ErrorFinanzasServicio(
        500,
        'CREDENTIAL_UNREADABLE',
        'credential envelope is invalid'
      )
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'))
      decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      throw new ErrorFinanzasServicio(
        500,
        'CREDENTIAL_UNREADABLE',
        'credential cannot be decrypted'
      )
    }
  }
}

export interface TokenOAuthMercadoPago {
  accessToken: string
  refreshToken: string | null
  publicKey: string | null
  userId: string
  scopes: string[]
  liveMode: boolean | null
  expiresInSeconds: number | null
}

export interface PuertoOAuthMercadoPago {
  intercambiarCodigo(input: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<TokenOAuthMercadoPago>
  // grant_type=refresh_token. Mercado Pago rotates the refresh token on every renewal.
  renovarToken(input: { refreshToken: string }): Promise<TokenOAuthMercadoPago>
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

// POST https://api.mercadopago.com/oauth/token (grant_type=authorization_code). Error bodies are
// never propagated: they can echo credentials.
export class ClienteOAuthMercadoPagoHttp implements PuertoOAuthMercadoPago {
  constructor(
    private readonly options: {
      clientId: string
      clientSecret: string
      testToken: boolean
      fetch?: FetchLike
      baseUrl?: string
      timeoutMs?: number
    }
  ) {}

  async intercambiarCodigo(input: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<TokenOAuthMercadoPago> {
    return this.solicitarToken({
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    })
  }

  async renovarToken(input: { refreshToken: string }): Promise<TokenOAuthMercadoPago> {
    return this.solicitarToken({ grant_type: 'refresh_token', refresh_token: input.refreshToken })
  }

  private async solicitarToken(grant: Record<string, string>): Promise<TokenOAuthMercadoPago> {
    const fetchImpl = this.options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await fetchImpl(
        `${this.options.baseUrl ?? 'https://api.mercadopago.com'}/oauth/token`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            client_id: this.options.clientId,
            client_secret: this.options.clientSecret,
            ...grant,
            ...(grant['grant_type'] === 'authorization_code'
              ? { test_token: this.options.testToken ? 'true' : 'false' }
              : {}),
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        }
      )
    } catch {
      throw new ErrorFinanzasServicio(
        502,
        'PROVIDER_OAUTH_FAILED',
        'Mercado Pago OAuth is unreachable'
      )
    }
    if (!response.ok)
      throw new ErrorFinanzasServicio(
        502,
        'PROVIDER_OAUTH_FAILED',
        `Mercado Pago OAuth rejected the authorization (HTTP ${response.status})`
      )
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const accessToken = typeof body?.['access_token'] === 'string' ? body['access_token'] : ''
    const userId = body?.['user_id']
    if (!accessToken || (typeof userId !== 'string' && typeof userId !== 'number'))
      throw new ErrorFinanzasServicio(
        502,
        'PROVIDER_OAUTH_FAILED',
        'Mercado Pago OAuth response is incomplete'
      )
    return {
      accessToken,
      refreshToken: typeof body?.['refresh_token'] === 'string' ? body['refresh_token'] : null,
      publicKey: typeof body?.['public_key'] === 'string' ? body['public_key'] : null,
      userId: String(userId),
      scopes:
        typeof body?.['scope'] === 'string' ? body['scope'].split(/\s+/u).filter(Boolean) : [],
      liveMode: typeof body?.['live_mode'] === 'boolean' ? body['live_mode'] : null,
      expiresInSeconds:
        typeof body?.['expires_in'] === 'number' && Number.isFinite(body['expires_in'])
          ? body['expires_in']
          : null,
    }
  }
}

export interface ConfiguracionOAuthCobro {
  clientId: string
  redirectUri: string
  webBaseUrl: string
  authorizationUrl?: string
  stateTtlMs?: number
}

// Renew the seller token when it expires within 7 days (tokens last 180 days).
export const RENOVACION_ANTICIPADA_MS = 7 * 24 * 60 * 60 * 1000

export class ServicioCuentasCobro {
  constructor(
    private readonly store: PuertoCuentasCobro,
    // All three are null while OAuth is not configured; every mutation then fails closed.
    private readonly config: ConfiguracionOAuthCobro | null,
    private readonly boveda: BovedaCredencialesAesGcm | null,
    private readonly oauth: PuertoOAuthMercadoPago | null,
    private readonly now: () => number = () => Date.now(),
    // IDENTITY-NOSIS: Mercado Pago can only be linked after the identity is verified.
    private readonly identidadVerificada: ((tenantId: string) => Promise<boolean>) | null = null
  ) {}

  get disponible(): boolean {
    return Boolean(this.config && this.boveda && this.oauth)
  }

  async estadoCuenta(context: {
    tenantId: string
  }): Promise<CuentaCobroPrestador & { connectAvailable: boolean }> {
    const cuenta = await this.store.buscarCuenta(context.tenantId)
    return {
      ...proyectarCuenta(context.tenantId, cuenta, this.now()),
      connectAvailable: this.disponible,
    }
  }

  // A linked account stays usable while its status is `connected`: an access token close to
  // expiry is renewed on use. A failed renewal moves the account to `expired` (reconnect).
  async cuentaConectada(prestadorTenantId: string): Promise<boolean> {
    const cuenta = await this.store.buscarCuenta(prestadorTenantId)
    return cuenta?.status === 'connected'
  }

  async cuentaPorExterna(externalAccountId: string): Promise<CuentaCobroDominio | null> {
    return this.store.buscarCuentaPorExterna(externalAccountId)
  }

  // Server-side only: returns the seller access token to call Mercado Pago on its behalf,
  // renewing it first when it expires within RENOVACION_ANTICIPADA_MS. Never logged/returned.
  async tokenVigente(
    prestadorTenantId: string
  ): Promise<{ accessToken: string; externalAccountId: string }> {
    const boveda = this.boveda
    const cuenta = await this.store.buscarCuenta(prestadorTenantId)
    if (!boveda || !cuenta || cuenta.status !== 'connected' || !cuenta.externalAccountId)
      throw new ErrorFinanzasServicio(
        503,
        'PROVIDER_ACCOUNT_NOT_CONNECTED',
        'the provider has no connected Mercado Pago account'
      )
    const stored = await this.store.leerCredencial(prestadorTenantId)
    if (!stored) {
      await this.marcarCuenta(cuenta, 'expired', 'system:token-refresh')
      throw new ErrorFinanzasServicio(
        503,
        'PROVIDER_ACCOUNT_NOT_CONNECTED',
        'provider credentials are missing'
      )
    }
    const aad = `payment-account:${prestadorTenantId}`
    const tokens = JSON.parse(boveda.descifrar(stored.ciphertext, aad)) as {
      accessToken: string
      refreshToken: string | null
      publicKey: string | null
    }
    const expiresAt = cuenta.expiresAt ? Date.parse(cuenta.expiresAt) : null
    if (expiresAt === null || expiresAt - this.now() > RENOVACION_ANTICIPADA_MS)
      return { accessToken: tokens.accessToken, externalAccountId: cuenta.externalAccountId }
    const stillValid = expiresAt > this.now()
    if (!tokens.refreshToken || !this.oauth) {
      if (stillValid)
        return { accessToken: tokens.accessToken, externalAccountId: cuenta.externalAccountId }
      await this.marcarCuenta(cuenta, 'expired', 'system:token-refresh')
      throw new ErrorFinanzasServicio(
        503,
        'PROVIDER_ACCOUNT_NOT_CONNECTED',
        'provider authorization expired'
      )
    }
    let renewed: TokenOAuthMercadoPago
    try {
      renewed = await this.oauth.renovarToken({ refreshToken: tokens.refreshToken })
    } catch {
      // A transient failure keeps a still valid token; an expired one fails closed.
      if (stillValid)
        return { accessToken: tokens.accessToken, externalAccountId: cuenta.externalAccountId }
      await this.marcarCuenta(cuenta, 'expired', 'system:token-refresh')
      throw new ErrorFinanzasServicio(
        503,
        'PROVIDER_ACCOUNT_NOT_CONNECTED',
        'provider authorization expired'
      )
    }
    if (renewed.userId !== cuenta.externalAccountId) {
      await this.marcarCuenta(cuenta, 'error', 'system:token-refresh')
      throw new ErrorFinanzasServicio(
        503,
        'PROVIDER_ACCOUNT_NOT_CONNECTED',
        'renewed token belongs to another account'
      )
    }
    const nowIso = new Date(this.now()).toISOString()
    await this.store.guardarCredencial({
      prestadorTenantId,
      ciphertext: boveda.cifrar(
        JSON.stringify({
          accessToken: renewed.accessToken,
          refreshToken: renewed.refreshToken ?? tokens.refreshToken,
          publicKey: renewed.publicKey ?? tokens.publicKey,
        }),
        aad
      ),
      keyVersion: boveda.keyVersion,
      updatedAt: nowIso,
    })
    await this.store.guardarCuenta(
      {
        ...cuenta,
        scopes: renewed.scopes.length > 0 ? renewed.scopes : cuenta.scopes,
        expiresAt:
          renewed.expiresInSeconds === null
            ? null
            : new Date(this.now() + renewed.expiresInSeconds * 1000).toISOString(),
        version: cuenta.version + 1,
        actorId: 'system:token-refresh',
        updatedAt: nowIso,
      },
      cuenta.version
    )
    return { accessToken: renewed.accessToken, externalAccountId: cuenta.externalAccountId }
  }

  private async marcarCuenta(
    cuenta: CuentaCobroDominio,
    status: EstadoCuentaCobro,
    actorId: string
  ): Promise<void> {
    await this.store.guardarCuenta(
      {
        ...cuenta,
        status,
        version: cuenta.version + 1,
        actorId,
        updatedAt: new Date(this.now()).toISOString(),
      },
      cuenta.version
    )
  }

  async iniciarConexion(context: {
    tenantId: string
    actorId: string
    correlationId: string
  }): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const { config, boveda } = this.requerirConfiguracion()
    if (this.identidadVerificada && !(await this.identidadVerificada(context.tenantId)))
      throw new ErrorFinanzasServicio(
        403,
        'PROVIDER_IDENTITY_NOT_VERIFIED',
        'verify your identity before linking a payment account'
      )
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const createdAt = new Date(this.now()).toISOString()
    const expiresAt = new Date(this.now() + (config.stateTtlMs ?? 10 * 60_000)).toISOString()
    await this.store.crearEstado({
      stateDigest: huella(state),
      prestadorTenantId: context.tenantId,
      actorId: context.actorId,
      verifierCiphertext: boveda.cifrar(verifier, `oauth-state:${context.tenantId}`),
      expiresAt,
      consumedAt: null,
      createdAt,
    })
    const url = new URL(config.authorizationUrl ?? 'https://auth.mercadopago.com/authorization')
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('platform_id', 'mp')
    url.searchParams.set('state', state)
    url.searchParams.set('redirect_uri', config.redirectUri)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    return { authorizationUrl: url.toString(), expiresAt }
  }

  // Browser callback from Mercado Pago. Authority comes only from the single-use state; the
  // result is always a redirect to the Web, never a token or a provider error body.
  async completarConexion(input: {
    code: string
    state: string
    correlationId: string
  }): Promise<{ redirectUrl: string; status: 'connected' | 'error'; reason: string | null }> {
    const webBaseUrl = this.config?.webBaseUrl ?? null
    const redirect = (status: 'connected' | 'error', reason: string | null) => ({
      status,
      reason,
      redirectUrl: webBaseUrl
        ? `${webBaseUrl.replace(/\/+$/u, '')}/tus/prestador?mercadoPago=${status}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`
        : '',
    })
    if (!this.disponible) return redirect('error', 'PROVIDER_NOT_CONFIGURED')
    const { config, boveda, oauth } = this.requerirConfiguracion()
    if (
      !/^[A-Za-z0-9_-]{20,200}$/u.test(input.state) ||
      !input.code.trim() ||
      input.code.length > 500
    )
      return redirect('error', 'INVALID_STATE')
    const nowIso = new Date(this.now()).toISOString()
    const estado = await this.store.consumirEstado(huella(input.state), nowIso)
    if (!estado) return redirect('error', 'INVALID_STATE')
    try {
      const verifier = boveda.descifrar(
        estado.verifierCiphertext,
        `oauth-state:${estado.prestadorTenantId}`
      )
      const token = await oauth.intercambiarCodigo({
        code: input.code.trim(),
        codeVerifier: verifier,
        redirectUri: config.redirectUri,
      })
      await this.store.guardarCredencial({
        prestadorTenantId: estado.prestadorTenantId,
        ciphertext: boveda.cifrar(
          JSON.stringify({
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            publicKey: token.publicKey,
          }),
          `payment-account:${estado.prestadorTenantId}`
        ),
        keyVersion: boveda.keyVersion,
        updatedAt: nowIso,
      })
      const current = await this.store.buscarCuenta(estado.prestadorTenantId)
      const saved = await this.store.guardarCuenta(
        {
          prestadorTenantId: estado.prestadorTenantId,
          provider: 'mercado-pago',
          status: 'connected',
          externalAccountId: token.userId,
          liveMode: token.liveMode,
          scopes: token.scopes,
          connectedAt: nowIso,
          expiresAt:
            token.expiresInSeconds === null
              ? null
              : new Date(this.now() + token.expiresInSeconds * 1000).toISOString(),
          version: (current?.version ?? 0) + 1,
          actorId: estado.actorId,
          correlationId: input.correlationId,
          createdAt: current?.createdAt ?? nowIso,
          updatedAt: nowIso,
        },
        current?.version ?? null
      )
      if (!saved) return redirect('error', 'CONCURRENT_MODIFICATION')
      return redirect('connected', null)
    } catch (error) {
      return redirect(
        'error',
        error instanceof ErrorFinanzasServicio ? error.code : 'PROVIDER_OAUTH_FAILED'
      )
    }
  }

  // Local unlink: deletes the encrypted tokens and marks the account revoked. Revoking the
  // grant inside Mercado Pago is done by the provider from their Mercado Pago account.
  async desconectar(context: {
    tenantId: string
    actorId: string
    correlationId: string
  }): Promise<CuentaCobroPrestador> {
    const current = await this.store.buscarCuenta(context.tenantId)
    await this.store.borrarCredencial(context.tenantId)
    if (!current) return proyectarCuenta(context.tenantId, null, this.now())
    const nowIso = new Date(this.now()).toISOString()
    const next: CuentaCobroDominio = {
      ...current,
      status: 'revoked',
      version: current.version + 1,
      actorId: context.actorId,
      correlationId: context.correlationId,
      updatedAt: nowIso,
    }
    if (!(await this.store.guardarCuenta(next, current.version)))
      throw new ErrorFinanzasServicio(
        409,
        'CONCURRENT_MODIFICATION',
        'payment account changed concurrently'
      )
    return proyectarCuenta(context.tenantId, next, this.now())
  }

  private requerirConfiguracion(): {
    config: ConfiguracionOAuthCobro
    boveda: BovedaCredencialesAesGcm
    oauth: PuertoOAuthMercadoPago
  } {
    if (!this.config || !this.boveda || !this.oauth)
      throw new ErrorFinanzasServicio(
        503,
        'PROVIDER_NOT_CONFIGURED',
        'Mercado Pago account linking is not configured'
      )
    return { config: this.config, boveda: this.boveda, oauth: this.oauth }
  }
}

export function proyectarCuenta(
  prestadorTenantId: string,
  cuenta: CuentaCobroDominio | null,
  now: number
): CuentaCobroPrestador {
  void now
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    prestadorTenantId,
    provider: 'mercado-pago',
    status: !cuenta ? 'not_connected' : cuenta.status,
    externalAccountId: cuenta?.externalAccountId ?? null,
    liveMode: cuenta?.liveMode ?? null,
    scopes: cuenta?.scopes ?? [],
    connectedAt: cuenta?.connectedAt ?? null,
    expiresAt: cuenta?.expiresAt ?? null,
    updatedAt: cuenta?.updatedAt ?? null,
  }
}

function huella(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex')
}
