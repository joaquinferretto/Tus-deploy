jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>()
  return {
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value) },
    deleteItemAsync: async (key: string) => { values.delete(key) },
    isAvailableAsync: async () => true,
  }
})

import { SecureCredentialStore } from '../../src/core/services/secure-credential-store'
import { resolveMobileRuntimeConfig } from '../../src/core/config/runtime-profile'

describe('mobile secure credential boundary', () => {
  it('removes a stale refresh token when a server session only supplies an access token', async () => {
    const runtime = resolveMobileRuntimeConfig({ profile: 'staging' })
    const store = new SecureCredentialStore({ runtime })
    await store.setTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 4102444800000 })

    await store.setSessionToken('session-access', 4102444800000)

    await expect(store.getTokenSnapshot()).resolves.toEqual({ accessToken: 'session-access', refreshToken: null, expiresAt: 4102444800000 })
  })
})
