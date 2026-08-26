import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })

  return JSON.parse(output.trim())
}

test('auth contracts cover MFA, passkey, OAuth/OIDC, and account-linking boundaries', () => {
  const names = ['mfa', 'passkey', 'oauth-oidc', 'account-linking']
  const schemas = names.map((name) =>
    JSON.parse(
      readFileSync(join(root, `packages/contracts/schemas/auth/${name}.schema.json`), 'utf8')
    )
  )

  assert.deepEqual(
    schemas.map((schema) => schema.$id),
    names.map((name) => `https://golden-boilerplate.dev/contracts/auth/${name}.v1.schema.json`)
  )
  assert.ok(
    schemas.every((schema) => schema.type === 'object' && schema.additionalProperties === false)
  )
})

test('MFA enrollment and recovery require an authenticated subject, expire, replay-deny, and rate-limit', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryMfaService } = (await import('./apps/api/src/auth-security/mfa/composition.ts')).default
    let now = 1_700_000_000_000
    const mfa = createInMemoryMfaService({ now: () => now, enrollmentCode: '654321' })
    const unauthenticated = await mfa.enroll({ accountId: 'account-a', subject: undefined, label: 'Phone' })
    const enrollment = await mfa.enroll({ accountId: 'account-a', subject: { accountId: 'account-a', sessionId: 'session-a' }, label: 'Phone' })
    const confirmed = await mfa.confirmEnrollment({ subject: { accountId: 'account-a', sessionId: 'session-a' }, enrollmentId: enrollment.enrollmentId, code: '654321' })
    const challenge = await mfa.beginChallenge({ subject: { accountId: 'account-a', sessionId: 'session-a' }, enrollmentId: enrollment.enrollmentId })
    const verified = await mfa.verifyChallenge({ subject: { accountId: 'account-a', sessionId: 'session-a' }, challenge: challenge.challenge, code: '654321' })
    const replayed = await mfa.verifyChallenge({ subject: { accountId: 'account-a', sessionId: 'session-a' }, challenge: challenge.challenge, code: '654321' })
    const recoveryCode = confirmed.ok ? confirmed.recoveryCodes[0] : ''
    const recovered = await mfa.recoverWithCode({ subject: { accountId: 'account-a', sessionId: 'session-a' }, code: recoveryCode })
    const recoveryReplay = await mfa.recoverWithCode({ subject: { accountId: 'account-a', sessionId: 'session-a' }, code: recoveryCode })
    const expiringChallenge = await mfa.beginChallenge({ subject: { accountId: 'account-a', sessionId: 'session-a' }, enrollmentId: enrollment.enrollmentId })
    now += 6 * 60 * 1000
    const expired = await mfa.verifyChallenge({ subject: { accountId: 'account-a', sessionId: 'session-a' }, challenge: expiringChallenge.challenge, code: '654321' })
    const rateLimited = await Promise.all(Array.from({ length: 6 }, () => mfa.beginChallenge({ subject: { accountId: 'account-a', sessionId: 'session-a' }, enrollmentId: enrollment.enrollmentId })))

    console.log(JSON.stringify({
      unauthenticated: unauthenticated.code,
      confirmed: confirmed.ok,
      recoveryCodeReturned: recoveryCode.length > 0,
      verified: verified.ok,
      replayed: replayed.code,
      recovered: recovered.ok,
      recoveryReplay: recoveryReplay.code,
      expired: expired.code,
      rateLimited: rateLimited.filter((item) => item.code === 'RATE_LIMITED').length > 0,
      auditSafe: mfa.audit.events.every((event) => !JSON.stringify(event).includes('654321') && !JSON.stringify(event).includes(recoveryCode)),
    }))
  `)

  assert.deepEqual(result, {
    unauthenticated: 'FORBIDDEN',
    confirmed: true,
    recoveryCodeReturned: true,
    verified: true,
    replayed: 'REPLAYED',
    recovered: true,
    recoveryReplay: 'REPLAYED',
    expired: 'EXPIRED',
    rateLimited: true,
    auditSafe: true,
  })
})

test('passkey ceremonies enforce origin, RP ID, user verification, expiry, and authenticated enrollment', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryPasskeyService } = (await import('./apps/api/src/auth-security/passkeys/composition.ts')).default
    let now = 1_700_000_000_000
    const passkeys = createInMemoryPasskeyService({ now: () => now })
    const denied = await passkeys.beginRegistration({ subject: undefined, rpId: 'app.example.test', origin: 'https://app.example.test' })
    const ceremony = await passkeys.beginRegistration({ subject: { accountId: 'account-a', sessionId: 'session-a' }, rpId: 'app.example.test', origin: 'https://app.example.test' })
    const wrongOrigin = await passkeys.finishRegistration({ subject: { accountId: 'account-a', sessionId: 'session-a' }, ceremonyId: ceremony.ceremonyId, response: { challenge: ceremony.challenge, origin: 'https://evil.example.test', rpId: 'app.example.test', type: 'webauthn.create', userVerification: true, credentialId: 'credential-a', proof: 'fake-proof' } })
    const registered = await passkeys.finishRegistration({ subject: { accountId: 'account-a', sessionId: 'session-a' }, ceremonyId: ceremony.ceremonyId, response: { challenge: ceremony.challenge, origin: 'https://app.example.test', rpId: 'app.example.test', type: 'webauthn.create', userVerification: true, credentialId: 'credential-a', proof: 'fake-proof' } })
    const replay = await passkeys.finishRegistration({ subject: { accountId: 'account-a', sessionId: 'session-a' }, ceremonyId: ceremony.ceremonyId, response: { challenge: ceremony.challenge, origin: 'https://app.example.test', rpId: 'app.example.test', type: 'webauthn.create', userVerification: true, credentialId: 'credential-a', proof: 'fake-proof' } })
    const expiring = await passkeys.beginRegistration({ subject: { accountId: 'account-a', sessionId: 'session-a' }, rpId: 'app.example.test', origin: 'https://app.example.test' })
    now += 6 * 60 * 1000
    const expired = await passkeys.finishRegistration({ subject: { accountId: 'account-a', sessionId: 'session-a' }, ceremonyId: expiring.ceremonyId, response: { challenge: expiring.challenge, origin: 'https://app.example.test', rpId: 'app.example.test', type: 'webauthn.create', userVerification: true, credentialId: 'credential-b', proof: 'fake-proof' } })

    console.log(JSON.stringify({ denied: denied.code, wrongOrigin: wrongOrigin.code, registered: registered.ok, replay: replay.code, expired: expired.code, credentialCount: passkeys.store.credentials.size }))
  `)

  assert.deepEqual(result, {
    denied: 'FORBIDDEN',
    wrongOrigin: 'PHISHING_RESISTANCE_FAILED',
    registered: true,
    replay: 'REPLAYED',
    expired: 'EXPIRED',
    credentialCount: 1,
  })
})

