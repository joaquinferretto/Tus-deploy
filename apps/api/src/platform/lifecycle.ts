export type ApiLifecycleState = 'created' | 'running' | 'stopping' | 'stopped'

export interface ApiLifecycle {
  start: () => void
  register: (name: string, close: () => void | Promise<void>) => void
  state: () => ApiLifecycleState
  shutdown: (reason?: string) => Promise<void>
}

export function createApiLifecycle(shutdownTimeoutMs: number): ApiLifecycle {
  let state: ApiLifecycleState = 'created'
  const resources: Array<{ name: string; close: () => void | Promise<void> }> = []

  return {
    start() {
      if (state !== 'created') throw new Error(`Cannot start lifecycle from ${state}`)
      state = 'running'
    },
    register(name, close) {
      resources.push({ name, close })
    },
    state: () => state,
    async shutdown() {
      if (state === 'stopped' || state === 'stopping') return
      state = 'stopping'
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('shutdown timeout')), shutdownTimeoutMs)
      })
      try {
        await Promise.race([closeAll(resources), deadline])
      } finally {
        if (timer) clearTimeout(timer)
        state = 'stopped'
      }
    },
  }
}

async function closeAll(resources: Array<{ name: string; close: () => void | Promise<void> }>): Promise<void> {
  let firstError: unknown
  for (const resource of [...resources].reverse()) {
    try {
      await resource.close()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError) throw firstError
}
