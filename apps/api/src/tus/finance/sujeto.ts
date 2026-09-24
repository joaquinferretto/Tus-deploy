// Shared finance tables (`intenciones_pago`, `instantaneas_comision`, `movimientos_contables`)
// reference exactly one subject: a legacy `compromiso_id` or a service `obligacion_id`.
// PostgreSQL enforces it with `ck_*_sujeto_unico`; this guard rejects the row before the write so
// a programming error surfaces as a typed failure instead of a constraint violation.

export class ErrorSujetoFinanciero extends Error {
  readonly status = 500
  readonly code = 'FINANCIAL_SUBJECT_XOR'

  constructor(message: string) {
    super(message)
    this.name = 'ErrorSujetoFinanciero'
  }
}

export function tieneSujetoFinancieroUnico(row: {
  compromisoId?: unknown
  obligacionId?: unknown
}): boolean {
  return presente(row.compromisoId) !== presente(row.obligacionId)
}

export function asegurarSujetoFinancieroUnico<
  T extends { compromisoId?: unknown; obligacionId?: unknown },
>(row: T): T {
  if (!tieneSujetoFinancieroUnico(row))
    throw new ErrorSujetoFinanciero(
      'finance row must reference exactly one of compromiso_id or obligacion_id'
    )
  return row
}

function presente(value: unknown): boolean {
  return typeof value === 'string' ? value.length > 0 : value !== null && value !== undefined
}