test('OAuth/OIDC callback requires provider gate, state, nonce, issuer, audience, and PKCE', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryOAuthOidcService } = (await import('./apps/api/src/auth-security/oauth-oidc/composition.ts')).default
    const oauth = createInMemoryOAuthOidcService()
    const unavailable = await oauth.beginAuthorization({ providerId: 'disabled', redirectUri: 'https://app.example.test/callback' })
    const started = await oauth.beginAuthorization({ providerId: 'local', redirectUri: 'https://app.example.test/callback' })
    oauth.provider.issueCode('code-valid', { subject: 'external-a', email: 'external@example.test' })
    const linkedIdentity = await oauth.handleCallback({ providerId: 'local', redirectUri: 'https://app.example.test/callback', state: started.state, code: 'code-valid' })
    const replay = await oauth.handleCallback({ providerId: 'local', redirectUri: 'https://app.example.test/callback', state: started.state, code: 'code-valid' })
    const badStateStart = await oauth.beginAuthorization({ providerId: 'local', redirectUri: 'https://app.example.test/callback' })
    oauth.provider.issueCode('code-bad-state', { subject: 'external-b', email: 'other@example.test' })
    const badState = await oauth.handleCallback({ providerId: 'local', redirectUri: 'https://app.example.test/callback', state: badStateStart.state + 'tampered', code: 'code-bad-state' })
    const badNonceStart = await oauth.beginAuthorization({ providerId: 'local', redirectUri: 'https://app.example.test/callback' })
    oauth.provider.issueCode('code-bad-nonce', { subject: 'external-c', email: 'nonce@example.test' }, { nonce: 'tampered' })
    const badNonce = await oauth.handleCallback({ providerId: 'local', redirectUri: 'https://app.example.test/callback', state: badNonceStart.state, code: 'code-bad-nonce' })
    const badPkceStart = await oauth.beginAuthorization({ providerId: 'local', redirectUri: 'https://app.example.test/callback' })
    oauth.provider.issueCode('code-bad-pkce', { subject: 'external-d', email: 'pkce@example.test' }, { expectedCodeChallenge: 'wrong-challenge' })
    const badPkce = await oauth.handleCallback({ providerId: 'local', redirectUri: 'https://app.example.test/callback', state: badPkceStart.state, code: 'code-bad-pkce' })

    console.log(JSON.stringify({ unavailable: unavailable.code, hasPkce: started.authorizationUrl.includes('code_challenge=') && started.authorizationUrl.includes('state='), linked: linkedIdentity.ok, replay: replay.code, badState: badState.code, badNonce: badNonce.code, badPkce: badPkce.code }))
  `)

  assert.deepEqual(result, {
    unavailable: 'PROVIDER_UNAVAILABLE',
    hasPkce: true,
    linked: true,
    replay: 'REPLAYED',
    badState: 'INVALID_STATE',
    badNonce: 'INVALID_NONCE',
    badPkce: 'PKCE_FAILED',
  })
})

test('account linking denies collisions, stale or cross-account actors, and unlinking the last method', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAccountLinkingService } = (await import('./apps/api/src/auth-security/account-linking/composition.ts')).default
    let now = 1_700_000_000_000
    const linking = createInMemoryAccountLinkingService({ now: () => now })
    linking.seedAccount({ accountId: 'account-a', passwordCredential: true })
    linking.seedAccount({ accountId: 'account-b', passwordCredential: true })
    const identity = { providerId: 'local', subject: 'external-a', email: 'external@example.test', issuer: 'https://idp.example.test' }
    const linked = await linking.link({ actorId: 'account-a', accountId: 'account-a', authenticatedAt: now, identity })
    const collision = await linking.link({ actorId: 'account-b', accountId: 'account-b', authenticatedAt: now, identity })
    const crossAccount = await linking.link({ actorId: 'account-a', accountId: 'account-b', authenticatedAt: now, identity: { ...identity, subject: 'external-b' } })
    now += 6 * 60 * 1000
    const stale = await linking.link({ actorId: 'account-a', accountId: 'account-a', authenticatedAt: 1_700_000_000_000, identity: { ...identity, subject: 'external-c' } })
    const unlinked = await linking.unlink({ actorId: 'account-a', accountId: 'account-a', authenticatedAt: now, providerId: 'local', subject: 'external-a' })
    linking.seedAccount({ accountId: 'account-c', passwordCredential: false })
    await linking.link({ actorId: 'account-c', accountId: 'account-c', authenticatedAt: now, identity: { ...identity, subject: 'external-c' } })
    const lastMethod = await linking.unlink({ actorId: 'account-c', accountId: 'account-c', authenticatedAt: now, providerId: 'local', subject: 'external-c' })

    console.log(JSON.stringify({ linked: linked.ok, collision: collision.code, crossAccount: crossAccount.code, stale: stale.code, unlinked: unlinked.ok, lastMethod: lastMethod.code, auditSafe: linking.audit.events.every((event) => !JSON.stringify(event).includes('external@example.test')) }))
  `)

  assert.deepEqual(result, {
    linked: true,
    collision: 'IDENTITY_COLLISION',
    crossAccount: 'FORBIDDEN',
    stale: 'RECENT_AUTH_REQUIRED',
    unlinked: true,
    lastMethod: 'LAST_AUTHENTICATOR',
    auditSafe: true,
  })
})

test('canonical contract validation includes the P1.5 auth schemas', () => {
  const output = execFileSync(
    process.execPath,
    ['packages/contracts/scripts/validate-schemas.mjs'],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )

  assert.match(output, /Validated 90 JSON Schema contract\(s\)/)
})
