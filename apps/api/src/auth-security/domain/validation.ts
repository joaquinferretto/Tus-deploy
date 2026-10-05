export const GENERIC_AUTH_FAILURE_MESSAGE = 'Invalid credentials'
export const GENERIC_RECOVERY_MESSAGE = 'If the account exists, recovery instructions will be sent.'

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US')
}

export function validateEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function validatePassword(password: string): boolean {
  return password.length >= 12 && password.length <= 256
}

// The name an account shows: a person ("María José Pérez") or, for a provider the administration
// created, a trade name ("Plomería 24"). One line, composed (NFC), inner spaces collapsed, 1 to
// 120 characters, without control characters or the invisible ones that hide or reorder text.
// Returns the normalized name, or null.
export const DISPLAY_NAME_LENGTH = { min: 1, max: 120 } as const
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200b], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff]]
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.normalize('NFC').replace(/\s+/gu, ' ').trim()
  const length = [...name].length
  if (length < DISPLAY_NAME_LENGTH.min || length > DISPLAY_NAME_LENGTH.max) return null
  for (const character of name) {
    const code = character.codePointAt(0)!
    if (HIDDEN_RANGES.some(([from, to]) => code >= from && code <= to)) return null
  }
  return name
}

// What an account may change about itself. Anything else in the body is not a field of this form.
export const OWN_ACCOUNT_FIELDS = ['displayName'] as const

export function hasPrivilegeMutation(changes: Record<string, unknown>): boolean {
  return ['roles', 'role', 'permissions', 'tenantId', 'status', 'isSuperadmin'].some(
    (key) => key in changes
  )
}
