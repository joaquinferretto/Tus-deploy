import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// MFA (TOTP) for platform administration. Admin permissions are minted only for an allowlisted
// verified email AND honored by the backend only for a session that passed the second factor.
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

test('MFA TOTP: RFC 6238 vectors, drift window, base32 and recovery code format', () => {
  const result = runTypeScriptScenario(`
    const { totpAt, base32Encode, base32Decode, TotpCodeVerifier, TotpSecretGenerator, RandomRecoveryCodeGenerator, otpauthUri } = await import('./apps/api/src/auth-security/mfa/adapters/totp.ts')
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    const verifier = new TotpCodeVerifier()
    const now = 1111111109 * 1000
    const code = totpAt(secret, Math.floor(now / 30000))
    console.log(JSON.stringify({
      secret,
      roundTrip: base32Decode(secret).toString(),
      vectors: [totpAt(secret, Math.floor(59 / 30)), totpAt(secret, Math.floor(1111111109 / 30)), totpAt(secret, Math.floor(1234567890 / 30))],
      current: await verifier.verify(secret, code, now),
      drift: await verifier.verify(secret, code, now + 30000),
      tooOld: await verifier.verify(secret, code, now + 90000),
      garbage: [await verifier.verify(secret, '', now), await verifier.verify(secret, 'abcdef', now), await verifier.verify(secret, '1234567', now)],
      generated: new TotpSecretGenerator().next(),
      recovery: new RandomRecoveryCodeGenerator().next(),
      uri: otpauthUri({ issuer: 'TUS', accountName: 'admin@example.com', secret }),
    }))
  `)
  assert.equal(result.secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  assert.equal(result.roundTrip, '12345678901234567890')
  // RFC 6238 appendix B (SHA1), last 6 digits.
  assert.deepEqual(result.vectors, ['287082', '081804', '005924'])
  assert.equal(result.current, true)
  assert.equal(result.drift, true, 'one step of clock drift is accepted')
  assert.equal(result.tooOld, false)
  assert.deepEqual(result.garbage, [false, false, false])
  assert.match(result.generated, /^[A-Z2-7]{32}$/u, '160-bit base32 secret')
  assert.match(result.recovery, /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/u)
  assert.equal(result.uri, `otpauth://totp/TUS:admin%40example.com?secret=${result.secret}&issuer=TUS&algorithm=SHA1&digits=6&period=30`)
})

const FLOW = `
  const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { PLATFORM_ADMIN_PERMISSIONS } = await import('./apps/api/src/auth-security/application/auth-service.ts')
  const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
  const { createTotpMfaService } = await import('./apps/api/src/auth-security/mfa/composition.ts')
  const { InMemoryMfaStore, InMemoryMfaAuditSink } = await import('./apps/api/src/auth-security/mfa/adapters/in-memory.ts')
  const { totpAt } = await import('./apps/api/src/auth-security/mfa/adapters/totp.ts')
  const { MfaAdminSessionResolver } = await import('./apps/api/src/auth-security/mfa/admin-gate.ts')
  let now = Date.parse('2026-10-05T12:00:00.000Z')
  const clock = () => now
  const auth = createInMemoryAuthService({ now: clock, platformAdminEmails: ['admin@example.com', 'pendiente@example.com'] })
  const password = 'Contrasena-Segura-2026'
  async function cuenta(email, verify = true) {
    const registered = await auth.register({ email, password, displayName: 'Persona' })
    if (verify) await auth.verifyEmail({ token: registered.verificationToken })
  }
  await cuenta('admin@example.com')
  await cuenta('cliente@example.com')
  await cuenta('pendiente@example.com', false)
  const mfaStore = new InMemoryMfaStore()
  const mfaAudit = new InMemoryMfaAuditSink()
  const mfa = createTotpMfaService({ store: mfaStore, audit: mfaAudit, now: clock })
  const raw = new DurableIdentitySessionResolver(auth.store, clock)
  const gated = new MfaAdminSessionResolver(raw, mfa)
  const closed = new MfaAdminSessionResolver(raw, null)
  const isAdmin = (context) => Boolean(context) && PLATFORM_ADMIN_PERMISSIONS.every((p) => context.permissions.includes(p))
  const signIn = async (email) => {
    const result = await auth.signIn({ email, password })
    if (!result.ok) return { ok: false }
    const token = result.session.accessToken
    const context = await raw.resolve(token, 'corr')
    return { ok: true, token, subject: { accountId: context.subjectId, sessionId: context.sessionId } }
  }
  const effective = async (session) => isAdmin(await gated.resolve(session.token, 'corr'))
  const code = (secret, offsetSteps = 0) => totpAt(secret, Math.floor(now / 30000) + offsetSteps)
`

test('MFA ADMIN: allowlist alone is not enough; the backend honors admin only after the second factor', () => {
  const result = runTypeScriptScenario(`${FLOW}
    const client = await signIn('cliente@example.com')
    const pending = await signIn('pendiente@example.com')
    const admin = await signIn('admin@example.com')
    const out = {}
    out.clientRaw = isAdmin(await raw.resolve(client.token, 'corr'))
    out.pendingSignIn = pending.ok
    out.adminRawHasPermissions = isAdmin(await raw.resolve(admin.token, 'corr'))
    out.adminWithoutMfa = await effective(admin)
    out.statusBefore = await mfa.status(admin.subject)
    const enrolled = await mfa.enroll({ accountId: admin.subject.accountId, subject: admin.subject, label: 'admin@example.com' })
    out.secretFormat = /^[A-Z2-7]{32}$/u.test(enrolled.secret)
    out.pendingNotAdmin = await effective(admin)
    out.wrongConfirm = (await mfa.confirmEnrollment({ subject: admin.subject, enrollmentId: enrolled.enrollmentId, code: '000000' })).code
    const confirmed = await mfa.confirmEnrollment({ subject: admin.subject, enrollmentId: enrolled.enrollmentId, code: code(enrolled.secret) })
    out.recoveryCount = confirmed.recoveryCodes.length
    out.adminAfterEnrollment = await effective(admin)
    out.secondEnrollment = (await mfa.enroll({ accountId: admin.subject.accountId, subject: admin.subject, label: 'x' })).code
    // A NEW session (or one created before MFA) is not admin until it passes the challenge.
    now += 60_000
    const second = await signIn('admin@example.com')
    out.newSessionNotAdmin = await effective(second)
    const enrollmentId = await mfa.activeEnrollmentId(second.subject.accountId)
    const challenge = await mfa.beginChallenge({ subject: second.subject, enrollmentId })
    out.invalidCode = (await mfa.verifyChallenge({ subject: second.subject, challenge: challenge.challenge, code: '123456' })).code
    out.stillNotAdmin = await effective(second)
    const accepted = code(enrolled.secret)
    out.correctCode = (await mfa.verifyChallenge({ subject: second.subject, challenge: challenge.challenge, code: accepted })).ok
    out.adminAfterChallenge = await effective(second)
    // The same TOTP code cannot be replayed from another session.
    const third = await signIn('admin@example.com')
    const challenge3 = await mfa.beginChallenge({ subject: third.subject, enrollmentId })
    out.replayedTotp = (await mfa.verifyChallenge({ subject: third.subject, challenge: challenge3.challenge, code: accepted })).code
    // A recovery code elevates once.
    out.recovery = (await mfa.recoverWithCode({ subject: third.subject, code: confirmed.recoveryCodes[0].toLowerCase() })).ok
    out.adminAfterRecovery = await effective(third)
    const fourth = await signIn('admin@example.com')
    out.recoveryReplay = (await mfa.recoverWithCode({ subject: fourth.subject, code: confirmed.recoveryCodes[0] })).code
    out.fourthNotAdmin = await effective(fourth)
    // Another account's session cannot use this account's challenge.
    const foreign = await mfa.verifyChallenge({ subject: client.subject, challenge: challenge3.challenge, code: code(enrolled.secret, 1) })
    out.foreignChallenge = foreign.code
    // Regeneration invalidates every previous recovery code.
    now += 30_000
    const regenerated = await mfa.regenerateRecoveryCodes({ subject: second.subject, code: code(enrolled.secret) })
    out.regenerated = regenerated.recoveryCodes.length
    out.oldCodeAfterRegeneration = (await mfa.recoverWithCode({ subject: fourth.subject, code: confirmed.recoveryCodes[1] })).code
    out.newCodeWorks = (await mfa.recoverWithCode({ subject: fourth.subject, code: regenerated.recoveryCodes[0] })).ok
    // Elevation expires with time (12 h).
    now += 13 * 60 * 60 * 1000
    const late = await signIn('admin@example.com')
    out.expiredElevation = await effective(second)
    out.closedWithoutMfaService = isAdmin(await closed.resolve(late.token, 'corr'))
    out.auditSafe = mfaAudit.events.every((event) => { const text = JSON.stringify(event); return !text.includes(enrolled.secret) && !text.includes(accepted) && !confirmed.recoveryCodes.some((c) => text.includes(c)) })
    out.auditKinds = [...new Set(mfaAudit.events.map((event) => event.kind))].sort()
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.clientRaw, false, 'a regular user never has admin permissions')
  assert.equal(result.pendingSignIn, false, 'an allowlisted but unverified email cannot sign in')
  assert.equal(result.adminRawHasPermissions, true, 'the session scope carries the admin permissions...')
  assert.equal(result.adminWithoutMfa, false, '...but the backend does not honor them without MFA')
  assert.deepEqual(result.statusBefore, { enrolled: false, pendingEnrollmentId: null, elevated: false, elevatedUntil: null })
  assert.equal(result.secretFormat, true)
  assert.equal(result.pendingNotAdmin, false, 'an unconfirmed enrollment grants nothing')
  assert.equal(result.wrongConfirm, 'INVALID')
  assert.equal(result.recoveryCount, 8)
  assert.equal(result.adminAfterEnrollment, true, 'confirming proves possession and elevates this session')
  assert.equal(result.secondEnrollment, 'CONFLICT', 'an active factor cannot be silently replaced')
  assert.equal(result.newSessionNotAdmin, false)
  assert.equal(result.invalidCode, 'INVALID')
  assert.equal(result.stillNotAdmin, false)
  assert.equal(result.correctCode, true)
  assert.equal(result.adminAfterChallenge, true)
  assert.equal(result.replayedTotp, 'INVALID', 'a TOTP code is accepted once')
  assert.equal(result.recovery, true, 'recovery codes are case-insensitive')
  assert.equal(result.adminAfterRecovery, true)
  assert.equal(result.recoveryReplay, 'REPLAYED', 'a recovery code works once')
  assert.equal(result.fourthNotAdmin, false)
  assert.equal(result.foreignChallenge, 'FORBIDDEN')
  assert.equal(result.regenerated, 8)
  assert.equal(result.oldCodeAfterRegeneration, 'INVALID')
  assert.equal(result.newCodeWorks, true)
  assert.equal(result.expiredElevation, false, 'the elevation expires')
  assert.equal(result.closedWithoutMfaService, false, 'without MFA configured nobody is admin')
  assert.equal(result.auditSafe, true, 'no secret or code in the audit')
  for (const kind of ['mfa.enrollment_started', 'mfa.enrollment_confirmed', 'mfa.challenge_verified', 'mfa.recovery_used', 'mfa.recovery_codes_regenerated', 'mfa.operation_denied'])
    assert.ok(result.auditKinds.includes(kind), kind)
})

test('MFA ADMIN: disabling needs re-authentication and the second factor, and revokes admin', () => {
  const result = runTypeScriptScenario(`${FLOW}
    const admin = await signIn('admin@example.com')
    const enrolled = await mfa.enroll({ accountId: admin.subject.accountId, subject: admin.subject, label: 'a' })
    const confirmed = await mfa.confirmEnrollment({ subject: admin.subject, enrollmentId: enrolled.enrollmentId, code: code(enrolled.secret) })
    now += 30_000
    const out = {}
    const reauth = async (pwd) => (await auth.service.verifyCurrentPassword(admin.subject.accountId, pwd)) === 'ok'
    out.noReauth = (await mfa.disable({ subject: admin.subject, code: code(enrolled.secret), reauthenticated: await reauth('otra-cosa-incorrecta') })).code
    out.passwordNoCode = (await mfa.disable({ subject: admin.subject, code: '000000', reauthenticated: await reauth(password) })).code
    out.stillAdmin = await effective(admin)
    out.disabled = (await mfa.disable({ subject: admin.subject, code: code(enrolled.secret), reauthenticated: await reauth(password) })).ok
    out.adminAfterDisable = await effective(admin)
    out.recoveryAfterDisable = (await mfa.recoverWithCode({ subject: admin.subject, code: confirmed.recoveryCodes[0] })).code
    out.status = await mfa.status(admin.subject)
    out.noPasswordAccount = await auth.service.verifyCurrentPassword('cuenta-inexistente', password)
    out.audited = mfaAudit.events.some((event) => event.kind === 'mfa.disabled' && event.outcome === 'success')
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.noReauth, 'REAUTHENTICATION_REQUIRED')
  assert.equal(result.passwordNoCode, 'INVALID', 'the password alone does not turn MFA off')
  assert.equal(result.stillAdmin, true)
  assert.equal(result.disabled, true)
  assert.equal(result.adminAfterDisable, false, 'disabling revokes every elevation')
  assert.equal(result.recoveryAfterDisable, 'INVALID', 'recovery codes die with the enrollment')
  assert.equal(result.status.enrolled, false)
  assert.equal(result.noPasswordAccount, 'no_password')
  assert.equal(result.audited, true)
})

test('MFA storage: the TOTP secret is encrypted at rest and bound to its account', () => {
  const result = runTypeScriptScenario(`
    const { randomBytes } = await import('node:crypto')
    const { PrismaMfaStore, createMfaSecretCipher } = await import('./apps/api/src/auth-security/mfa/adapters/prisma-mfa-store.ts')
    const rows = new Map()
    const delegate = (key) => ({
      async findUnique({ where }) { const [field, value] = Object.entries(where)[0]; return [...rows.values()].find((r) => r.__t === key && r[field] === value) ?? null },
      async findFirst({ where }) { return [...rows.values()].find((r) => r.__t === key && Object.entries(where).every(([f, v]) => r[f] === v)) ?? null },
      async upsert({ where, create, update }) { const [field, value] = Object.entries(where)[0]; const found = [...rows.entries()].find(([, r]) => r.__t === key && r[field] === value); if (found) Object.assign(found[1], update); else rows.set(key + ':' + value, { __t: key, ...create }) },
      async updateMany() {},
    })
    const client = { mfaEnrollment: delegate('e'), mfaRecoveryCode: delegate('r'), mfaChallenge: delegate('c'), mfaSessionElevation: delegate('s') }
    const key = randomBytes(32).toString('base64')
    const store = new PrismaMfaStore(client, createMfaSecretCipher(key))
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    await store.saveEnrollment({ id: 'enr-1', accountId: 'acc-1', label: 'a', secret, status: 'active', createdAt: 1, confirmedAt: 2, lastUsedStep: 5, disabledAt: null })
    const row = rows.get('e:enr-1')
    const loaded = await store.findEnrollment('enr-1')
    // A row copied to another account cannot be decrypted (AAD binds enrollment + account).
    rows.set('e:enr-2', { ...row, id: 'enr-2', accountId: 'acc-2' })
    let moved = 'decrypted'
    try { await store.findEnrollment('enr-2') } catch { moved = 'rejected' }
    const otherKey = new PrismaMfaStore(client, createMfaSecretCipher(randomBytes(32).toString('base64')))
    let wrongKey = 'decrypted'
    try { await otherKey.findEnrollment('enr-1') } catch { wrongKey = 'rejected' }
    console.log(JSON.stringify({
      ciphertext: row.secretCiphertext,
      plaintextStored: JSON.stringify([...rows.values()], (k, v) => typeof v === "bigint" ? String(v) : v).includes(secret),
      loaded: loaded.secret === secret && loaded.lastUsedStep === 5,
      moved, wrongKey,
      missingKey: createMfaSecretCipher(undefined), shortKey: createMfaSecretCipher(randomBytes(16).toString('base64')),
    }))
  `)
  assert.match(result.ciphertext, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u)
  assert.equal(result.plaintextStored, false)
  assert.equal(result.loaded, true)
  assert.equal(result.moved, 'rejected')
  assert.equal(result.wrongKey, 'rejected')
  assert.equal(result.missingKey, null)
  assert.equal(result.shortKey, null)
})

test('MFA HTTP: routes are bound to the Bearer session, admin-only and never echo the secret after enrollment', () => {
  const result = runTypeScriptScenario(`${FLOW}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { createMfaRouter } = await import('./apps/api/src/auth-security/mfa/http/mfa-router.ts')
    const app = express()
    app.use(express.json())
    app.use(createMfaRouter({ service: mfa, sessions: raw, accounts: auth.service, reauthenticate: (id, pwd) => auth.service.verifyCurrentPassword(id, pwd), now: clock }))
    const unavailable = express()
    unavailable.use(express.json())
    unavailable.use(createMfaRouter({ service: null, sessions: raw, accounts: auth.service, reauthenticate: async () => 'mismatch' }))
    const listen = (application) => new Promise((resolve) => { const server = application.listen(0, '127.0.0.1', () => resolve(server)) })
    const server = await listen(app)
    const server2 = await listen(unavailable)
    const base = 'http://127.0.0.1:' + server.address().port
    const call = async (path, token, body, target = base) => {
      const response = await fetch(target + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : null, cache: response.headers.get('cache-control') }
    }
    const out = {}
    try {
      const admin = await signIn('admin@example.com')
      const client = await signIn('cliente@example.com')
      out.anonymous = (await call('/auth/mfa/status')).status
      out.client = (await call('/auth/mfa/enroll', client.token, {})).status
      out.spoofedHeader = (await fetch(base + '/auth/mfa/status', { headers: { 'x-account-id': admin.subject.accountId, 'x-session-id': admin.subject.sessionId, 'x-correlation-id': 'corr' } })).status
      const status = await call('/auth/mfa/status', admin.token)
      out.status = status.body
      out.noStore = status.cache
      const enroll = await call('/auth/mfa/enroll', admin.token, {})
      out.enrollStatus = enroll.status
      out.uri = enroll.body.otpauthUri.startsWith('otpauth://totp/TUS:admin%40example.com?secret=' + enroll.body.secret)
      const confirm = await call('/auth/mfa/enroll/confirm', admin.token, { enrollmentId: enroll.body.enrollmentId, code: code(enroll.body.secret) })
      out.confirm = [confirm.status, confirm.body.recoveryCodes.length]
      const after = await call('/auth/mfa/status', admin.token)
      out.after = after.body
      out.secretNeverAgain = !JSON.stringify(after.body).includes(enroll.body.secret)
      now += 30_000
      const second = await signIn('admin@example.com')
      out.wrongCode = (await call('/auth/mfa/verify', second.token, { code: '000000' })).status
      out.rightCode = (await call('/auth/mfa/verify', second.token, { code: code(enroll.body.secret) })).status
      out.elevated = (await call('/auth/mfa/status', second.token)).body.elevated
      out.disableWithoutPassword = (await call('/auth/mfa/disable', second.token, { code: confirm.body.recoveryCodes[0] })).status
      out.unavailable = (await call('/auth/mfa/status', admin.token, undefined, 'http://127.0.0.1:' + server2.address().port)).status
    } finally {
      server.close()
      server2.close()
    }
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.anonymous, 401)
  assert.equal(result.client, 403, 'regular users cannot use the admin MFA routes')
  assert.equal(result.spoofedHeader, 401, 'x-account-id / x-session-id headers are ignored')
  assert.deepEqual(result.status, { required: true, enrolled: false, pendingEnrollmentId: null, elevated: false, elevatedUntil: null })
  assert.equal(result.noStore, 'no-store')
  assert.equal(result.enrollStatus, 201)
  assert.equal(result.uri, true)
  assert.deepEqual(result.confirm, [200, 8])
  assert.equal(result.after.enrolled, true)
  assert.equal(result.after.elevated, true)
  assert.equal(result.secretNeverAgain, true)
  assert.equal(result.wrongCode, 400)
  assert.equal(result.rightCode, 200)
  assert.equal(result.elevated, true)
  assert.equal(result.disableWithoutPassword, 401, 'turning MFA off requires re-authentication')
  assert.equal(result.unavailable, 503, 'without TUS_MFA_ENCRYPTION_KEY MFA is unavailable (and admin closed)')
})

test('MFA wiring: every API router resolves sessions through the MFA gate; only the MFA router sees the raw session', () => {
  const server = read('apps/api/src/server.ts')
  assert.match(server, /const rawSessions = new DurableIdentitySessionResolver\(auth\.store\)/u)
  assert.match(server, /const mfa = createPrismaMfaService\(prisma as unknown as PrismaMfaClient, process\.env\)/u)
  assert.match(server, /const sessions = new MfaAdminSessionResolver\(rawSessions, mfa, auth\.store, \(\) =>\s*leerAdminsPlataforma\(process\.env\['TUS_PLATFORM_ADMIN_EMAILS'\]\)/u)
  assert.equal((server.match(/rawSessions/gu) ?? []).length, 3, 'declared, gated and given to the MFA router only')
  assert.match(server, /createTusHttpRouter\(\{ application, sessions, whatsapp \}\)/u)
  assert.match(server, /'\/auth\/mfa',\s*'\/auth\/verify-email\/resend',\s*'\/auth\/admin\/bootstrap-verify',\s*\],\s*authRateLimitMiddleware/u)
  const migration = read('apps/api/prisma/migrations/20261005100000_tus_admin_mfa/migration.sql')
  assert.doesNotMatch(migration, /\bDROP\b|ALTER TABLE|TRUNCATE|DELETE FROM|UPDATE public/iu, 'additive migration')
  assert.match(migration, /"secret_ciphertext" text NOT NULL/u)
  assert.doesNotMatch(migration, /"secret" text/u, 'no plaintext secret column')
  assert.match(migration, /UNIQUE INDEX "uq_mfa_enrollments_account_active"[^;]*WHERE "status" = 'active'/u)
  // The old router trusted x-account-id headers; it must not come back.
  assert.doesNotMatch(read('apps/api/src/auth-security/mfa/http/mfa-router.ts'), /x-account-id|x-session-id/u)
  assert.match(read('.env.example'), /^TUS_MFA_ENCRYPTION_KEY=$/mu)
})

test('MFA Web: every admin page renders behind the MFA gate and the Web never grants admin', () => {
  for (const page of ['identidad', 'whatsapp', 'seguridad']) {
    const source = read(`apps/web/src/app/tus/admin/${page}/page.tsx`)
    assert.match(source, new RegExp(`<AdminMfaGate returnTo="/tus/admin/${page}">`, 'u'), page)
  }
  const gate = read('apps/web/src/components/admin/admin-mfa-gate.tsx')
  assert.match(gate, /adminMfa\.status\(current\)/u, 'the API status decides what is rendered')
  const client = read('apps/web/src/lib/tus-admin-mfa.ts')
  assert.match(client, /credentials: 'include'/u, 'the HttpOnly session cookie authenticates the Web')
  assert.match(client, /\.\.\.authorizationHeader\(session\.accessToken\)/u)
  // No admin email and no permission minting in the Web bundle.
  for (const file of ['apps/web/src/components/admin/admin-mfa-gate.tsx', 'apps/web/src/lib/tus-admin-mfa.ts', 'apps/web/src/components/admin/seguridad-admin.tsx']) {
    const source = read(file)
    assert.doesNotMatch(source, /hotmail\.com|TUS_PLATFORM_ADMIN_EMAILS|tus:(?:payments|identity):admin/u, file)
    assert.doesNotMatch(source, /localStorage|console\.log/u, file)
  }
})
