import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Google sign-in / sign-up through the TUS auth boundary. A fake OIDC provider stands in for
// Google in flows; the real GoogleOidcProvider is exercised with locally generated RSA keys.
const SETUP = `
  const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { createFederatedAuth, readGoogleAuthSettings } = await import('./apps/api/src/auth-security/federated/composition.ts')
  const { googleProviderConfig } = await import('./apps/api/src/auth-security/oauth-oidc/adapters/google.ts')
  const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
  let now = Date.parse('2026-09-25T12:00:00.000Z')
  const clock = () => now
  const auth = createInMemoryAuthService({ now: clock })
  const identities = new Map()
  // Fake Google: each authorization code maps to an identity; the nonce is echoed back.
  const provider = {
    config: googleProviderConfig('google-client-id', true),
    codes: new Map(),
    async exchangeCode(input) {
      const identity = this.codes.get(input.code)
      if (!identity || !input.codeVerifier) return undefined
      return { issuer: 'https://accounts.google.com', audience: 'google-client-id', nonce: input.expectedNonce, expiresAt: now + 60_000, emailVerified: true, name: null, ...identity }
    },
  }
  const settings = { clientId: 'google-client-id', clientSecret: 'fictitious-google-secret', redirectUri: 'https://api.tus.test/auth/oauth/google/callback', webBaseUrl: 'https://web.tus.test' }
  const federated = createFederatedAuth({ auth: auth.service, identityStore: auth.store, audit: auth.audit, settings, provider, now: clock })
  const google = federated.service
  const sessions = new DurableIdentitySessionResolver(auth.store, clock)
  async function googleCallback(identity, override = {}) {
    const started = await google.start()
    const state = new URL(started.authorizationUrl).searchParams.get('state')
    const code = 'auth-code-' + Math.random().toString(36).slice(2)
    provider.codes.set(code, identity)
    return (await google.callback({ state, code, error: undefined, ...override })).redirectTo
  }
  const fragment = (url, key) => new URL(url).hash.slice(1).split('&').map((p) => p.split('=')).find(([k]) => k === key)?.[1]
  async function passwordAccount(email) {
    const registered = await auth.register({ email, password: 'Contrasena-Segura-2026', displayName: 'Ana Pérez' })
    await auth.verifyEmail({ token: registered.verificationToken })
    return registered.account
  }
`

