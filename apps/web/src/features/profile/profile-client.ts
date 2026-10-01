import type { ActualizarPerfilPersonal, ErroresPerfil, LocalidadDTO, PaisDTO, PerfilPersonalDTO, ProvinciaDTO } from '@factory/contracts'

import { resolveWebApiBaseUrl } from '../../lib/api-url'
import type { TusWebSession } from '../../lib/tus-ui-contract'
import { authorizationHeader, fetchWithSession } from '../../lib/session-credentials'

// "Mi perfil": the session's own account (GET /auth/account) and personal profile
// (GET/PUT /tus/v1/perfil). The id always comes from the server session; the Web only sends the
// credential. Countries, provinces and localities come from the API catalog (never a list in the
// Web code).

export interface OwnAccount {
  id: string
  email: string
  displayName: string
  roles: string[]
  status: string
  emailVerifiedAt: number | null
}

export type SaveProfileResult =
  | { ok: true; perfil: PerfilPersonalDTO }
  | { ok: false; code: 'INVALID_PROFILE'; errores: ErroresPerfil }
  | { ok: false; code: 'DOCUMENT_ALREADY_REGISTERED' | 'UNAVAILABLE' }

function apiBase(): string {
  return resolveWebApiBaseUrl({
    canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
    legacyUrl: process.env['API_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  })
}

export function createProfileClient(session: TusWebSession, fetchImpl: typeof fetch = fetchWithSession) {
  const headers = (json = false): Record<string, string> => ({
    Accept: 'application/json',
    ...authorizationHeader(session.accessToken),
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
    async profile(): Promise<PerfilPersonalDTO> {
      const response = await fetchImpl(`${apiBase()}/tus/v1/perfil`, { cache: 'no-store', headers: headers() })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return ((await response.json()) as { perfil: PerfilPersonalDTO }).perfil
    },
    async saveProfile(input: ActualizarPerfilPersonal): Promise<SaveProfileResult> {
      const response = await fetchImpl(`${apiBase()}/tus/v1/perfil`, { method: 'PUT', cache: 'no-store', headers: headers(true), body: JSON.stringify(input) }).catch(() => null)
      if (!response) return { ok: false, code: 'UNAVAILABLE' }
      const body = (await response.json().catch(() => null)) as { perfil?: PerfilPersonalDTO; error?: { code?: string; details?: ErroresPerfil } } | null
      if (response.ok && body?.perfil) return { ok: true, perfil: body.perfil }
      if (response.status === 422) return { ok: false, code: 'INVALID_PROFILE', errores: body?.error?.details ?? {} }
      if (response.status === 409) return { ok: false, code: 'DOCUMENT_ALREADY_REGISTERED' }
      return { ok: false, code: 'UNAVAILABLE' }
    },
  }
}

// Geography catalog (public reference data served by the API).
export function createGeographyClient(fetchImpl: typeof fetch = fetchWithSession) {
  const items = async <T>(path: string): Promise<T[]> => {
    const response = await fetchImpl(`${apiBase()}${path}`, { headers: { Accept: 'application/json', 'X-Correlation-Id': crypto.randomUUID() } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return ((await response.json()) as { items: T[] }).items
  }
  return {
    countries: () => items<PaisDTO>('/tus/v1/geografia/paises'),
    provinces: (countryId: string) => items<ProvinciaDTO>(`/tus/v1/geografia/provincias?paisId=${encodeURIComponent(countryId)}`),
    localities: (provinceId: string) => items<LocalidadDTO>(`/tus/v1/geografia/localidades?provinciaId=${encodeURIComponent(provinceId)}`),
  }
}

// Same rule as the API (non-empty) plus a sane length for the public "Laura M." derivation.
export function validDisplayName(value: string): boolean {
  const name = value.trim()
  return name.length >= 2 && name.length <= 60
}
