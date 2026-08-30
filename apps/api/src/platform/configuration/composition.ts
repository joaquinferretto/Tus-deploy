import { ConfigurationService } from './application/configuration-service.js'
import { InMemoryConfigurationStore } from './adapters/in-memory.js'
import type { ConfigurationStore } from './ports.js'

export interface ConfigurationServiceFactoryOptions {
  store: ConfigurationStore
}

export function createConfigurationService(options: ConfigurationServiceFactoryOptions) {
  const service = new ConfigurationService(options.store)
  return {
    service,
    store: options.store,
    publish: service.publish.bind(service),
    resolve: service.resolve.bind(service),
    isEnabled: service.isEnabled.bind(service),
    rollback: service.rollback.bind(service),
  }
}

export function createInMemoryConfigurationService() {
  return createConfigurationService({ store: new InMemoryConfigurationStore() })
}

export { ConfigurationService } from './application/configuration-service.js'
export { InMemoryConfigurationStore } from './adapters/in-memory.js'
export type * from './domain.js'
export type * from './ports.js'