test('GOOGLE start: official OIDC authorization request with state, nonce, PKCE S256, profile scope and account chooser; fails closed without configuration', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const started = await google.start()
    const url = new URL(started.authorizationUrl)
    const off = createFederatedAuth({ auth: auth.service, identityStore: auth.store, settings: null })
    const offStart = await off.service.start()
    const envChecks = [
      readGoogleAuthSettings({}),
      readGoogleAuthSettings({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'http://api.test/auth/oauth/google/callback', TUS_WEB_BASE_URL: 'http://web.test', NODE_ENV: 'production' }),
      readGoogleAuthSettings({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'https://api.test/other', TUS_WEB_BASE_URL: 'https://web.test' }),
      Boolean(readGoogleAuthSettings({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'https://api.test/auth/oauth/google/callback', TUS_WEB_BASE_URL: 'https://web.test', NODE_ENV: 'production' })),
    ]
    console.log(JSON.stringify({ host: url.origin + url.pathname, params: Object.fromEntries(['client_id', 'redirect_uri', 'response_type', 'scope', 'code_challenge_method', 'prompt'].map((k) => [k, url.searchParams.get(k)])), hasState: (url.searchParams.get('state') ?? '').length >= 32, hasNonce: (url.searchParams.get('nonce') ?? '').length >= 32, challenge: /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') ?? ''), secretInUrl: started.authorizationUrl.includes('fictitious-google-secret'), available: [google.available(), off.service.available()], offStart, envChecks }))
  `)
  assert.equal(result.host, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.deepEqual(result.params, {
    client_id: 'google-client-id',
    redirect_uri: 'https://api.tus.test/auth/oauth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  assert.equal(result.hasState, true)
  assert.equal(result.hasNonce, true)
  assert.equal(result.challenge, true)
  assert.equal(result.secretInUrl, false)
  assert.deepEqual(result.available, [true, false])
  assert.equal(result.offStart.code, 'PROVIDER_UNAVAILABLE')
  assert.deepEqual(result.envChecks, [null, null, null, true])
})

test('GOOGLE sign-up then sign-in: one flow, same TUS session type, roles from the backend, single-use codes and no duplicate accounts', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const identity = { subject: 'google-sub-001', email: 'nueva@example.com', name: 'Nueva Persona' }
    const first = await googleCallback(identity)
    const signupCode = fragment(first, 'code')
    const preview = await google.previewSignup({ code: signupCode })
    const noTerms = await google.completeSignup({ code: signupCode, displayName: 'Nueva Persona', acceptedTerms: false })
    // Extra authority fields in the body are ignored: roles come from the account model.
    const created = await google.completeSignup({ code: signupCode, displayName: 'Nueva Persona', acceptedTerms: true, roles: ['admin'], tenantId: 'other' })
    const replay = await google.completeSignup({ code: signupCode, displayName: 'x', acceptedTerms: true })
    const context = await sessions.resolve(created.session.accessToken, 'corr-1')
    const account = await auth.store.getAccount(created.session.accountId)
    // Second time: straight to a session code.
    const second = await googleCallback(identity)
    const loginCode = fragment(second, 'code')
    const exchanged = await google.exchange({ code: loginCode })
    const exchangeReplay = await google.exchange({ code: loginCode })
    const context2 = await sessions.resolve(exchanged.session.accessToken, 'corr-2')
    // Password sign-in is impossible for a Google-only account (no credential exists).
    const password = await auth.signIn({ email: 'nueva@example.com', password: 'cualquier-cosa-123' })
    // Codes expire.
    const third = await googleCallback(identity)
    now += 3 * 60 * 1000
    const expired = await google.exchange({ code: fragment(third, 'code') })
    console.log(JSON.stringify({ first: first.replace(/#.*/, ''), preview, noTerms: noTerms.code, created: Object.keys(created.session).sort(), replay: replay.code, context: [context.subjectId === created.session.accountId, context.roles, context.permissions.includes('tus:marketplace:write')], verified: account.emailVerifiedAt !== null, tenantKept: created.session.tenantId !== 'other', second: second.replace(/#.*/, ''), sameAccount: exchanged.session.accountId === created.session.accountId, exchangeReplay: exchangeReplay.code, context2: Boolean(context2), password: password.ok, expired: expired.code, identities: (await google.dependencies.identities.listForAccount(created.session.accountId)).map((i) => [i.providerId, i.subject]) }))
  `)
  assert.equal(result.first, 'https://web.tus.test/registro/completar')
  assert.deepEqual(result.preview, { ok: true, email: 'nueva@example.com', name: 'Nueva Persona' })
  assert.equal(result.noTerms, 'TERMS_REQUIRED')
  assert.deepEqual(result.created, ['accessToken', 'accountId', 'deviceId', 'expiresAt', 'id', 'scope', 'tenantId'])
  assert.equal(result.replay, 'INVALID_CODE')
  assert.deepEqual(result.context, [true, ['owner'], true])
  assert.equal(result.verified, true)
  assert.equal(result.tenantKept, true)
  assert.equal(result.second, 'https://web.tus.test/ingresar/google')
  assert.equal(result.sameAccount, true)
  assert.equal(result.exchangeReplay, 'INVALID_CODE')
  assert.equal(result.context2, true)
  assert.equal(result.password, false)
  assert.equal(result.expired, 'INVALID_CODE')
  assert.deepEqual(result.identities, [['google', 'google-sub-001']])
})

test('GOOGLE callback security: invalid or replayed state, cancelled consent, unverified email and disabled accounts never produce a session', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const started = await google.start()
    const state = new URL(started.authorizationUrl).searchParams.get('state')
    provider.codes.set('code-a', { subject: 's-1', email: 'a@example.com' })
    const invalidState = (await google.callback({ state: 'forged-state', code: 'code-a' })).redirectTo
    const ok = (await google.callback({ state, code: 'code-a' })).redirectTo
    const replayed = (await google.callback({ state, code: 'code-a' })).redirectTo
    const cancelled = (await google.callback({ error: 'access_denied' })).redirectTo
    const missing = (await google.callback({})).redirectTo
    const unverified = await googleCallback({ subject: 's-2', email: 'b@example.com', emailVerified: false })
    const noEmail = await googleCallback({ subject: 's-3', email: null })
    const badCode = await google.exchange({ code: '../../etc' })
    // Disabled account: Google does not bypass account gates.
    const signup = await googleCallback({ subject: 's-4', email: 'c@example.com' })
    const created = await google.completeSignup({ code: fragment(signup, 'code'), displayName: 'C', acceptedTerms: true })
    const account = await auth.store.getAccount(created.session.accountId)
    await auth.store.saveAccount({ ...account, status: 'disabled' })
    const disabled = await google.exchange({ code: fragment(await googleCallback({ subject: 's-4', email: 'c@example.com' }), 'code') })
    console.log(JSON.stringify({ invalidState, ok: ok.split('#')[0], replayed, cancelled, missing, unverified, noEmail, badCode: badCode.code, disabled: disabled.code }))
  `)
  assert.equal(result.invalidState, 'https://web.tus.test/sign-in?error=google_invalid')
  assert.equal(result.ok, 'https://web.tus.test/registro/completar')
  assert.equal(result.replayed, 'https://web.tus.test/sign-in?error=google_invalid')
  assert.equal(result.cancelled, 'https://web.tus.test/sign-in?error=google_cancelled')
  assert.equal(result.missing, 'https://web.tus.test/sign-in?error=google_invalid')
  assert.equal(result.unverified, 'https://web.tus.test/sign-in?error=google_email_not_verified')
  assert.equal(result.noEmail, 'https://web.tus.test/sign-in?error=google_email_not_verified')
  assert.equal(result.badCode, 'INVALID_CODE')
  assert.equal(result.disabled, 'SIGN_IN_FAILED')
})

test('GOOGLE linking: an existing email account is never linked silently; it needs a recent password session of that same account', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const account = await passwordAccount('ana@example.com')
    const redirect = await googleCallback({ subject: 'google-ana', email: 'Ana@Example.com' })
    const linkCode = fragment(redirect, 'link')
    const preview = await google.previewLink({ code: linkCode })
    const noSession = await google.link({ code: linkCode, accessToken: null })
    const other = await passwordAccount('otro@example.com')
    const otherSession = await auth.signIn({ email: 'otro@example.com', password: 'Contrasena-Segura-2026' })
    const mismatch = await google.link({ code: linkCode, accessToken: otherSession.session.accessToken })
    const stale = await auth.signIn({ email: 'ana@example.com', password: 'Contrasena-Segura-2026' })
    now += 11 * 60 * 1000
    const staleResult = await google.link({ code: linkCode, accessToken: stale.session.accessToken })
    const fresh = await auth.signIn({ email: 'ana@example.com', password: 'Contrasena-Segura-2026' })
    const linked = await google.link({ code: linkCode, accessToken: fresh.session.accessToken })
    const linkReplay = await google.link({ code: linkCode, accessToken: fresh.session.accessToken })
    // From now on Google signs in to the SAME account (no duplicate).
    const after = await googleCallback({ subject: 'google-ana', email: 'ana@example.com' })
    const session = await google.exchange({ code: fragment(after, 'code') })
    console.log(JSON.stringify({ redirect: redirect.split('#')[0], hasLink: Boolean(linkCode), preview, noSession: noSession.code, mismatch: mismatch.code, stale: staleResult.code, linked, linkReplay: linkReplay.code, same: session.session.accountId === account.id, otherUntouched: other.id !== account.id }))
  `)
  assert.equal(result.redirect, 'https://web.tus.test/ingresar/google')
  assert.equal(result.hasLink, true)
  assert.deepEqual(result.preview, { ok: true, emailMasked: 'An*@Example.com' })
  assert.equal(result.noSession, 'RECENT_AUTH_REQUIRED')
  assert.equal(result.mismatch, 'EMAIL_MISMATCH')
  assert.equal(result.stale, 'RECENT_AUTH_REQUIRED')
  assert.deepEqual(result.linked, { ok: true, linked: true })
  assert.equal(result.linkReplay, 'INVALID_CODE')
  assert.equal(result.same, true)
  assert.equal(result.otherUntouched, true)
})

