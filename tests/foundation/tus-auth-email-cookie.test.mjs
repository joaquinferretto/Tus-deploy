import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Email + password authentication end to end over HTTP, without Google: sign-up, verification by
// email, sign-in with the HttpOnly cookie, sign-out, password reset, admin with MFA, allowlist
// revocation, CSRF and replays. Everything in memory (the email provider is captured).
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

const APP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { InMemoryEmailSender, FixedWindowRateLimiter } = await import('./apps/api/src/auth-security/adapters/in-memory-auxiliaries.ts')
  const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
  const { createAuthRouter } = await import('./apps/api/src/auth-security/http/auth-router.ts')
  const { createSessionCookieMiddleware } = await import('./apps/api/src/auth-security/http/session-cookie.ts')
  const { createTotpMfaService } = await import('./apps/api/src/auth-security/mfa/composition.ts')
  const { InMemoryMfaStore, InMemoryMfaAuditSink } = await import('./apps/api/src/auth-security/mfa/adapters/in-memory.ts')
  const { MfaAdminSessionResolver } = await import('./apps/api/src/auth-security/mfa/admin-gate.ts')
  const { createMfaRouter } = await import('./apps/api/src/auth-security/mfa/http/mfa-router.ts')
  const { totpAt } = await import('./apps/api/src/auth-security/mfa/adapters/totp.ts')
  let now = Date.parse('2026-10-06T12:00:00.000Z')
  const clock = () => now
  const email = new InMemoryEmailSender()
  let admins = ['admin@example.com']
  const identityStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({
    store: identityStore,
    now: clock,
    email,
    platformAdminEmails: ['admin@example.com'],
    signInRateLimiter: new FixedWindowRateLimiter(8, 15 * 60_000),
    verificationResendRateLimiter: new FixedWindowRateLimiter(5, 60 * 60_000),
    verificationResendCooldown: new FixedWindowRateLimiter(1, 60_000),
    passwordBreachChecker: { isBreached: async (password) => password === 'contraseña-filtrada-123' },
  }), store: identityStore }
  const mfa = createTotpMfaService({ store: new InMemoryMfaStore(), audit: new InMemoryMfaAuditSink(), now: clock })
  const raw = new DurableIdentitySessionResolver(auth.store, clock)
  const gate = new MfaAdminSessionResolver(raw, mfa, auth.store, () => admins)
  const cookies = { name: '__Host-tus_session', secure: true, allowedOrigins: ['https://tusservicios.shop', 'https://www.tusservicios.shop'] }
  const app = express()
  app.use(express.json())
  app.use(createSessionCookieMiddleware(cookies))
  app.use(createAuthRouter({ service: auth.service, sessions: gate, cookies, now: clock }))
  app.use(createMfaRouter({
    service: mfa, sessions: raw, accounts: auth.service, now: clock, cookies,
    reauthenticate: (id, password) => auth.service.verifyCurrentPassword(id, password),
    adminCandidate: (context) => gate.isAdminCandidate(context),
    rotate: (accessToken) => auth.service.rotateSession({ accessToken }),
    notify: (id, kind) => auth.service.notifyAccount(id, kind),
  }))
  // A sensitive admin endpoint: authorized ONLY by the gated context (like every admin route).
  app.post('/test/admin-action', async (request, response) => {
    const token = (request.header('authorization') ?? '').replace('Bearer ', '')
    const context = token ? await gate.resolve(token, request.header('x-correlation-id') ?? 'c') : null
    response.status(context && context.permissions.includes('tus:identity:admin') ? 200 : 403).json({ tenantId: context?.tenantId ?? null })
  })
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = 'http://127.0.0.1:' + server.address().port
  const WEB = 'https://tusservicios.shop'
  // A browser on the Web origin: keeps the cookie jar, sends Origin, never sees the token.
  const browser = () => {
    let jar = ''
    const setCookies = []
    const call = async (path, { method = 'POST', body, origin = WEB, headers = {}, cookie } = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr', ...(origin ? { origin } : {}), ...((cookie ?? jar) ? { cookie: cookie ?? jar } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      for (const line of response.headers.getSetCookie()) {
        setCookies.push(line)
        const [pair] = line.split(';')
        jar = pair.endsWith('=') ? '' : pair
      }
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : null }
    }
    return { call, jar: () => jar, setCookies }
  }
  const lastMail = (to, kind) => [...email.messages].reverse().find((m) => m.email === to && m.kind === kind)
  const password = 'una frase larga y segura 2026'
