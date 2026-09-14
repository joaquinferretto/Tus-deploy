import { TUS_CONTRACT_VERSION, type LineaCarrito, type Compromiso, type TusTenantContext } from '@factory/contracts'

export interface SplitCartInput extends TusTenantContext {
  cartId: string
  lines: LineaCarrito[]
  createdAt: string
}

export function splitCartIntoCommitments(input: SplitCartInput): Compromiso[] {
  const commitments: Compromiso[] = []
  for (const context of ['product', 'service'] as const) {
    const lines = input.lines.filter((line) => line.context === context)
    if (lines.length === 0) continue
    const firstLine = lines[0]
    if (firstLine === undefined) continue

    const merchantIds = new Set(lines.map((line) => line.merchantId))
    if (merchantIds.size !== 1) {
      throw new Error(`Mixed ${context} commitment requires one merchant`)
    }

    commitments.push({
      contractVersion: TUS_CONTRACT_VERSION,
      commitmentId: `${input.cartId}-${context}`,
      cartId: input.cartId,
      tenantId: input.tenantId,
      merchantId: firstLine.merchantId,
      context,
      amount: lines.reduce((total, line) => total + line.amount, 0),
      currency: firstLine.currency,
      status: 'pending',
      lineIds: lines.map((line) => line.lineId),
      version: 1,
      createdAt: input.createdAt,
    })
  }
  return commitments
}

export function authorizeCommitmentAccess(
  context: Pick<TusTenantContext, 'tenantId'>,
  commitment: Pick<Compromiso, 'tenantId'>,
): { allowed: true } | { allowed: false; reason: 'tenant_mismatch' } {
  return context.tenantId === commitment.tenantId
    ? { allowed: true }
    : { allowed: false, reason: 'tenant_mismatch' }
}