test('GOOGLE id_token verification: RS256 signature against published keys; forged, tampered, unsigned or unknown-key tokens are rejected', () => {
  const result = runTypeScriptScenario(`
    const { generateKeyPairSync, sign } = await import('node:crypto')
    const { GoogleOidcProvider } = await import('./apps/api/src/auth-security/oauth-oidc/adapters/google.ts')
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' }
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const now = Date.parse('2026-09-25T12:00:00.000Z')
    const claims = { iss: 'accounts.google.com', aud: 'google-client-id', sub: '1234567890', nonce: 'n-1', email: 'ana@gmail.com', email_verified: true, name: 'Ana', picture: 'https://lh3.googleusercontent.com/a/x', exp: Math.floor(now / 1000) + 600 }
    const token = (header, payload, key = privateKey) => { const data = b64(header) + '.' + b64(payload); return data + '.' + sign('RSA-SHA256', Buffer.from(data), key).toString('base64url') }
    const requests = []
    const fetchImpl = async (url, init = {}) => {
      requests.push({ url: String(url), body: init.body ? String(init.body) : null })
      if (String(url).includes('certs')) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=3600' } })
      return new Response(JSON.stringify({ id_token: token({ alg: 'RS256', kid: 'key-1' }, claims), access_token: 'ya29.not-stored' }))
    }
    const google = new GoogleOidcProvider({ clientId: 'google-client-id', clientSecret: 'fictitious-google-secret', fetch: fetchImpl, now: () => now })
    const exchanged = await google.exchangeCode({ code: 'code-1', codeVerifier: 'verifier-1', redirectUri: 'https://api.tus.test/auth/oauth/google/callback', expectedNonce: 'n-1' })
    const tokenRequest = new URLSearchParams(requests[0].body)
    const valid = token({ alg: 'RS256', kid: 'key-1' }, claims)
    const [h, p, s] = valid.split('.')
    const tampered = await google.verifyIdToken(h + '.' + b64({ ...claims, email: 'victima@gmail.com' }) + '.' + s)
    const forged = await google.verifyIdToken(token({ alg: 'RS256', kid: 'key-1' }, claims, attacker.privateKey))
    const unsigned = await google.verifyIdToken(b64({ alg: 'none', kid: 'key-1' }) + '.' + b64(claims) + '.')
    const unknownKid = await google.verifyIdToken(token({ alg: 'RS256', kid: 'key-9' }, claims))
    const hs256 = await google.verifyIdToken(b64({ alg: 'HS256', kid: 'key-1' }) + '.' + b64(claims) + '.abc')
    const garbage = await google.verifyIdToken('not.a.jwt')
    console.log(JSON.stringify({ exchanged, grant: Object.fromEntries(['grant_type', 'code', 'code_verifier', 'redirect_uri', 'client_id'].map((k) => [k, tokenRequest.get(k)])), secretSentToTokenEndpointOnly: requests[0].url.includes('oauth2.googleapis.com/token') && tokenRequest.get('client_secret') === 'fictitious-google-secret', tampered, forged, unsigned, unknownKid, hs256, garbage }))
  `)
  assert.equal(result.exchanged.issuer, 'https://accounts.google.com')
  assert.equal(result.exchanged.audience, 'google-client-id')
  assert.equal(result.exchanged.subject, '1234567890')
  assert.equal(result.exchanged.nonce, 'n-1')
  assert.equal(result.exchanged.emailVerified, true)
  assert.equal(result.exchanged.email, 'ana@gmail.com')
  assert.equal('accessToken' in result.exchanged, false, 'Google access tokens are never kept')
  assert.deepEqual(result.grant, { grant_type: 'authorization_code', code: 'code-1', code_verifier: 'verifier-1', redirect_uri: 'https://api.tus.test/auth/oauth/google/callback', client_id: 'google-client-id' })
  assert.equal(result.secretSentToTokenEndpointOnly, true)
  for (const key of ['tampered', 'forged', 'unsigned', 'unknownKid', 'hs256', 'garbage']) assert.equal(result[key], undefined, key)
})

