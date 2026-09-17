import { createServiceDefinition, formatResult, launchDetached } from './detached-common.mjs'

const service = process.argv[2]

try {
  const result = await launchDetached(createServiceDefinition(service))
  console.log(formatResult(result))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Detached launch failed')
  process.exitCode = 1
}