`

test('USER: register -> pending -> sign-in rejected -> verify -> sign-in with HttpOnly cookie -> session -> sign-out revokes server-side', () => {
  const result = runTypeScriptScenario(`${APP}
    const out = {}
    try {
      const b = browser()
      const reg = await b.call('/auth/register', { body: { email: 'Ana@Example.com', password, displayName: 'Ana' } })
      out.register = [reg.status, reg.body]
      out.signInBeforeVerify = (await b.call('/auth/sign-in', { body: { email: 'ana@example.com', password } })).status
      const mail = lastMail('Ana@Example.com', 'verification')
      out.mailSent = Boolean(mail?.token)
      out.tokenStoredHashed = ![...auth.store.verificationTokens.values()].some((t) => JSON.stringify(t).includes(mail.token))
      out.verify = (await b.call('/auth/verify-email', { body: { token: mail.token } })).status
      out.verifyReplay = (await b.call('/auth/verify-email', { body: { token: mail.token } })).status
      const signIn = await b.call('/auth/sign-in', { body: { email: 'ana@example.com', password } })
      out.signIn = signIn.status
      out.bodyToken = signIn.body.session.accessToken
      out.cookie = b.setCookies.at(-1)
      out.session = (await b.call('/auth/session', { method: 'GET' })).status
      const stolen = b.jar()
      out.signOut = (await b.call('/auth/sign-out')).status
      out.cookieCleared = b.setCookies.at(-1)
      out.oldCookieAfterSignOut = (await b.call('/auth/session', { method: 'GET', cookie: stolen })).status
      // Native client (no Origin): Bearer token in the body, no cookie.
      const native = await fetch(base + '/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@example.com', password }) })
      const nativeBody = await native.json()
      out.native = [native.status, nativeBody.session.accessToken !== 'cookie-session' && nativeBody.session.accessToken.length > 20, native.headers.getSetCookie().length]
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.register, [201, { status: 'pending_verification' }])
  assert.equal(result.signInBeforeVerify, 401, 'no session before the email is verified')
  assert.equal(result.mailSent, true)
  assert.equal(result.tokenStoredHashed, true, 'only the digest of the verification token is stored')
  assert.equal(result.verify, 204)
  assert.equal(result.verifyReplay, 400, 'a verification link works once')
  assert.equal(result.signIn, 200)
  assert.equal(result.bodyToken, 'cookie-session', 'the Web never receives the token in JavaScript')
  assert.match(result.cookie, /^__Host-tus_session=[A-Za-z0-9_-]{20,}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/u)
  assert.equal(result.session, 200)
  assert.equal(result.signOut, 204)
  assert.match(result.cookieCleared, /^__Host-tus_session=; .*Max-Age=0$/u)
  assert.equal(result.oldCookieAfterSignOut, 401, 'sign-out revokes the session on the server')
  assert.deepEqual(result.native, [200, true, 0])
})

