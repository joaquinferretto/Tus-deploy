import { createMobileLifecycleController } from '../../src/application/mobile-lifecycle'

describe('mobile interruption and reconnect boundaries', () => {
  it('syncs once when connectivity returns and does not resubmit while offline', async () => {
    let online = false
    let pending = 2
    let syncs = 0
    const controller = createMobileLifecycleController({
      isOnline: () => online,
      hasPending: () => pending > 0,
      onConnectivityChange: (next) => { online = next },
      syncPending: async () => { syncs += 1; pending = 0 },
    })

    await controller.onConnectivityChange(false)
    expect(syncs).toBe(0)
    await controller.onConnectivityChange(true)
    expect(syncs).toBe(1)
    await controller.onAppStateChange('active')
    expect(syncs).toBe(1)
  })

  it('coalesces foreground and reconnect events while a replay is in flight', async () => {
    let releaseSync: (() => void) | undefined
    let pending = true
    let syncs = 0
    const controller = createMobileLifecycleController({
      isOnline: () => true,
      hasPending: () => pending,
      onConnectivityChange: () => undefined,
      syncPending: async () => {
        syncs += 1
        await new Promise<void>((resolve) => { releaseSync = resolve })
        pending = false
      },
    })

    const reconnect = controller.onConnectivityChange(true)
    await controller.onAppStateChange('active')
    expect(syncs).toBe(1)
    releaseSync?.()
    await reconnect
    expect(syncs).toBe(1)
  })
})
