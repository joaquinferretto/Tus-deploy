import { resolveWebApiBaseUrl } from './api-url'

// Client of the API MFA routes for platform administration. The API decides everything (who is
// an admin candidate, whether this session passed the second factor); the Web only renders.

export interface AdminMfaStatus {
  required: boolean
  enrolled: boolean
  pendingEnrollmentId: string | null
  elevated: boolean
  elevatedUntil: number | null
}

export interface AdminMfaEnrollment {
  enrollmentId: string
  secret: string
  otpauthUri: string
}

export class AdminMfaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code)
  }
}

interface MfaSession {
  accessToken: string
}

async function call<T>(session: MfaSession, path: string, body?: Record<string, string>): Promise<T> {
  const baseUrl = resolveWebApiBaseUrl({
    canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
    legacyUrl: process.env['API_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  })
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      'X-Correlation-Id': crypto.randomUUID(),
    },
    credentials: 'omit',
    cache: 'no-store',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null
    const code = typeof payload?.error?.code === 'string' ? payload.error.code : 'ERROR'
    throw new AdminMfaError(response.status, code)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const adminMfa = {
  status: (session: MfaSession) => call<AdminMfaStatus>(session, '/auth/mfa/status'),
  enroll: (session: MfaSession) => call<AdminMfaEnrollment>(session, '/auth/mfa/enroll', {}),
  confirm: (session: MfaSession, enrollmentId: string, code: string) =>
    call<{ recoveryCodes: string[] }>(session, '/auth/mfa/enroll/confirm', { enrollmentId, code }),
  verify: (session: MfaSession, code: string) => call<void>(session, '/auth/mfa/verify', { code }),
  recover: (session: MfaSession, code: string) => call<void>(session, '/auth/mfa/recover', { code }),
  regenerate: (session: MfaSession, code: string) =>
    call<{ recoveryCodes: string[] }>(session, '/auth/mfa/recovery-codes', { code }),
  disable: (session: MfaSession, password: string, code: string) =>
    call<void>(session, '/auth/mfa/disable', { password, code }),
}

export function mensajeErrorMfa(error: unknown): string {
  if (!(error instanceof AdminMfaError)) return 'No se pudo contactar al servidor. Probá de nuevo.'
  switch (error.code) {
    case 'INVALID':
      return 'El código no es válido. Revisá la hora del teléfono y usá el código actual.'
    case 'REPLAYED':
      return 'Ese código ya se usó.'
    case 'RATE_LIMITED':
      return 'Demasiados intentos. Esperá 15 minutos antes de volver a probar.'
    case 'REAUTHENTICATION_REQUIRED':
      return 'Tenés que confirmar tu contraseña actual.'
    case 'CONFLICT':
      return 'El segundo factor ya está activo.'
    case 'MFA_UNAVAILABLE':
      return 'El MFA no está configurado en el servidor (falta TUS_MFA_ENCRYPTION_KEY). La administración queda cerrada.'
    case 'FORBIDDEN':
      return 'Esta cuenta no es administradora de la plataforma.'
    case 'UNAUTHORIZED':
      return 'Tu sesión venció. Ingresá de nuevo.'
    default:
      return 'No se pudo completar la operación.'
  }
}

// Base32 secret grouped in blocks of 4 so it can be typed into an authenticator app.
export function agruparSecreto(secret: string): string {
  return secret.replace(/(.{4})/gu, '$1 ').trim()
}
