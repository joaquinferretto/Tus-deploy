export type LifecycleState = 'created' | 'running' | 'stopping' | 'stopped'

export interface HealthResult {
  status: 'ok' | 'degraded'
  service: string
  version: string
  correlationId?: string
  timestamp: string
}

export interface ReadinessCheck {
  name: string
  check: () => boolean | Promise<boolean>
}

export interface ReadinessResult {
  ready: boolean
  checks: Record<string, boolean>
  timestamp: string
}

export interface LifecycleOptions {
  shutdownTimeoutMs: number
  onEvent?: (event: string) => void
}

export function createHealthResult(service: string, version: string, correlationId?: string): HealthResult {
  return { status: 'ok', service, version, ...(correlationId ? { correlationId } : {}), timestamp: new Date().toISOString() }
}

export async function evaluateReadiness(checks: ReadinessCheck[]): Promise<ReadinessResult> {
  const results = await Promise.all(checks.map(async ({ name, check }) => [name, await check()] as const))
  const values = Object.fromEntries(results)
  return { ready: results.every(([, value]) => value), checks: values, timestamp: new Date().toISOString() }
}

export function createLifecycle(options: LifecycleOptions) {
  let current: LifecycleState = 'created'
  const resources: Array<{ name: string; close: () => void | Promise<void> }> = []

  return {
    start() {
      if (current !== 'created') throw new Error(`Cannot start lifecycle from ${current}`)
      current = 'running'
      options.onEvent?.('started')
    },
    register(name: string, close: () => void | Promise<void>) {
      resources.push({ name, close })
    },
    state: () => current,
    async shutdown(reason = 'signal') {
      if (current === 'stopped' || current === 'stopping') return
      current = 'stopping'
      options.onEvent?.(`stopping:${reason}`)
      const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), options.shutdownTimeoutMs))
      try {
        await Promise.race([closeResources(resources, options.onEvent), deadline])
        current = 'stopped'
        options.onEvent?.('stopped')
      } catch (error) {
        current = 'stopped'
        options.onEvent?.('shutdown-failed')
        throw error
      }
    },
  }
}

async function closeResources(resources: Array<{ name: string; close: () => void | Promise<void> }>, onEvent?: (event: string) => void) {
  for (const resource of [...resources].reverse()) {
    await resource.close()
    onEvent?.(`closed:${resource.name}`)
  }
}
