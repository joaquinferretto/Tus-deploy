import type { CrudResultCode } from './types.js'

export class CrudValidationError extends Error {
  readonly code = 'CRUD_VALIDATION_FAILED'

  constructor(message: string, readonly reason: string = message) {
    super(message)
    this.name = 'CrudValidationError'
  }
}

export class CrudQueryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CrudQueryError'
  }
}

export interface CrudFailure {
  ok: false
  code: CrudResultCode | string
  message: string
}

export function crudFailure(code: CrudResultCode | string, message: string): CrudFailure {
  return { ok: false, code, message }
}
