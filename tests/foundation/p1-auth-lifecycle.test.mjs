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

test('identity contracts define neutral account, credential, and lifecycle payloads', () => {
  const schema = JSON.parse(
    readFileSync(
      join(root, 'packages/contracts/schemas/identity/auth-lifecycle.schema.json'),
      'utf8'
    )
  )

  assert.equal(
    schema.$id,
    'https://golden-boilerplate.dev/contracts/identity/auth-lifecycle.v1.schema.json'
  )
  assert.deepEqual(schema.required, [
    'contractVersion',
    'kind',
    'occurredAt',
    'actorId',
    'tenantId',
    'outcome',
  ])
  assert.equal(schema.properties.contractVersion.const, '1.0.0')
})

test('identity schemas participate in the canonical contract validation command', () => {
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

test('verified sign-in issues a scoped session and records redacted security metadata', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAuthService } = (await import('./apps/api/src/auth-security/composition.ts')).default

    const auth = createInMemoryAuthService({ now: () => 1_700_000_000_000 })
    const registration = await auth.register({
      email: 'member@example.com',
      password: 'Correct horse battery staple 42!',
      displayName: 'Neutral Member',
      tenantId: 'workspace-a',
    })
    await auth.verifyEmail({ token: registration.verificationToken })
    const signIn = await auth.signIn({
      email: 'member@example.com',
      password: 'Correct horse battery staple 42!',
      device: { deviceId: 'device-a', label: 'Browser' },
    })

    console.log(JSON.stringify({
      ok: signIn.ok,
      hasSession: signIn.ok && signIn.session.accessToken.length > 20,
      tenantId: signIn.ok ? signIn.session.tenantId : null,
      deviceId: signIn.ok ? signIn.session.deviceId : null,
      eventSafe: auth.audit.events.every((event) => !JSON.stringify(event).includes('Correct horse')),
    }))
  `)

  assert.deepEqual(result, {
    ok: true,
    hasSession: true,
    tenantId: 'workspace-a',
    deviceId: 'device-a',
    eventSafe: true,
  })
})

test('unknown credentials and recovery requests are non-enumerating', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAuthService } = (await import('./apps/api/src/auth-security/composition.ts')).default

    const auth = createInMemoryAuthService({ now: () => 1_700_000_000_000 })
    await auth.register({ email: 'known@example.com', password: 'A secure password 123!', displayName: 'Known' })
    const wrongPassword = await auth.signIn({ email: 'known@example.com', password: 'wrong password' })
    const unknownEmail = await auth.signIn({ email: 'unknown@example.com', password: 'wrong password' })
    const knownRecovery = await auth.requestPasswordRecovery({ email: 'known@example.com' })
    const unknownRecovery = await auth.requestPasswordRecovery({ email: 'unknown@example.com' })

    console.log(JSON.stringify({
      signInSame: JSON.stringify(wrongPassword) === JSON.stringify(unknownEmail),
      signInMessage: wrongPassword.ok ? null : wrongPassword.message,
      recoverySame: JSON.stringify(knownRecovery.public) === JSON.stringify(unknownRecovery.public),
      recoveryMessage: knownRecovery.public.message,
      recoveryEventsSafe: auth.audit.events.every((event) => !JSON.stringify(event).includes('recoveryToken')),
    }))
  `)

  assert.deepEqual(result, {
    signInSame: true,
    signInMessage: 'Invalid credentials',
    recoverySame: true,
    recoveryMessage: 'If the account exists, recovery instructions will be sent.',
    recoveryEventsSafe: true,
  })
})

