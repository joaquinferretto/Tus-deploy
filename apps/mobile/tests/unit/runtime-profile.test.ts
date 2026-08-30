import {
  MOBILE_RUNTIME_CONTRACT_VERSION,
  MOBILE_RUNTIME_STORAGE_VERSION,
  parseMobileRuntimeConfig,
  resolveMobileRuntimeConfig,
} from '../../src/core/config/runtime-profile'
import { createTusMobileAuthFetchTransport } from '../../src/application/tus-auth'
import { createTusMobileFetchTransport } from '../../src/application/tus-client'

const stagingRuntime = resolveMobileRuntimeConfig({
  profile: 'staging',
  apiUrl: 'https://api-staging.example.invalid/',
  requireTls: true,
})

describe('mobile runtime profile', () => {
  it('normalizes one staging identity for every consumer', () => {
    expect(stagingRuntime).toEqual({
      profile: 'staging',
      apiUrl: 'https://api-staging.example.invalid',
      requireTls: true,
      storageVersion: MOBILE_RUNTIME_STORAGE_VERSION,
      tusContractVersion: MOBILE_RUNTIME_CONTRACT_VERSION,
      featureFlags: { offlineCache: true, mockAuth: false },
    })
    expect(parseMobileRuntimeConfig(stagingRuntime)).toEqual(stagingRuntime)
  })

  it('uses the API server port for the development default and never defaults a missing profile', () => {
    expect(resolveMobileRuntimeConfig({ profile: 'dev' }).apiUrl).toBe('http://localhost:3001')
    expect(() => resolveMobileRuntimeConfig({})).toThrow(/profile/i)
  })

  it.each([
    { profile: 'unknown', apiUrl: 'https://api.example.invalid', requireTls: true },
    { profile: 'staging', apiUrl: 'http://api.example.invalid', requireTls: true },
    { profile: 'staging', apiUrl: 'https://api.example.invalid', requireTls: false },
    { profile: 'staging', apiUrl: 'not-a-url', requireTls: true },
  ])('rejects invalid or contradictory runtime identity %#', (input) => {
    expect(() => resolveMobileRuntimeConfig(input)).toThrow()
  })

  it('rejects ambiguous environment authorities instead of choosing one silently', () => {
    expect(() => resolveMobileRuntimeConfig({
      appProfile: 'dev',
      publicAppProfile: 'staging',
    })).toThrow(/ambiguous|profile/i)
    expect(() => resolveMobileRuntimeConfig({
      profile: 'staging',
      apiUrl: 'https://one.example.invalid',
      publicApiUrl: 'https://two.example.invalid',
      requireTls: true,
    })).toThrow(/ambiguous|endpoint|api/i)
  })

  it('rejects serialized runtime metadata that is missing or altered', () => {
    expect(() => parseMobileRuntimeConfig({ ...stagingRuntime, profile: 'dev' })).toThrow()
    expect(() => parseMobileRuntimeConfig({ ...stagingRuntime, tusContractVersion: '0.9.0' })).toThrow()
    expect(() => parseMobileRuntimeConfig({ ...stagingRuntime, featureFlags: undefined })).toThrow()
    expect(() => parseMobileRuntimeConfig({ ...stagingRuntime, featureFlags: { ...stagingRuntime.featureFlags, strictTls: false } })).toThrow(/TLS/i)
    expect(() => parseMobileRuntimeConfig(undefined)).toThrow()
  })

  it('rejects endpoint credentials, query authority, and contract spoofing', async () => {
    expect(() => resolveMobileRuntimeConfig({ profile: 'staging', apiUrl: 'https://user:password@example.invalid', requireTls: true })).toThrow(/credentials/i)
    expect(() => resolveMobileRuntimeConfig({ profile: 'staging', apiUrl: 'https://example.invalid?profile=prod', requireTls: true })).toThrow(/query/i)

    const transport = createTusMobileFetchTransport(stagingRuntime)
    await expect(transport.request({
      method: 'POST',
      path: '/tus/v1/pos/manual-operations',
      operation: {
        tenantId: 'tenant-1', actorId: 'actor-1', correlationId: 'corr-1', operationId: 'operation-1',
        idempotencyKey: 'key-1', kind: 'manual-sale', context: 'product', amount: 10, currency: 'ARS',
        deviceId: 'device-1', shiftId: 'shift-1', schemaVersion: '0.9.0', createdAt: '2026-08-28T00:00:00.000Z',
      },
    })).rejects.toThrow(/contract version/i)
  })

  it('uses the injected endpoint and versioned POS route for auth and POS transports', async () => {
    const requests: Array<{ url: string; body: string | undefined }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : undefined })
      return new Response(JSON.stringify({ status: 'accepted', operationId: 'operation-1' }), { status: 200 })
    }

    try {
      const authTransport = createTusMobileAuthFetchTransport(stagingRuntime)
      await authTransport.request({ method: 'POST', path: '/auth/sign-out', correlationId: 'corr-1' })
      const posTransport = createTusMobileFetchTransport(stagingRuntime)
      await posTransport.request({
        method: 'POST',
        path: '/tus/v1/pos/manual-operations',
        operation: {
          tenantId: 'tenant-1',
          actorId: 'actor-1',
          correlationId: 'corr-2',
          operationId: 'operation-1',
          idempotencyKey: 'key-1',
          kind: 'manual-sale',
          context: 'product',
          amount: 10,
          currency: 'ARS',
          deviceId: 'device-1',
          shiftId: 'shift-1',
          schemaVersion: '1.0.0',
          createdAt: '2026-08-28T00:00:00.000Z',
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(requests.map((request) => request.url)).toEqual([
      'https://api-staging.example.invalid/auth/sign-out',
      'https://api-staging.example.invalid/tus/v1/pos/manual-operations',
    ])
    expect(requests[1]?.body).toContain('"schemaVersion":"1.0.0"')
  })
})
