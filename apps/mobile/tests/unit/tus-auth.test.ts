import {
  createTusMobileAuthClient,
  sanitizeTusReturnTo,
  type MobileAuthCredentialStore,
} from '../../src/application/tus-auth'

function credentialStore(initial: { accessToken: string | null; expiresAt: number | null }): MobileAuthCredentialStore & { clearCount: number } {
  let current = { ...initial }
  return {
    clearCount: 0,
    async getTokenSnapshot() {
      return { ...current, refreshToken: null }
    },
    async setSessionToken(accessToken, expiresAt) {
      current = { accessToken, expiresAt }
    },
    async clear() {
      this.clearCount += 1
      current = { accessToken: null, expiresAt: null }
    },
  }
}

describe('TUS mobile auth bootstrap', () => {
  it('stores a credential only after server-derived tenant context is confirmed', async () => {
    const credentials = credentialStore({ accessToken: null, expiresAt: null })
    const requests: string[] = []
    const client = createTusMobileAuthClient({
      credentials,
      createCorrelationId: () => 'mobile-correlation',
      transport: {
        async request(input) {
          requests.push(input.path)
          if (input.path === '/auth/sign-in') {
            return { status: 200, body: { session: { id: 'session-1', accessToken: 'mobile-secret', accountId: 'actor-1', tenantId: 'tenant-1', deviceId: 'device-1', scope: { tenantId: 'tenant-1', roles: ['member'], permissions: ['tus:read'] }, expiresAt: 4102444800000 } } }
          }
          return { status: 200, body: { context: { subjectId: 'actor-1', sessionId: 'session-1', tenantId: 'tenant-1', roles: ['member'], permissions: ['tus:read'], correlationId: 'mobile-correlation' } } }
        },
      },
    })

    const state = await client.signIn({ email: 'person@example.com', password: 'secret-password' })

    expect(state.status).toBe('authenticated')
    expect(state.session?.tenantId).toBe('tenant-1')
    expect(state.session?.subjectId).toBe('actor-1')
    expect(requests).toEqual(['/auth/sign-in', '/auth/session'])
    await expect(credentials.getTokenSnapshot()).resolves.toMatchObject({ accessToken: 'mobile-secret' })
  })

  it('clears revoked credentials and sends the user to reauthentication', async () => {
    const credentials = credentialStore({ accessToken: 'revoked-secret', expiresAt: 4102444800000 })
    const client = createTusMobileAuthClient({
      credentials,
      transport: { request: async () => ({ status: 401, body: { code: 'UNAUTHORIZED' } }) },
      createCorrelationId: () => 'mobile-correlation',
      now: () => 1700000000000,
    })

    const state = await client.restore()

    expect(state.status).toBe('expired')
    expect(credentials.clearCount).toBe(1)
  })

  it('distinguishes expired local credentials before making a server request', async () => {
    const credentials = credentialStore({ accessToken: 'expired-secret', expiresAt: 1699999999000 })
    let requestCount = 0
    const client = createTusMobileAuthClient({
      credentials,
      transport: { request: async () => { requestCount += 1; return { status: 200, body: {} } } },
      now: () => 1700000000000,
    })

    const state = await client.restore()

    expect(state.status).toBe('expired')
    expect(requestCount).toBe(0)
    expect(credentials.clearCount).toBe(1)
  })

  it('shows an actionable unauthenticated state when no credential exists', async () => {
    const credentials = credentialStore({ accessToken: null, expiresAt: null })
    let requestCount = 0
    const client = createTusMobileAuthClient({
      credentials,
      transport: { request: async () => { requestCount += 1; return { status: 200, body: {} } } },
    })

    const state = await client.restore()

    expect(state.status).toBe('unauthenticated')
    expect(state.message).toMatch(/sign in/i)
    expect(requestCount).toBe(0)
  })

  it('withholds identity when secure storage is unavailable', async () => {
    const credentials: MobileAuthCredentialStore = {
      async getTokenSnapshot() {
        throw new Error('private storage failure')
      },
      async setSessionToken() {
        throw new Error('not expected')
      },
      async clear() {
        throw new Error('not available')
      },
    }
    const client = createTusMobileAuthClient({
      credentials,
      transport: { request: async () => ({ status: 200, body: {} }) },
    })

    const state = await client.restore()

    expect(state.status).toBe('unavailable')
    expect(state.session).toBeUndefined()
  })

  it('rejects an external return path while preserving an internal deep link', () => {
    expect(sanitizeTusReturnTo('/pos')).toBe('/pos')
    expect(sanitizeTusReturnTo('https://evil.example')).toBe('/(app)')
  })
})
