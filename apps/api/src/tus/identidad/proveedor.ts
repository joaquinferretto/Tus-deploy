import type { MetodoVerificacionIdentidad, PersonaFuenteExterna } from './modelo.ts'

// External identity source boundary. The domain never knows about Playwright or HTTP. A future
// `NosisApiIdentityProvider` only has to implement this interface.

export type CodigoErrorProveedorIdentidad =
  | 'NOSIS_SESSION_REQUIRED'
  | 'NOSIS_CHALLENGE_REQUIRED'
  | 'NOSIS_LAYOUT_CHANGED'
  | 'NOSIS_NETWORK'
  | 'NOSIS_UNAVAILABLE'
  | 'NOSIS_RATE_LIMITED'

export class ErrorProveedorIdentidad extends Error {
  constructor(
    readonly code: CodigoErrorProveedorIdentidad,
    message: string,
    // True once the search was actually sent (the slot was consumed).
    readonly searchSubmitted = false
  ) {
    super(message)
    this.name = 'ErrorProveedorIdentidad'
  }
}

export interface ResultadoProveedorIdentidad {
  results: PersonaFuenteExterna[]
  providerReference: string | null
}

export interface IdentityVerificationProvider {
  readonly id: 'nosis-browser' | 'nosis-api' | 'demo'
  readonly method: MetodoVerificacionIdentidad
  // Session checks and navigation: never consume a rate-limit slot.
  prepararSesion(): Promise<void>
  // `consumirSlot` must be called right before the search is submitted; when it returns false
  // the provider must NOT search and throws NOSIS_RATE_LIMITED (searchSubmitted=false).
  consultar(
    query: { documentNumber: string },
    consumirSlot: () => Promise<boolean>
  ): Promise<ResultadoProveedorIdentidad>
  cerrar?(): Promise<void>
}

// Fictitious fixtures only. Same interface and same path through queue, rate limit, matching and
// gates as the real provider. Never allowed in production (see composition).
export class NosisDemoIdentityProvider implements IdentityVerificationProvider {
  readonly id = 'demo' as const
  readonly method = 'demo' as const
  readonly searches: string[] = []
  private readonly failures: ErrorProveedorIdentidad[] = []
  private sessionFailure: ErrorProveedorIdentidad | null = null

  constructor(private readonly fixtures: Record<string, PersonaFuenteExterna[]> = DEMO_FIXTURES) {}

  fallarProximas(...codes: CodigoErrorProveedorIdentidad[]): void {
    this.failures.push(
      ...codes.map(
        (code) =>
          new ErrorProveedorIdentidad(code, `demo ${code}`, code !== 'NOSIS_SESSION_REQUIRED')
      )
    )
  }

  requerirSesion(code: 'NOSIS_SESSION_REQUIRED' | 'NOSIS_CHALLENGE_REQUIRED' | null): void {
    this.sessionFailure = code ? new ErrorProveedorIdentidad(code, `demo ${code}`) : null
  }

  async prepararSesion(): Promise<void> {
    if (this.sessionFailure) throw this.sessionFailure
  }

  async consultar(
    query: { documentNumber: string },
    consumirSlot: () => Promise<boolean>
  ): Promise<ResultadoProveedorIdentidad> {
    if (!(await consumirSlot()))
      throw new ErrorProveedorIdentidad('NOSIS_RATE_LIMITED', 'rate limit reached')
    this.searches.push(query.documentNumber)
    const failure = this.failures.shift()
    if (failure) throw failure
    return {
      results: (this.fixtures[query.documentNumber] ?? []).map((person) => ({ ...person })),
      providerReference: `demo-${this.searches.length}`,
    }
  }
}

// Fictitious people (checksum-valid CUILs, invented names). Not real persons.
export const DEMO_FIXTURES: Record<string, PersonaFuenteExterna[]> = {
  '30111222': [{ documentNumber: '30111222', fullName: 'PRUEBA DEMO, JUAN', cuil: '20301112220' }],
  '30111223': [],
  '30111224': [
    { documentNumber: '30111224', fullName: 'PRUEBA UNO, ANA', cuil: '27301112241' },
    { documentNumber: '30111224', fullName: 'PRUEBA DOS, ANA', cuil: '23301112246' },
  ],
  '30111225': [
    { documentNumber: '30111225', fullName: 'PRUEBA DEMO, JUAN IGNACIO', cuil: '20301112255' },
  ],
  '30111226': [
    { documentNumber: '30111226', fullName: 'OTRA PERSONA, CARLOS', cuil: '20301112263' },
  ],
}
