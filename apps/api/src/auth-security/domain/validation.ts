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

export function hasPrivilegeMutation(changes: Record<string, unknown>): boolean {
  return ['roles', 'role', 'permissions', 'tenantId', 'status', 'isSuperadmin'].some(
    (key) => key in changes
  )
}
