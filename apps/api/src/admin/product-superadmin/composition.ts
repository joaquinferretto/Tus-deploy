import { ReceptorAuditoriaEnMemoria } from '../../audit/adapters/in-memory.js'
import { ProductSuperadminService } from './application/product-superadmin-service.js'
import {
  DeterministicProductAdminIdGenerator,
  InMemoryProductSuperadminStore,
  SystemProductAdminClock,
} from './adapters/in-memory.js'
import type { ProductAdminClock, ProductSuperadminStore } from './ports.js'

export interface InMemoryProductSuperadminServiceOptions {
  now?: () => number
}

export interface ProductSuperadminServiceFactoryOptions {
  store: ProductSuperadminStore
  clock?: ProductAdminClock
}

export function createProductSuperadminService(options: ProductSuperadminServiceFactoryOptions) {
  const audit = new ReceptorAuditoriaEnMemoria()
  const service = new ProductSuperadminService({
    store: options.store,
    audit,
    ids: new DeterministicProductAdminIdGenerator(),
    clock: options.clock ?? new SystemProductAdminClock(),
  })
  return {
    service,
    store: options.store,
    audit,
    seedSuperadmin: service.seedSuperadmin.bind(service),
    authorize: service.authorize.bind(service),
    requestBreakGlass: service.requestBreakGlass.bind(service),
    publishPolicy: service.publishPolicy.bind(service),
    rollbackPolicy: service.rollbackPolicy.bind(service),
    startSupportSession: service.startSupportSession.bind(service),
    authorizeSupportSession: service.authorizeSupportSession.bind(service),
    emergencyRevoke: service.emergencyRevoke.bind(service),
    disableProduct: service.disableProduct.bind(service),
    revokeSuperadmin: service.revokeSuperadmin.bind(service),
  }
}

export function createInMemoryProductSuperadminService(
  options: InMemoryProductSuperadminServiceOptions = {}
) {
  return createProductSuperadminService({
    store: new InMemoryProductSuperadminStore(),
    clock: options.now ? { now: options.now } : undefined,
  })
}

export { ProductSuperadminService } from './application/product-superadmin-service.js'
export { InMemoryProductSuperadminStore } from './adapters/in-memory.js'
export type * from './domain.js'
export type * from './ports.js'
