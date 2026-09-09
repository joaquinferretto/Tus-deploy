const DEFAULT_API_PORT = 3101

export function resolveListenPort(
  environment: Record<string, string | undefined> = process.env,
  runtimeEnvironment = environment['NODE_ENV'] ?? 'development',
): number {
  const candidate = runtimeEnvironment === 'production'
    ? environment['PORT']
    : environment['API_PORT'] ?? environment['PORT']
  const port = Number(candidate ?? DEFAULT_API_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid API port configuration')
  }
  return port
}

export function resolveListenHost(
  environment: Record<string, string | undefined> = process.env,
): string {
  if (environment['HOST']?.trim()) return environment['HOST'].trim()
  if (environment['NODE_ENV'] === 'production' || environment['RENDER'] === 'true') return '0.0.0.0'
  return '127.0.0.1'
}
