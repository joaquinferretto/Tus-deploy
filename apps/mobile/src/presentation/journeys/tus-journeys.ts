export const MOBILE_JOURNEY = {
  HOME: 'home',
  POS: 'pos',
} as const

export type MobileJourney = (typeof MOBILE_JOURNEY)[keyof typeof MOBILE_JOURNEY]

export interface MobileJourneyAccessInput {
  roles?: readonly string[]
  permissions?: readonly string[]
}

export interface MobileJourneyLink {
  key: MobileJourney
  label: string
  allowed: boolean
}

export interface MobilePosModePresentation {
  label: string
  description: string
}

export function resolveMobileJourneyLinks(input: MobileJourneyAccessInput = {}): MobileJourneyLink[] {
  const permissions = new Set(input.permissions ?? [])
  const roles = new Set((input.roles ?? []).map((role) => role.trim().toLowerCase()))
  const canUsePos = permissions.has('tus:pos:write') || permissions.has('tus:pos') || roles.has('staff') || roles.has('pos') || roles.has('merchant') || roles.has('admin')
  return [
    { key: MOBILE_JOURNEY.HOME, label: 'Workspace home', allowed: true },
    { key: MOBILE_JOURNEY.POS, label: 'Staff POS', allowed: canUsePos },
  ]
}

export function resolveMobileRoleLabel(roles: readonly string[] = []): string {
  const normalized = roles.map((role) => role.trim().toLowerCase())
  if (normalized.some((role) => role === 'staff' || role === 'pos')) return 'Staff workspace'
  if (normalized.some((role) => role === 'merchant' || role === 'seller')) return 'Merchant workspace'
  return 'Customer workspace'
}

export function resolveMobilePosMode(mode: 'product' | 'service'): MobilePosModePresentation {
  if (mode === 'product') return { label: 'Product sale', description: 'Stock is checked by TUS before the product commitment is recorded.' }
  return { label: 'Service capture', description: 'Capacity and slot facts stay separate from product stock and payment.' }
}

export default { resolveMobileJourneyLinks, resolveMobilePosMode, resolveMobileRoleLabel }
