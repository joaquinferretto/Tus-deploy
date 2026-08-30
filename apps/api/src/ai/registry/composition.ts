import { InMemoryAIRegistry, type InMemoryAIRegistryOptions } from './index.js'

export function createInMemoryAIRegistry(
  options: InMemoryAIRegistryOptions = {}
): InMemoryAIRegistry {
  return new InMemoryAIRegistry(options)
}

export default { createInMemoryAIRegistry }