test('verification, recovery, password change, and credential disable are one-time lifecycle operations', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAuthService } = (await import('./apps/api/src/auth-security/composition.ts')).default

    let now = 1_700_000_000_000
    const auth = createInMemoryAuthService({ now: () => now })
    const registration = await auth.register({ email: 'lifecycle@example.com', password: 'Initial password 123!', displayName: 'Lifecycle' })
    const beforeVerification = await auth.signIn({ email: 'lifecycle@example.com', password: 'Initial password 123!' })
    const verified = await auth.verifyEmail({ token: registration.verificationToken })
    const initialSignIn = await auth.signIn({ email: 'lifecycle@example.com', password: 'Initial password 123!' })
    const reusedVerification = await auth.verifyEmail({ token: registration.verificationToken })
    const recovery = await auth.requestPasswordRecovery({ email: 'lifecycle@example.com' })
    const recovered = await auth.completePasswordRecovery({ token: recovery.recoveryToken, newPassword: 'Recovered password 456!' })
    const reusedRecovery = await auth.completePasswordRecovery({ token: recovery.recoveryToken, newPassword: 'Another password 789!' })
    const changed = await auth.changePassword({ actorId: registration.account.id, currentPassword: 'Recovered password 456!', newPassword: 'Changed password 999!' })
    const disabled = await auth.disableCredential({ actorId: registration.account.id, credentialId: registration.credential.id })
    const afterDisable = await auth.signIn({ email: 'lifecycle@example.com', password: 'Changed password 999!' })

    now += 1
    console.log(JSON.stringify({
      beforeVerification: beforeVerification.ok,
      verified: verified.ok,
      initialSignIn: initialSignIn.ok,
      reusedVerification: reusedVerification.ok,
      recovered: recovered.ok,
      reusedRecovery: reusedRecovery.ok,
      changed: changed.ok,
      disabled: disabled.ok,
      afterDisable: afterDisable.ok,
      sessionsRevoked: [...auth.store.sessions.values()].every((session) => session.revokedAt !== null),
    }))
  `)

  assert.deepEqual(result, {
    beforeVerification: false,
    verified: true,
    initialSignIn: true,
    reusedVerification: false,
    recovered: true,
    reusedRecovery: false,
    changed: true,
    disabled: true,
    afterDisable: false,
    sessionsRevoked: true,
  })
})

test('account updates cannot mutate privilege fields or another actor identity', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAuthService } = (await import('./apps/api/src/auth-security/composition.ts')).default

    const auth = createInMemoryAuthService({ now: () => 1_700_000_000_000 })
    const first = await auth.register({ email: 'first@example.com', password: 'First password 123!', displayName: 'First', tenantId: 'tenant-a' })
    const second = await auth.register({ email: 'second@example.com', password: 'Second password 456!', displayName: 'Second', tenantId: 'tenant-b' })
    const displayName = await auth.updateAccount({ actorId: first.account.id, accountId: first.account.id, changes: { displayName: 'Updated First' } })
    const roleEscalation = await auth.updateAccount({ actorId: first.account.id, accountId: first.account.id, changes: { roles: ['product-superadmin'] } })
    const crossAccount = await auth.updateAccount({ actorId: first.account.id, accountId: second.account.id, changes: { displayName: 'Stolen' } })

    console.log(JSON.stringify({
      displayName: displayName.ok,
      roleEscalation: roleEscalation.ok ? null : roleEscalation.code,
      crossAccount: crossAccount.ok ? null : crossAccount.code,
      storedRole: auth.store.accounts.get(first.account.id)?.roles,
    }))
  `)

  assert.deepEqual(result, {
    displayName: true,
    roleEscalation: 'FORBIDDEN',
    crossAccount: 'FORBIDDEN',
    storedRole: ['member'],
  })
})

test('expired lifecycle tokens and recovery abuse remain denied without disclosure', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAuthService } = (await import('./apps/api/src/auth-security/composition.ts')).default

    let now = 1_700_000_000_000
    const auth = createInMemoryAuthService({ now: () => now })
    const registration = await auth.register({ email: 'expiry@example.com', password: 'Expiry password 123!', displayName: 'Expiry' })
    now += 24 * 60 * 60 * 1000
    const expiredVerification = await auth.verifyEmail({ token: registration.verificationToken })
    const recoveryRequests = []
    for (let index = 0; index < 6; index += 1) {
      recoveryRequests.push(await auth.requestPasswordRecovery({ email: 'expiry@example.com' }))
    }
    const unknownRecovery = await auth.requestPasswordRecovery({ email: 'missing@example.com' })

    console.log(JSON.stringify({
      expiredVerification: expiredVerification.ok,
      rateLimitedStillGeneric: recoveryRequests[5]?.public.message === unknownRecovery.public.message,
      rateLimitedHasNoToken: recoveryRequests[5]?.recoveryToken === undefined,
      unknownHasNoToken: unknownRecovery.recoveryToken === undefined,
    }))
  `)

  assert.deepEqual(result, {
    expiredVerification: false,
    rateLimitedStillGeneric: true,
    rateLimitedHasNoToken: true,
    unknownHasNoToken: true,
  })
})