test('GOOGLE HTTP routes: providers status, start redirect, callback redirect to the Web, code exchange returns the normal session; unavailable fails closed', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { createFederatedAuthRouter } = await import('./apps/api/src/auth-security/federated/composition.ts')
    const build = (service, web) => { const app = express(); app.use(express.json()); app.use(createFederatedAuthRouter(service, web)); return app.listen(0) }
    const server = build(google, 'https://web.tus.test')
    const off = createFederatedAuth({ auth: auth.service, identityStore: auth.store, settings: null })
    const offServer = build(off.service, 'https://web.tus.test')
    const base = (s) => 'http://127.0.0.1:' + s.address().port
    try {
      const providers = await (await fetch(base(server) + '/auth/oauth/providers')).json()
      const offProviders = await (await fetch(base(offServer) + '/auth/oauth/providers')).json()
      const start = await fetch(base(server) + '/auth/oauth/google/start', { redirect: 'manual' })
      const offStart = await fetch(base(offServer) + '/auth/oauth/google/start', { redirect: 'manual' })
      const state = new URL(start.headers.get('location')).searchParams.get('state')
      provider.codes.set('http-code', { subject: 'http-sub', email: 'http@example.com' })
      const callback = await fetch(base(server) + '/auth/oauth/google/callback?state=' + state + '&code=http-code', { redirect: 'manual' })
      const signupCode = fragment(callback.headers.get('location'), 'code')
      const signup = await fetch(base(server) + '/auth/oauth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: signupCode, displayName: 'Http', acceptedTerms: true }) })
      const signupBody = await signup.json()
      const bad = await fetch(base(server) + '/auth/oauth/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(43) }) })
      console.log(JSON.stringify({ providers, offProviders, start: [start.status, new URL(start.headers.get('location')).host, start.headers.get('cache-control')], offStart: [offStart.status, offStart.headers.get('location')], callback: [callback.status, callback.headers.get('location').split('#')[0], callback.headers.get('referrer-policy')], signup: [signup.status, Boolean(signupBody.session?.accessToken), signup.headers.get('cache-control')], bad: [bad.status, (await bad.json()).error?.code ?? null] }))
    } finally { server.close(); offServer.close() }
  `)
  assert.deepEqual(result.providers, { google: { available: true } })
  assert.deepEqual(result.offProviders, { google: { available: false } })
  assert.deepEqual(result.start, [303, 'accounts.google.com', 'no-store'])
  assert.deepEqual(result.offStart, [303, 'https://web.tus.test/sign-in?error=google_unavailable'])
  assert.deepEqual(result.callback, [303, 'https://web.tus.test/registro/completar', 'no-referrer'])
  assert.deepEqual(result.signup, [201, true, 'no-store'])
  assert.equal(result.bad[0], 401)
})
