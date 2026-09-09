import { TenancyService } from './application/tenancy-service.js'
import {
  DeterministicTenancyIdGenerator,
  DeterministicTenancyTokenIssuer,
  InMemoryTenancyAuditSink,
  InMemoryTenancyStore,
} from './adapters/in-memory.js'
import { SystemTenancyClock } from './adapters/system.js'
import type { TenancyClock, TenancyStore } from './ports.js'
import { PrismaTenancyAuditSink, PrismaTenancyStore, type TenantPrismaClient } from './adapters/prisma.js'

export interface InMemoryTenancyServiceOptions {
  now?: () => number
}

export interface TenancyServiceFactoryOptions {
  store: TenancyStore
  clock?: TenancyClock
}

export function createTenancyService(options: TenancyServiceFactoryOptions) {
  const audit = new InMemoryTenancyAuditSink()
  const service = new TenancyService({
    store: options.store,
    audit,
    ids: new DeterministicTenancyIdGenerator(),
    tokens: new DeterministicTenancyTokenIssuer(),
    clock: options.clock ?? new SystemTenancyClock(),
  })
  return {
    service,
    store: options.store,
    audit,
    createOrganization: service.createOrganization.bind(service),
    createWorkspace: service.createWorkspace.bind(service),
    createRole: service.createRole.bind(service),
    addMembership: service.addMembership.bind(service),
    revokeMembership: service.revokeMembership.bind(service),
    inviteMember: service.inviteMember.bind(service),
    acceptInvitation: service.acceptInvitation.bind(service),
    authorize: service.authorize.bind(service),
    readResource: service.readResource.bind(service),
    writeResource: service.writeResource.bind(service),
    listResources: service.listResources.bind(service),
  }
}

export function createInMemoryTenancyService(options: InMemoryTenancyServiceOptions = {}) {
  return createTenancyService({
    store: new InMemoryTenancyStore(),
    clock: options.now ? { now: options.now } : undefined,
  })
}

export function createPrismaTenancyService(client: TenantPrismaClient) {
  const store = new PrismaTenancyStore(client)
  const audit = client.auditEvent ? new PrismaTenancyAuditSink(client) : new InMemoryTenancyAuditSink()
  const service = new TenancyService({
    store,
    audit,
    ids: new DeterministicTenancyIdGenerator(),
    tokens: new DeterministicTenancyTokenIssuer(),
    clock: new SystemTenancyClock(),
  })
  return {
    service,
    store,
    audit,
    createOrganization: service.createOrganization.bind(service),
    createWorkspace: service.createWorkspace.bind(service),
    createRole: service.createRole.bind(service),
    addMembership: service.addMembership.bind(service),
    revokeMembership: service.revokeMembership.bind(service),
    inviteMember: service.inviteMember.bind(service),
    acceptInvitation: service.acceptInvitation.bind(service),
    authorize: service.authorize.bind(service),
    readResource: service.readResource.bind(service),
    writeResource: service.writeResource.bind(service),
    listResources: service.listResources.bind(service),
  }
}

export { TenancyService } from './application/tenancy-service.js'
export { InMemoryTenancyStore, InMemoryTenancyAuditSink } from './adapters/in-memory.js'
export type * from './domain.js'
export type * from './ports.js'
export { PrismaTenancyStore } from './adapters/prisma.js'
export { PrismaTenancyAuditSink } from './adapters/prisma.js'
