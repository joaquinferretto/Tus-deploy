export * from './domain.js'
export * from './ports.js'
export * from './adapters/in-memory.js'
export * from './adapters/activation-gated.js'
export * from './application/durable-job-service.js'

import {
  createInMemoryDurableJobPlatform,
  InMemoryDurableJobPlatform,
  InMemoryEventStore,
  InMemoryJobStore,
  InMemoryJobTransport,
  InMemoryRunLedgerStore,
  InMemorySagaStore,
} from './adapters/in-memory.js'
import {
  ActivationGatedJobTransport,
  JobProviderUnavailableError,
} from './adapters/activation-gated.js'
import { DurableJobService } from './application/durable-job-service.js'
import {
  EVENT_CONTRACT_VERSION,
  JOB_CONTRACT_VERSION,
  toDurableJobContract,
  toRunEventContract,
} from './domain.js'

export default {
  createInMemoryDurableJobPlatform,
  InMemoryDurableJobPlatform,
  InMemoryEventStore,
  InMemoryJobStore,
  InMemoryJobTransport,
  InMemoryRunLedgerStore,
  InMemorySagaStore,
  ActivationGatedJobTransport,
  JobProviderUnavailableError,
  DurableJobService,
  EVENT_CONTRACT_VERSION,
  JOB_CONTRACT_VERSION,
  toDurableJobContract,
  toRunEventContract,
}
