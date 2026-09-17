import { checkDetached, createServiceDefinition, formatResult } from './detached-common.mjs'

const service = process.argv[2]

try {
  const result = await checkDetached(service, { definition: createServiceDefinition(service, { includeEnvironment: false }) })
  console.log(formatResult(result))
  if (result.status === 'UNHEALTHY') process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Detached check failed')
  process.exitCode = 1
}
