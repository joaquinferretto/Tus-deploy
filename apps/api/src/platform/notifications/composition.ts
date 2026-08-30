import { NotificationService } from './application/notification-service.js'
import {
  DeterministicNotificationClock,
  DeterministicNotificationEmailProvider,
  DeterministicNotificationIdGenerator,
  InMemoryNotificationPreferences,
  InMemoryNotificationQuota,
  InMemoryNotificationStore,
} from './adapters/in-memory.js'
import type { NotificationRetryOptions } from './ports.js'

export interface InMemoryNotificationServiceOptions extends NotificationRetryOptions {
  now?: () => number
}

export function createInMemoryNotificationService(
  options: InMemoryNotificationServiceOptions = {}
) {
  const provider = new DeterministicNotificationEmailProvider()
  const preferences = new InMemoryNotificationPreferences()
  const quota = new InMemoryNotificationQuota()
  const service = new NotificationService(
    {
      provider,
      preferences,
      quota,
      store: new InMemoryNotificationStore(),
      clock: options.now ? { now: options.now } : new DeterministicNotificationClock(Date.now()),
      ids: new DeterministicNotificationIdGenerator(),
    },
    options
  )
  return {
    service,
    provider,
    preferences,
    quota,
    send: service.send.bind(service),
    retry: service.retry.bind(service),
  }
}

export { NotificationService } from './application/notification-service.js'
export * from './domain.js'
export type * from './ports.js'
export {
  DeterministicNotificationClock,
  DeterministicNotificationEmailProvider,
  DeterministicNotificationIdGenerator,
  InMemoryNotificationPreferences,
  InMemoryNotificationQuota,
  InMemoryNotificationStore,
} from './adapters/in-memory.js'

export default { createInMemoryNotificationService }
