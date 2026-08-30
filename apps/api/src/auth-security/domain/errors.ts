import type { AuthResultCode } from './constants.js'

export interface AuthFailure {
  ok: false
  code: AuthResultCode
  message: string
}

export function failure(code: AuthResultCode, message: string): AuthFailure {
  return { ok: false, code, message }
}
