import { safeStartupReason } from './infrastructure/database/postgres/pool.ts'
import { startServer } from './server.ts'

export async function runApi(): Promise<void> {
  await startServer()
}

runApi().catch((error: unknown) => {
  // Solo un código seguro (ver safeStartupReason): nunca URL, host, usuario ni mensaje.
  console.error(`API startup failed; diagnostics redacted; reason=${safeStartupReason(error)}`)
  process.exitCode = 1
})
