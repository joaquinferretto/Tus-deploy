export const CONTRACT_VERSION = '1.0.0' as const

export type ContractVersion = typeof CONTRACT_VERSION

export class ContractValidationError extends Error {
  readonly contract: string
  readonly version: unknown

  constructor(contract: string, version: unknown, reason: string) {
    super(`Invalid ${contract} contract (${String(version)}): ${reason}`)
    this.name = 'ContractValidationError'
    this.contract = contract
    this.version = version
  }
}
