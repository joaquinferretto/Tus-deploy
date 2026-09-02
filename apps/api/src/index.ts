import { startServer } from './server.ts'

export async function runApi(): Promise<void> {
  await startServer()
}

if (process.argv[1]?.endsWith('/index.ts') || process.argv[1]?.endsWith('\\index.ts') || process.argv[1]?.endsWith('/index.js') || process.argv[1]?.endsWith('\\index.js')) {
  runApi().catch(() => {
    console.error('API startup failed; diagnostics redacted')
    process.exitCode = 1
  })
}
