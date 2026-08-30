import {
  resolveMobileJourneyLinks,
  resolveMobilePosMode,
  resolveMobileRoleLabel,
} from '../../src/presentation/journeys/tus-journeys'

describe('TUS mobile journey polish', () => {
  it('keeps staff navigation labeled and hides unauthorized destinations without scope leakage', () => {
    const links = resolveMobileJourneyLinks({ roles: ['customer'], permissions: ['tus:read'] })

    expect(links).toEqual([
      { key: 'home', label: 'Workspace home', allowed: true },
      { key: 'pos', label: 'Staff POS', allowed: false },
    ])
    expect(resolveMobileRoleLabel(['customer'])).toBe('Customer workspace')
  })

  it('keeps product and service capture copy separate for staff', () => {
    expect(resolveMobilePosMode('product')).toEqual({
      label: 'Product sale',
      description: 'Stock is checked by TUS before the product commitment is recorded.',
    })
    expect(resolveMobilePosMode('service')).toEqual({
      label: 'Service capture',
      description: 'Capacity and slot facts stay separate from product stock and payment.',
    })
  })
})
