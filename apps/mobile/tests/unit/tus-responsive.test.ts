import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MOBILE_SAFE_AREA_EDGES,
  TUS_MOBILE_LAYOUT,
  resolveTusConnectivityPresentation,
} from '../../src/presentation/layout/tus-responsive'

describe('TUS mobile responsive foundations', () => {
  it('keeps touch targets and safe-area edges explicit across form factors', () => {
    expect(TUS_MOBILE_LAYOUT.minimumTouchTarget).toBe(44)
    expect(TUS_MOBILE_LAYOUT.contentPadding).toBeGreaterThanOrEqual(16)
    expect(MOBILE_SAFE_AREA_EDGES).toEqual(['top', 'right', 'bottom', 'left'])
  })

  it('distinguishes offline, reconnecting, and connected pending work', () => {
    expect(resolveTusConnectivityPresentation({ isOnline: false, pendingCount: 2 })).toEqual({
      status: 'offline',
      label: 'Offline',
      message: 'Pending work stays in the encrypted local queue until TUS is reachable.',
    })
    expect(resolveTusConnectivityPresentation({ isOnline: true, pendingCount: 2 })).toEqual({
      status: 'pending',
      label: 'Connected · pending sync',
      message: 'TUS is reachable. Review the pending queue before syncing.',
    })
    expect(resolveTusConnectivityPresentation({ isOnline: true, pendingCount: 0 })).toEqual({
      status: 'connected',
      label: 'Connected',
      message: 'TUS is reachable for new operations.',
    })
  })

  it('keeps the mobile shell wired to the safe-area provider', () => {
    const source = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8')
    const storeSource = readFileSync(resolve(__dirname, '../../src/store/app-store.ts'), 'utf8')

    expect(source).toMatch(/SafeAreaProvider/)
    expect(source).toMatch(/SafeAreaView/)
    expect(source).toMatch(/MOBILE_SAFE_AREA_EDGES/)
    expect(storeSource).toMatch(/locale: 'es-AR'/)
  })
})
