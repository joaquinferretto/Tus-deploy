// Client-side checks only improve UX; the API repeats every validation and remains the authority.

export const MIN_PASSWORD_LENGTH = 12 // Same rule as the API (auth-security validatePassword).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export type FieldErrors = Partial<Record<'email' | 'password' | 'confirmation' | 'firstName' | 'lastName' | 'terms', string>>

export function validateLogin(input: { email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {}
  if (!EMAIL.test(input.email.trim())) errors.email = 'Ingresá un correo válido.'
  if (!input.password) errors.password = 'Ingresá tu contraseña.'
  return errors
}

export function validateRegister(input: {
  firstName: string
  lastName: string
  email: string
  password: string
  confirmation: string
  acceptedTerms: boolean
}): FieldErrors {
  const errors: FieldErrors = {}
  if (!input.firstName.trim()) errors.firstName = 'Ingresá tu nombre.'
  if (!input.lastName.trim()) errors.lastName = 'Ingresá tu apellido.'
  if (!EMAIL.test(input.email.trim())) errors.email = 'Ingresá un correo válido.'
  if (input.password.length < MIN_PASSWORD_LENGTH) errors.password = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  if (input.confirmation !== input.password) errors.confirmation = 'Las contraseñas no coinciden.'
  if (!input.acceptedTerms) errors.terms = 'Tenés que aceptar los términos para continuar.'
  return errors
}

// Never reveals whether an email is registered (no account enumeration).
export function signInErrorMessage(status: string): string {
  return status === 'unavailable' ? 'No pudimos conectar con TUS. Probá de nuevo en unos minutos.' : 'El correo o la contraseña no son correctos.'
}

export function registerErrorMessage(): string {
  return 'No pudimos crear la cuenta. Revisá los datos o, si ya tenés una cuenta, iniciá sesión.'
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_unavailable: 'El ingreso con Google todavía no está disponible.',
  google_cancelled: 'Cancelaste el ingreso con Google.',
  google_invalid: 'No pudimos confirmar el ingreso con Google. Probá de nuevo.',
  google_email_not_verified: 'Tu cuenta de Google no tiene el correo verificado.',
}

export function googleErrorMessage(code: string | null): string | null {
  return code ? (GOOGLE_ERRORS[code] ?? GOOGLE_ERRORS['google_invalid']!) : null
}

// Registration intent only chooses where to go next; it never grants a role.
export type RoleIntent = 'cliente' | 'prestador'

export function destinationFor(intent: RoleIntent): '/tus/mercado' | '/tus/prestador' {
  return intent === 'prestador' ? '/tus/prestador' : '/tus/mercado'
}

export function readFragmentParam(hash: string, key: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/u, ''))
  const value = params.get(key)
  return value && /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null
}

// ---- volver a donde estaba el usuario después de iniciar sesión o registrarse ------------------
// El destino sobrevive al viaje a Google y a la verificación del correo en sessionStorage. Solo
// rutas internas ("/..."), nunca URLs externas.
const RETURN_TO_KEY = 'tus.auth.returnTo'

export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return /^\/(?!\/)[^\s\\]*$/u.test(trimmed) && trimmed.length <= 300 ? trimmed : null
}

export function rememberReturnTo(value: string | null | undefined): void {
  const path = safeInternalPath(value)
  if (!path) return
  try {
    window.sessionStorage.setItem(RETURN_TO_KEY, path)
  } catch {
    // Solo una comodidad: sin storage se vuelve al panel.
  }
}

export function takeReturnTo(): string | null {
  try {
    const path = safeInternalPath(window.sessionStorage.getItem(RETURN_TO_KEY))
    window.sessionStorage.removeItem(RETURN_TO_KEY)
    return path
  } catch {
    return null
  }
}

export function withReturnTo(path: '/sign-in' | '/registro', returnTo: string | null): string {
  const safe = safeInternalPath(returnTo)
  return safe ? `${path}?returnTo=${encodeURIComponent(safe)}` : path
}
