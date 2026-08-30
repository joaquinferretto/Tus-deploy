export * from './ports/index.js'
export * from './b2/index.js'
export * from './s3-staging/index.js'
export * from './fakes/index.js'

import { StorageActivationError } from './ports/index.js'
import { B2DurableSource } from './b2/index.js'
import { S3StagingStorage } from './s3-staging/index.js'
import { InMemoryB2Source, InMemoryS3Staging } from './fakes/index.js'

export default {
  StorageActivationError,
  B2DurableSource,
  S3StagingStorage,
  InMemoryB2Source,
  InMemoryS3Staging,
}
