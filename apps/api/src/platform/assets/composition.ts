import { AssetService } from './application/asset-service.js'
import {
  InMemoryAssetAuthorization,
  InMemoryAssetLineageStore,
  InMemoryAssetStore,
  InMemoryB2Source,
  SystemAssetClock,
  DeterministicAssetIdGenerator,
} from './adapters/in-memory.js'
import type {
  AssetAuthorizationPort,
  AssetClock,
  AssetIdGenerator,
  AssetLineageStore,
  AssetServiceDependencies,
  AssetStore,
  DurableAssetSourcePort,
} from './ports.js'

export interface InMemoryAssetServiceOptions {
  now?: () => number
  source?: DurableAssetSourcePort
  store?: AssetStore
  lineage?: AssetLineageStore
  authorization?: AssetAuthorizationPort
  ids?: AssetIdGenerator
  clock?: AssetClock
}

export function createAssetService(options: InMemoryAssetServiceOptions): AssetService {
  return new AssetService({
    source: options.source ?? new InMemoryB2Source(),
    store: options.store ?? new InMemoryAssetStore(),
    lineage: options.lineage ?? new InMemoryAssetLineageStore(),
    authorization: options.authorization ?? new InMemoryAssetAuthorization(),
    ids: options.ids ?? new DeterministicAssetIdGenerator(),
    clock: options.clock ?? (options.now ? { now: options.now } : new SystemAssetClock()),
  } satisfies AssetServiceDependencies)
}

export function createInMemoryAssetService(options: InMemoryAssetServiceOptions = {}) {
  const service = createAssetService(options)
  return {
    service,
    source: service.source,
    lineage: service.lineage,
    create: service.create.bind(service),
    get: service.get.bind(service),
    recordLineage: service.recordLineage.bind(service),
    delete: service.delete.bind(service),
    cleanup: service.cleanup.bind(service),
  }
}

export { AssetService } from './application/asset-service.js'
export {
  InMemoryAssetAuthorization,
  InMemoryAssetLineageStore,
  InMemoryAssetStore,
  InMemoryB2Source,
  SystemAssetClock,
  DeterministicAssetIdGenerator,
} from './adapters/in-memory.js'
export * from './domain.js'
export type * from './ports.js'

export default { createAssetService, createInMemoryAssetService }