test('ENUMERATION + RESEND: same answer for new and existing emails; re-send is throttled; expired links fail', () => {
  const result = runTypeScriptScenario(`${APP}
    const out = {}
    try {
      const b = browser()
      await b.call('/auth/register', { body: { email: 'beto@example.com', password, displayName: 'Beto' } })
      const again = await b.call('/auth/register', { body: { email: 'beto@example.com', password: 'otra frase distinta 2026', displayName: 'X' } })
      out.duplicate = [again.status, again.body]
      out.pendingGotNewLink = email.messages.filter((m) => m.email === 'beto@example.com' && m.kind === 'verification').length
      now += 61_000
      out.resendUnknown = (await b.call('/auth/verify-email/resend', { body: { email: 'nadie@example.com' } })).status
      const before = email.messages.length
      out.resend = (await b.call('/auth/verify-email/resend', { body: { email: 'beto@example.com' } })).status
      out.resendImmediate = (await b.call('/auth/verify-email/resend', { body: { email: 'beto@example.com' } })).status
      out.resendSent = email.messages.length - before
      out.breached = (await b.call('/auth/register', { body: { email: 'caro@example.com', password: 'contraseña-filtrada-123', displayName: 'Caro' } })).body.error.code
      // Verified account + new sign-up with its email: same answer, a security notice to the owner.
      const token = lastMail('beto@example.com', 'verification').token
      await b.call('/auth/verify-email', { body: { token } })
      const verifiedDup = await b.call('/auth/register', { body: { email: 'beto@example.com', password, displayName: 'X' } })
      out.verifiedDuplicate = [verifiedDup.status, verifiedDup.body]
      out.notice = lastMail('beto@example.com', 'security')?.notification
      // Expired verification link (24 h).
      await b.call('/auth/register', { body: { email: 'dani@example.com', password, displayName: 'Dani' } })
      const daniToken = lastMail('dani@example.com', 'verification').token
      now += 25 * 60 * 60 * 1000
      out.expired = (await b.call('/auth/verify-email', { body: { token: daniToken } })).status
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.duplicate, [201, { status: 'pending_verification' }], 'an existing email gets the same answer')
  assert.equal(result.pendingGotNewLink, 2, 'an unverified account receives a fresh link')
  assert.equal(result.resendUnknown, 202)
  assert.equal(result.resend, 202)
  assert.equal(result.resendImmediate, 202, 'still generic when throttled')
  assert.equal(result.resendSent, 1, 'one per minute')
  assert.equal(result.breached, 'PASSWORD_BREACHED')
  assert.deepEqual(result.verifiedDuplicate, [201, { status: 'pending_verification' }])
  assert.equal(result.notice, 'registration_attempt')
  assert.equal(result.expired, 400, 'an expired verification link is rejected')
})

test('RECOVERY: generic request -> one-time link -> new password -> replay rejected -> old password fails, new works, sessions revoked', () => {
  const result = runTypeScriptScenario(`${APP}
    const out = {}
    try {
      const b = browser()
      await b.call('/auth/register', { body: { email: 'eli@example.com', password, displayName: 'Eli' } })
      await b.call('/auth/verify-email', { body: { token: lastMail('eli@example.com', 'verification').token } })
      await b.call('/auth/sign-in', { body: { email: 'eli@example.com', password } })
      const openSession = b.jar()
      const unknown = await b.call('/auth/recovery/request', { body: { email: 'nadie@example.com' } })
      const known = await b.call('/auth/recovery/request', { body: { email: 'eli@example.com' } })
      out.generic = unknown.status === known.status && unknown.body.message === known.body.message && unknown.body.accepted === known.body.accepted
      const token = lastMail('eli@example.com', 'recovery').token
      out.breached = (await b.call('/auth/recovery/complete', { body: { token, newPassword: 'contraseña-filtrada-123' } })).body.error.code
      const newPassword = 'otra frase nueva y larga 2026'
      out.complete = (await b.call('/auth/recovery/complete', { body: { token, newPassword } })).status
      out.replay = (await b.call('/auth/recovery/complete', { body: { token, newPassword: 'tercera frase distinta 2026' } })).status
      out.oldSessionRevoked = (await b.call('/auth/session', { method: 'GET', cookie: openSession })).status
      out.oldPassword = (await b.call('/auth/sign-in', { body: { email: 'eli@example.com', password } })).status
      out.newPassword = (await b.call('/auth/sign-in', { body: { email: 'eli@example.com', password: newPassword } })).status
      out.notice = lastMail('eli@example.com', 'security')?.notification
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.generic, true, 'no enumeration on reset')
  assert.equal(result.breached, 'PASSWORD_BREACHED')
  assert.equal(result.complete, 204)
  assert.equal(result.replay, 400, 'a reset link works once')
  assert.equal(result.oldSessionRevoked, 401)
  assert.equal(result.oldPassword, 401)
  assert.equal(result.newPassword, 200)
  assert.equal(result.notice, 'password_reset')
})

test('ADMIN (no Google): register -> verify -> email+password -> MFA -> admin; rotation; allowlist removal is immediate; Google never grants admin', () => {
  const result = runTypeScriptScenario(`${APP}
    const out = {}
    try {
      const b = browser()
      await b.call('/auth/register', { body: { email: 'admin@example.com', password, displayName: 'Admin' } })
      await b.call('/auth/verify-email', { body: { token: lastMail('admin@example.com', 'verification').token } })
      await b.call('/auth/sign-in', { body: { email: 'admin@example.com', password } })
      out.adminBeforeMfa = (await b.call('/test/admin-action')).status
      out.status = (await b.call('/auth/mfa/status', { method: 'GET' })).body
      const enroll = await b.call('/auth/mfa/enroll', { body: {} })
      const preMfaCookie = b.jar()
      const confirm = await b.call('/auth/mfa/enroll/confirm', { body: { enrollmentId: enroll.body.enrollmentId, code: totpAt(enroll.body.secret, Math.floor(now / 30000)) } })
      out.confirm = [confirm.status, confirm.body.recoveryCodes.length, confirm.body.session.accessToken]
      out.rotated = b.jar() !== preMfaCookie
      out.preMfaCookieDead = (await b.call('/auth/session', { method: 'GET', cookie: preMfaCookie })).status
      out.adminAfterMfa = (await b.call('/test/admin-action')).status
      out.mfaNotice = lastMail('admin@example.com', 'security')?.notification
      // Forged headers / tenant do not change authority.
      const client = browser()
      await client.call('/auth/register', { body: { email: 'cliente@example.com', password, displayName: 'C' } })
      await client.call('/auth/verify-email', { body: { token: lastMail('cliente@example.com', 'verification').token } })
      await client.call('/auth/sign-in', { body: { email: 'cliente@example.com', password } })
      out.forged = (await client.call('/test/admin-action', { headers: { 'x-account-id': 'admin', 'x-tenant-id': 'platform', 'x-actor-id': 'admin', 'x-tus-admin': 'true' } })).status
      const ctx = await client.call('/auth/session', { method: 'GET', headers: { 'x-tenant-id': 'victim' } })
      out.forgedTenantIgnored = ctx.body.context.tenantId !== 'victim'
      out.clientMfa = (await client.call('/auth/mfa/status', { method: 'GET' })).status
      // New sign-in: admin again only after MFA (code of the next time step).
      now += 30_000
      const second = browser()
      await second.call('/auth/sign-in', { body: { email: 'admin@example.com', password } })
      out.secondBeforeMfa = (await second.call('/test/admin-action')).status
      out.secondVerify = (await second.call('/auth/mfa/verify', { body: { code: totpAt(enroll.body.secret, Math.floor(now / 30000)) } })).status
      out.secondAfterMfa = (await second.call('/test/admin-action')).status
      // Removing the email from TUS_PLATFORM_ADMIN_EMAILS ends access on the very next request.
      admins = []
      out.afterRemoval = (await second.call('/test/admin-action')).status
      out.mfaAfterRemoval = (await second.call('/auth/mfa/status', { method: 'GET' })).status
      admins = ['admin@example.com']
      out.restored = (await second.call('/test/admin-action')).status
      // Google (federated) sign-in of the same account never carries admin scope.
      const accountId = [...auth.store.accounts.values()].find((a) => a.normalizedEmail === 'admin@example.com').id
      const federated = await auth.service.signInFederated({ accountId })
      out.googleAdminScope = federated.session.scope.permissions.filter((p) => p.endsWith(':admin') || p === 'tus:whatsapp:support')
      out.googleRotated = (await auth.service.rotateSession({ accessToken: federated.session.accessToken })).session.scope.permissions.filter((p) => p.endsWith(':admin'))
      // Password reset does not skip MFA.
      await second.call('/auth/recovery/request', { body: { email: 'admin@example.com' } })
      await second.call('/auth/recovery/complete', { body: { token: lastMail('admin@example.com', 'recovery').token, newPassword: 'nueva frase del admin 2026' } })
      const third = browser()
      await third.call('/auth/sign-in', { body: { email: 'admin@example.com', password: 'nueva frase del admin 2026' } })
      out.afterResetNeedsMfa = (await third.call('/test/admin-action')).status
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.adminBeforeMfa, 403, 'email + password alone is not admin')
  assert.equal(result.status.enrolled, false)
  assert.deepEqual(result.confirm, [200, 8, 'cookie-session'])
  assert.equal(result.rotated, true, 'the session is rotated after MFA')
  assert.equal(result.preMfaCookieDead, 401, 'the pre-MFA token is revoked')
  assert.equal(result.adminAfterMfa, 200)
  assert.equal(result.mfaNotice, 'mfa_enabled')
  assert.equal(result.forged, 403, 'forged admin headers do nothing')
  assert.equal(result.forgedTenantIgnored, true)
  assert.equal(result.clientMfa, 403)
  assert.equal(result.secondBeforeMfa, 403)
  assert.equal(result.secondVerify, 200)
  assert.equal(result.secondAfterMfa, 200)
  assert.equal(result.afterRemoval, 403, 'allowlist removal is immediate, even for an MFA-elevated session')
  assert.equal(result.mfaAfterRemoval, 403)
  assert.equal(result.restored, 200)
  assert.deepEqual(result.googleAdminScope, [], 'a Google session is never admin')
  assert.deepEqual(result.googleRotated, [])
  assert.equal(result.afterResetNeedsMfa, 403, 'a password reset never skips MFA')
})

test('CSRF + LIMITS: cookie-authenticated mutations need an allowed Origin/Referer; sign-in per-email limit answers 429', () => {
  const result = runTypeScriptScenario(`${APP}
    const out = {}
    try {
      const b = browser()
      await b.call('/auth/register', { body: { email: 'fer@example.com', password, displayName: 'Fer' } })
      await b.call('/auth/verify-email', { body: { token: lastMail('fer@example.com', 'verification').token } })
      await b.call('/auth/sign-in', { body: { email: 'fer@example.com', password } })
      const evil = await b.call('/auth/sign-out', { origin: 'https://evil.example' })
      out.evil = [evil.status, evil.body?.error?.code]
      out.noOrigin = (await b.call('/auth/sign-out', { origin: null })).status
      out.evilReferer = (await b.call('/auth/sign-out', { origin: null, headers: { referer: 'https://evil.example/x' } })).status
      out.stillSignedIn = (await b.call('/auth/session', { method: 'GET' })).status
      out.wwwOrigin = (await b.call('/auth/session', { method: 'GET', origin: 'https://www.tusservicios.shop' })).status
      out.allowedReferer = (await b.call('/auth/sign-out', { origin: null, headers: { referer: 'https://tusservicios.shop/mi-perfil' } })).status
      const attempts = []
      for (let i = 0; i < 10; i += 1) attempts.push((await b.call('/auth/sign-in', { body: { email: 'fer@example.com', password: 'incorrecta frase larga' } })).status)
      out.attempts = attempts
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.evil, [403, 'CSRF_REJECTED'])
  assert.equal(result.noOrigin, 403)
  assert.equal(result.evilReferer, 403)
  assert.equal(result.stillSignedIn, 200, 'the forged requests did nothing')
  assert.equal(result.wwwOrigin, 200)
  assert.equal(result.allowedReferer, 204)
  assert.deepEqual(result.attempts.slice(0, 7), [401, 401, 401, 401, 401, 401, 401])
  assert.equal(result.attempts.at(-1), 429, 'per-email limit (not a global lockout)')
})

test('EMAIL provider: Resend adapter sends a one-time link, escapes HTML, and a missing provider never blocks sign-up', () => {
  const result = runTypeScriptScenario(`
    const { createEmailSenderFromEnv } = await import('./apps/api/src/auth-security/adapters/email/email-senders.ts')
    const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
    const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
    const calls = []
    const fakeFetch = async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 200 }) }
    const resend = createEmailSenderFromEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'TUS <no-reply@tusservicios.shop>', TUS_WEB_BASE_URL: 'https://tusservicios.shop/' }, fakeFetch)
    await resend.sender.sendVerification({ email: 'ana@example.com', token: 'tok_ABC-123' })
    await resend.sender.sendRecovery({ email: 'ana@example.com', token: 'tok_R' })
    await resend.sender.sendSecurityNotification({ email: 'ana@example.com', kind: 'mfa_disabled' })
    const bodies = calls.map((c) => JSON.parse(c.init.body))
    const missing = createEmailSenderFromEnv({ EMAIL_PROVIDER: 'resend', TUS_WEB_BASE_URL: 'https://tusservicios.shop' })
    const partial = createEmailSenderFromEnv({})
    const events = []
    const auth = createAuthService({ store: new InMemoryIdentityStore(), email: missing.sender, audit: { record: async (e) => { events.push(e) } } })
    const registered = await auth.service.registerAccount({ email: 'sin-mail@example.com', password: 'una frase larga y segura', displayName: 'X' })
    console.log(JSON.stringify({
      provider: resend.provider, missing: missing.provider, partial: partial.provider,
      url: calls[0].url, auth: calls[0].init.headers.authorization, method: calls[0].init.method,
      to: bodies[0].to, from: bodies[0].from, subject: bodies[0].subject,
      verifyLink: bodies[0].text.includes('https://tusservicios.shop/verificar-email?token=tok_ABC-123'),
      resetLink: bodies[1].text.includes('https://tusservicios.shop/restablecer-contrasena?token=tok_R'),
      noticeSubject: bodies[2].subject, noticeHasLink: bodies[2].text.includes('token='),
      registeredWithoutProvider: registered.status, created: Boolean(registered.created),
      deliveryAudited: events.some((e) => e.kind === 'email.delivery_failed' && e.metadata.reason === 'provider_not_configured'),
      noTokenInAudit: !JSON.stringify(events).includes(registered.created.verificationToken),
    }))
  `)
  assert.equal(result.provider, 'resend')
  assert.equal(result.missing, 'unavailable', 'no key: closed by configuration')
  assert.equal(result.partial, 'unavailable')
  assert.equal(result.url, 'https://api.resend.com/emails')
  assert.equal(result.auth, 'Bearer re_test_key')
  assert.equal(result.method, 'POST')
  assert.deepEqual(result.to, ['ana@example.com'])
  assert.equal(result.from, 'TUS <no-reply@tusservicios.shop>')
  assert.equal(result.subject, 'Confirmá tu email en TUS')
  assert.equal(result.verifyLink, true)
  assert.equal(result.resetLink, true)
  assert.equal(result.noticeSubject, 'Desactivaste el segundo factor en TUS')
  assert.equal(result.noticeHasLink, false)
  assert.equal(result.registeredWithoutProvider, 'pending_verification')
  assert.equal(result.created, true)
  assert.equal(result.deliveryAudited, true)
  assert.equal(result.noTokenInAudit, true)
})

test('PASSWORDS: Pwned Passwords sends only a 5-char SHA-1 prefix and fails open; durable limiter stores no email', () => {
  const result = runTypeScriptScenario(`
    const { createHash } = await import('node:crypto')
    const { PwnedPasswordsChecker } = await import('./apps/api/src/auth-security/adapters/pwned-passwords.ts')
    const { PostgresRateLimiter } = await import('./apps/api/src/auth-security/adapters/postgres/postgres-rate-limiter.ts')
    const pwd = 'P@ssw0rd'
    const hash = createHash('sha1').update(pwd).digest('hex').toUpperCase()
    const urls = []
    const checker = new PwnedPasswordsChecker(async (url, init) => { urls.push({ url, padding: init.headers['Add-Padding'] }); return new Response(hash.slice(5) + ':42\\r\\nABCDEF0123456789ABCDEF0123456789ABC:0\\r\\n') })
    const breached = await checker.isBreached(pwd)
    const clean = await new PwnedPasswordsChecker(async () => new Response('0000000000000000000000000000000000A:3')).isBreached(pwd)
    const down = await new PwnedPasswordsChecker(async () => { throw new Error('offline') }).isBreached(pwd)
    const queries = []
    let attempts = 0
    const limiter = new PostgresRateLimiter({ $queryRawUnsafe: async (sql, ...values) => { queries.push({ sql, values: values.map(String) }); attempts += 1; return [{ attempts }] } }, 'sign-in', 2, 60_000)
    const allowed = [await limiter.allow('ana@example.com', 1000), await limiter.allow('ana@example.com', 2000), await limiter.allow('ana@example.com', 3000)]
    console.log(JSON.stringify({ url: urls[0].url, padding: urls[0].padding, sentPassword: JSON.stringify(urls).includes(pwd) || JSON.stringify(urls).includes(hash), breached, clean, down, allowed, key: queries[0].values[0], emailInSql: JSON.stringify(queries).includes('ana@example.com'), upsert: /ON CONFLICT \\("key"\\) DO UPDATE/u.test(queries[0].sql) }))
  `)
  assert.equal(result.url, `https://api.pwnedpasswords.com/range/${'21BD1'}`)
  assert.equal(result.padding, 'true')
  assert.equal(result.sentPassword, false, 'neither the password nor its full hash leave the server')
  assert.equal(result.breached, true)
  assert.equal(result.clean, false)
  assert.equal(result.down, false, 'fail open when the service is unavailable')
  assert.deepEqual(result.allowed, [true, true, false])
  assert.match(result.key, /^sign-in:[0-9a-f]{64}$/u)
  assert.equal(result.emailInSql, false)
  assert.equal(result.upsert, true)
})

test('WIRING: cookie + CSRF middleware before every router, durable limits, no token in Web storage, Google never the admin path', () => {
  const server = read('apps/api/src/server.ts')
  assert.match(server, /app\.use\(corsMiddleware\)\s*\/\/[^\n]*\n\s*app\.use\(createSessionCookieMiddleware\(sessionCookies\)\)/u)
  assert.match(server, /env: process\.env/u)
  assert.match(server, /'\/auth\/verify-email\/resend'/u)
  const composition = read('apps/api/src/auth-security/composition.ts')
  for (const scope of ["'recovery', 5", "'sign-in', 10", "'verify-resend', 5", "'verify-resend-gap', 1"]) assert.ok(composition.includes(`durable(${scope}`), scope)
  assert.match(read('apps/api/src/auth-security/mfa/composition.ts'), /new PostgresRateLimiter\(raw, 'mfa', 5, 15 \* 60_000\)/u)
  const migration = read('apps/api/prisma/migrations/20261006100000_tus_auth_rate_limits/migration.sql')
  assert.doesNotMatch(migration, /\bDROP\b|ALTER TABLE|TRUNCATE|DELETE FROM/iu)
  // The Web stores only the marker; the marker is the same on both sides.
  assert.match(read('apps/web/src/lib/session-credentials.ts'), /COOKIE_SESSION_MARKER = 'cookie-session'/u)
  assert.match(read('apps/api/src/auth-security/http/session-cookie.ts'), /COOKIE_SESSION_MARKER = 'cookie-session'/u)
  for (const file of ['lib/tus-auth-client.ts', 'lib/tus-client.ts', 'lib/tus-admin-mfa.ts']) assert.match(read(`apps/web/src/${file}`), /credentials: 'include'/u, file)
  assert.doesNotMatch(read('apps/web/src/lib/tus-client.ts') + read('apps/web/src/lib/tus-auth-client.ts'), /credentials: 'omit'/u)
  // Admin scope is only minted on the email + password path.
  const service = read('apps/api/src/auth-security/application/auth-service.ts')
  assert.match(service, /'credential_verified', \{ platformAdmin: true \}/u)
  assert.match(service, /'federated_identity_verified', \{ platformAdmin: false \}/u)
  // CORS never `*` with credentials.
  assert.match(read('apps/api/src/presentation/middleware/cors.ts'), /origin !== '\*'/u)
  for (const key of ['EMAIL_PROVIDER=', 'RESEND_API_KEY=', 'EMAIL_FROM=']) assert.match(read('.env.example'), new RegExp(`^${key}$`, 'mu'), key)
  // Pages of the flow.
  for (const page of ['verificar-email', 'olvide-contrasena', 'restablecer-contrasena']) assert.match(read(`apps/web/src/app/(auth)/${page}/page.tsx`), /AuthShell/u, page)
  assert.match(read('apps/web/src/features/auth/email-flows.tsx'), /window\.history\.replaceState\(null, '', window\.location\.pathname\)/u, 'the token leaves the address bar')
})
