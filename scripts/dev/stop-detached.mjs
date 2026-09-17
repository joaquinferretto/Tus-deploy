import { formatResult, stopDetached } from './detached-common.mjs'

const service = process.argv[2]

try {
  const result = await stopDetached(service)
  console.log(formatResult(result))
  if (result.status === 'STOP_FAILED' || result.status === 'STOPPED_PORT_OCCUPIED') process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Detached stop failed')
  process.exitCode = 1
}
