export type MobileAppState = 'active' | 'background' | 'inactive' | 'unknown'

export interface MobileLifecycleControllerOptions {
  isOnline: () => boolean
  hasPending: () => boolean
  onConnectivityChange: (isOnline: boolean) => void
  syncPending: () => Promise<void>
}

export interface MobileLifecycleController {
  onConnectivityChange(isOnline: boolean): Promise<void>
  onAppStateChange(state: MobileAppState): Promise<void>
}

export function createMobileLifecycleController(options: MobileLifecycleControllerOptions): MobileLifecycleController {
  let syncInFlight: Promise<void> | null = null

  function startSync(): Promise<void> | null {
    if (!options.isOnline() || !options.hasPending() || syncInFlight !== null) return syncInFlight
    syncInFlight = options.syncPending().finally(() => {
      syncInFlight = null
    })
    return syncInFlight
  }

  return {
    async onConnectivityChange(isOnline) {
      options.onConnectivityChange(isOnline)
      const sync = startSync()
      if (sync !== null) await sync
    },
    async onAppStateChange(state) {
      if (state === 'active') startSync()
    },
  }
}

export default { createMobileLifecycleController }
