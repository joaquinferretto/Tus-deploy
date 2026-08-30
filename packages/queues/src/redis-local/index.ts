import { InMemoryQueueTransport } from '../fakes/index.js'

/** Redis-local semantics without a Redis SDK or a live claim. */
export class RedisLocalQueueTransport extends InMemoryQueueTransport {}

export const RedisLocalTransport = RedisLocalQueueTransport

export default { RedisLocalQueueTransport, RedisLocalTransport }
