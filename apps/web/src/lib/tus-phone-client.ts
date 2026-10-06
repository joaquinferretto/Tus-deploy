import { resolveWebApiBaseUrl } from './api-url.ts'
import { fetchWithSession } from './session-credentials'

// Phone identity (verification INITIATED BY THE USER from WhatsApp). The Web never tells the API
// which number sent the message: that comes only from the signed Meta webhook. The Web shows the
// code, opens WhatsApp with the message already written and waits.

export interface DesafioTelefonoWeb {
  challengeId: string
  code: string
  purpose: 'verificar_telefono' | 'cambiar_telefono' | 'recuperar_contrasena'
  phoneMasked: string
  expiresAt: string
  // wa.me link to the official TUS number with "VERIFICAR TUS <code>" written; null when the
  // number is not configured (the page shows the message to send by hand).
  whatsappUrl: string | null
  message: string
  // Flows without a session (sign-up, recovery): the page polls with it.
  pollSecret?: string
}

export interface EstadoDesafioWeb {
  status: 'pending' | 'verified' | 'expired' | 'failed'
  phoneMasked: string | null
  recoveryToken?: string
}

export interface EstadoTelefonoCuentaWeb {
  verified: boolean
  phoneMasked: string | null
  verifiedAt: string | null
  pendingMasked: string | null
  // A verified phone and a linked WhatsApp are different facts.
  whatsappLinked: boolean
}

export class PhoneApiError extends Error {
  // `fields`: the fields whose format the API refused (empty when it named none).
  constructor(readonly status: number, readonly code: string, readonly reason: string | null = null, readonly fields: readonly string[] = []) {
    super(code)
  }
}

const base = () => resolveWebApiBaseUrl({ canonicalUrl: process.env['NEXT_PUBLIC_API_URL'], legacyUrl: process.env['API_BASE_URL'], nodeEnv: process.env['NODE_ENV'] })

async function call<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const response = await fetchWithSession(`${base()}${path}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID() },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    const error = (payload?.['error'] ?? {}) as { code?: unknown; reason?: unknown }
    const fields = Array.isArray(payload?.['fields']) ? (payload['fields'] as unknown[]).filter((field): field is string => typeof field === 'string') : []
    throw new PhoneApiError(response.status, typeof error.code === 'string' ? error.code : 'ERROR', typeof error.reason === 'string' ? error.reason : null, fields)
  }
  return payload as T
}

export const phoneApi = {
  miTelefono: async () => (await call<{ phone: EstadoTelefonoCuentaWeb }>('/auth/phone')).phone,
  // The official TUS WhatsApp number (public), for "Abrir TUS en WhatsApp".
  numeroOficial: async () => (await call<{ whatsappNumber: string | null }>('/auth/phone/config')).whatsappNumber,
  // "Vincular este WhatsApp": a challenge for the account's own verified number (no body).
  vincular: async () => (await call<{ challenge: DesafioTelefonoWeb }>('/auth/phone/whatsapp-link', { method: 'POST' })).challenge,
  iniciar: async (phone: string) => (await call<{ challenge: DesafioTelefonoWeb }>('/auth/phone/challenges', { method: 'POST', body: { phone } })).challenge,
  estadoConSesion: (challengeId: string) => call<EstadoDesafioWeb>(`/auth/phone/challenges/${encodeURIComponent(challengeId)}`),
  estadoConSecreto: (challengeId: string, pollSecret: string) => call<EstadoDesafioWeb>(`/auth/phone/challenges/${encodeURIComponent(challengeId)}/status`, { method: 'POST', body: { pollSecret } }),
  renovar: async (challengeId: string, pollSecret: string) => (await call<{ challenge: DesafioTelefonoWeb }>(`/auth/phone/challenges/${encodeURIComponent(challengeId)}/renew`, { method: 'POST', body: { pollSecret } })).challenge,
  pendiente: async (input: { identifier: string; password: string; phone: string }) => (await call<{ challenge: DesafioTelefonoWeb }>('/auth/phone/pending', { method: 'POST', body: input })).challenge,
  recuperar: async (phone: string) => (await call<{ challenge: DesafioTelefonoWeb }>('/auth/recovery/whatsapp', { method: 'POST', body: { phone } })).challenge,
  registrar: async (input: { email: string; password: string; displayName: string; phone: string }) =>
    call<{ status: 'pending_verification'; phoneVerification?: DesafioTelefonoWeb }>('/auth/register', { method: 'POST', body: input }),
}

// Plain-language messages (older people first): no technical codes on screen.
export function mensajeErrorTelefono(error: unknown): string {
  if (error instanceof PhoneApiError) {
    if (error.code === 'INVALID_PHONE') return 'Revisá el número: escribilo con característica, por ejemplo 379 412-3456.'
    if (error.code === 'RATE_LIMITED') return 'Hiciste muchos intentos seguidos. Esperá unos minutos y probá de nuevo.'
    if (error.code === 'ALREADY_LINKED') return 'Este WhatsApp ya está vinculado a tu cuenta.'
    if (error.code === 'PHONE_NOT_VERIFIED') return 'Primero verificá tu número de celular.'
    if (error.code === 'ALREADY_VERIFIED') return 'Ese número ya está verificado en tu cuenta.'
    if (error.code === 'INVALID_CREDENTIALS') return 'No pudimos encontrar una cuenta pendiente con esos datos. Revisalos o creá una cuenta nueva.'
    if (error.status === 401) return 'Tu sesión venció. Ingresá de nuevo.'
    if (error.code === 'PASSWORD_BREACHED') return 'Esa contraseña apareció en filtraciones de datos conocidas. Elegí otra (una frase larga funciona bien).'
  }
  return 'No pudimos continuar ahora. Probá de nuevo en unos minutos.'
}
