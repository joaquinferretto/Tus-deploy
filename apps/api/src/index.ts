import { startServer } from './server.ts'

export async function runApi(): Promise<void> {
  await startServer()
}

runApi().catch(() => {
  console.error('API startup failed; diagnostics redacted')
  process.exitCode = 1
})
