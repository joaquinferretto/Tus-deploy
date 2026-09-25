import { resolveWebApiBaseUrl } from '../../lib/api-url'
import type { TusWebSession } from '../../lib/tus-ui-contract'

// "Mi perfil": the session's own account (GET /auth/account). The id always comes from the
// server session; the Web only sends the Bearer credential.

export interface OwnAccount {
  id: string
  email: string
  displayName: string
  roles: string[]
  status: string
  emailVerifiedAt: number | null
}

function apiBase(): string {
  return resolveWebApiBaseUrl({
    canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
    legacyUrl: process.env['API_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  })
}

export function createProfileClient(session: TusWebSession, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const headers = (json = false): Record<string, string> => ({
    Accept: 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
    'X-Correlation-Id': session.correlationId,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  })
  return {
    async account(): Promise<OwnAccount> {
      const response = await fetchImpl(`${apiBase()}/auth/account`, { cache: 'no-store', headers: headers() })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return ((await response.json()) as { account: OwnAccount }).account
    },
    async rename(accountId: string, displayName: string): Promise<OwnAccount | null> {
      const response = await fetchImpl(`${apiBase()}/auth/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        cache: 'no-store',
        headers: headers(true),
        body: JSON.stringify({ displayName }),
      })
      return response.ok ? ((await response.json()) as { account: OwnAccount }).account : null
    },
  }
}

// Same rule as the API (non-empty) plus a sane length for the public "Laura M." derivation.
export function validDisplayName(value: string): boolean {
  const name = value.trim()
  return name.length >= 2 && name.length <= 60
}
