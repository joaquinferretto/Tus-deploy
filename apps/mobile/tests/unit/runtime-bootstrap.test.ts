import { resolveMobileRuntimeConfig, MobileRuntimeConfigError } from '../../src/core/config/runtime-profile'
import {
  bootstrapMobileRuntime,
  createRuntimeDiagnostics,
  type MobileRuntimeDiagnostics,
} from '../../src/core/config/runtime-diagnostics'

describe('mobile runtime startup diagnostics', () => {
  it.each([
    { profile: 'dev' as const, apiUrl: 'http://localhost:3101', requireTls: false },
    { profile: 'staging' as const, apiUrl: 'https://api-staging.example.invalid', requireTls: true },
  ])('reports a safe, versioned %s runtime identity', (input) => {
    const runtime = resolveMobileRuntimeConfig(input)

    expect(createRuntimeDiagnostics(runtime)).toEqual({
      status: 'valid',
      reason: 'validated',
      profile: input.profile,
      apiUrl: input.apiUrl,
      requireTls: input.requireTls,
      storageVersion: 1,
      tusContractVersion: '1.0.0',
      posRoute: '/tus/v1/pos/manual-operations',
      message: expect.stringContaining(`Mobile runtime ready for ${input.profile}`),
    })
  })

  it('redacts invalid configuration details and makes the failure actionable', () => {
    const error = new MobileRuntimeConfigError('apiUrl', 'apiUrl contains password=do-not-show')

    const diagnostics = createRuntimeDiagnostics(error)

    expect(diagnostics).toMatchObject({
      status: 'invalid',
      reason: 'configuration',
      profile: null,
      apiUrl: null,
      storageVersion: null,
      tusContractVersion: null,
      posRoute: '/tus/v1/pos/manual-operations',
    })
    expect(diagnostics.message).toMatch(/apiUrl|endpoint/i)
    expect(diagnostics.message).toMatch(/restart|configuration|check/i)
    expect(diagnostics.message).not.toContain('do-not-show')
    expect(diagnostics.message).not.toContain('password')
  })

  it('rejects storage and TUS contract versions that do not match the API contract', () => {
    const runtime = resolveMobileRuntimeConfig({ profile: 'staging' })

    expect(createRuntimeDiagnostics({ ...runtime, storageVersion: 2 })).toMatchObject({
      status: 'invalid',
      reason: 'configuration',
    })
    expect(createRuntimeDiagnostics({ ...runtime, tusContractVersion: '0.9.0' })).toMatchObject({
      status: 'invalid',
      reason: 'configuration',
    })
  })

  it('fails closed before storage, authentication, or queue bootstrap on invalid config', async () => {
    let storageInitializations = 0
    let authenticationRestores = 0
    const observed: MobileRuntimeDiagnostics[] = []

    const result = await bootstrapMobileRuntime({
      readRuntime: () => {
        throw new MobileRuntimeConfigError('profile', 'unknown profile: prod-secret')
      },
      initializePersistence: async () => {
        storageInitializations += 1
      },
      restoreSession: async () => {
        authenticationRestores += 1
        return { status: 'unauthenticated', message: 'not expected' }
      },
      onDiagnostics: (diagnostics) => observed.push(diagnostics),
    })

    expect(result.status).toBe('unavailable')
    expect(result.sessionState).toBeUndefined()
    expect(storageInitializations).toBe(0)
    expect(authenticationRestores).toBe(0)
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({ status: 'invalid', reason: 'configuration' })
    expect(JSON.stringify(observed[0])).not.toContain('prod-secret')
  })

  it.each(['dev', 'staging'] as const)('records diagnostics before proceeding for %s', async (profile) => {
    const runtime = resolveMobileRuntimeConfig({ profile })
    const order: string[] = []

    const result = await bootstrapMobileRuntime({
      readRuntime: () => runtime,
      initializePersistence: async () => {
        order.push('storage')
      },
      restoreSession: async () => {
        order.push('auth')
        return { status: 'unauthenticated', message: 'Sign in' }
      },
      onDiagnostics: (diagnostics) => {
        order.push(`diagnostics:${diagnostics.status}`)
      },
    })

    expect(result.status).toBe('ready')
    expect(result.diagnostics.profile).toBe(profile)
    expect(order).toEqual(['diagnostics:valid', 'storage', 'auth'])
  })

  it('does not disclose dependency errors after configuration validation', async () => {
    const observed: MobileRuntimeDiagnostics[] = []
    const result = await bootstrapMobileRuntime({
      readRuntime: () => resolveMobileRuntimeConfig({ profile: 'staging' }),
      initializePersistence: async () => {
        throw new Error('secure-token=must-not-be-disclosed')
      },
      restoreSession: async () => ({ status: 'unauthenticated', message: 'not expected' }),
      onDiagnostics: (diagnostics) => observed.push(diagnostics),
    })

    expect(result.status).toBe('unavailable')
    expect(result.diagnostics.reason).toBe('bootstrap')
    expect(result.diagnostics).toMatchObject({ profile: 'staging', apiUrl: 'https://api-staging.example.invalid' })
    expect(result.diagnostics.message).not.toContain('secure-token')
    expect(observed.map((diagnostics) => diagnostics.reason)).toEqual(['validated', 'bootstrap'])
  })
})
