import type {
  TusCustomerCommitmentsResponse,
  TusDiscoveryResponse,
  TusMerchantOperationsResponse,
  TusOperationsReportResponse,
  TusWebClient,
} from './tus-client'
import { sessionRequestContext, type TusResourceState, type TusWebSession } from './tus-ui-contract'

export const TUS_RESOURCE = {
  DISCOVERY: 'discovery',
  COMMITMENTS: 'commitments',
  MERCHANT: 'merchant',
  REPORT: 'report',
} as const

export type TusResourceKey = (typeof TUS_RESOURCE)[keyof typeof TUS_RESOURCE]

export const TUS_RESOURCE_PERMISSION = {
  discovery: 'tus:marketplace:read',
  commitments: 'tus:marketplace:read',
  merchant: 'tus:marketplace:read',
  report: 'tus:reporting:read',
} as const satisfies Record<TusResourceKey, string>

export interface TusResourceData {
  discovery: TusDiscoveryResponse
  commitments: TusCustomerCommitmentsResponse
  merchant: TusMerchantOperationsResponse
  report: TusOperationsReportResponse
}

export type TusResourceStates = {
  [Key in TusResourceKey]: TusResourceState<TusResourceData[Key]>
}

export interface TusResourceLoaderOptions {
  client: Pick<
    TusWebClient,
    | 'discoverMarketplace'
    | 'marketplaceCustomerCommitments'
    | 'merchantMarketplaceOperations'
    | 'operationsReport'
  >
  session: TusWebSession
  onUnauthorized?: () => void
  onStateChange?: (states: TusResourceStates) => void
}

export interface TusResourceLoader {
  load(): Promise<TusResourceStates>
  retry(key: TusResourceKey): Promise<void>
  snapshot(): TusResourceStates
  cancel(): void
}

const RESOURCE_LABEL = {
  discovery: 'Customer discovery',
  commitments: 'Customer commitments',
  merchant: 'Merchant operations',
  report: 'Operations reporting',
} as const satisfies Record<TusResourceKey, string>

export function canLoadTusResource(
  key: TusResourceKey,
  permissions: readonly string[] = []
): boolean {
  const granted = new Set(permissions)
  return granted.has(TUS_RESOURCE_PERMISSION[key]) || granted.has('tus:*')
}

export function createTusResourceLoader(options: TusResourceLoaderOptions): TusResourceLoader {
  const states: Record<TusResourceKey, TusResourceState<unknown>> = {
    discovery: createInitialState('discovery'),
    commitments: createInitialState('commitments'),
    merchant: createInitialState('merchant'),
    report: createInitialState('report'),
  }
  const generations: Record<TusResourceKey, number> = {
    discovery: 0,
    commitments: 0,
    merchant: 0,
    report: 0,
  }
  let cancelled = false
  let unauthorized = false

  function snapshot(): TusResourceStates {
    return {
      discovery: snapshotState('discovery'),
      commitments: snapshotState('commitments'),
      merchant: snapshotState('merchant'),
      report: snapshotState('report'),
    }
  }

  function snapshotState(key: TusResourceKey): TusResourceState<never> {
    const state = states[key]
    return {
      ...state,
      retry: () => {
        void retry(key)
      },
    } as TusResourceState<never>
  }

  function publish(): void {
    options.onStateChange?.(snapshot())
  }

  function setState(key: TusResourceKey, state: TusResourceState<unknown>): void {
    states[key] = state
    publish()
  }

  async function loadResource(key: TusResourceKey): Promise<void> {
    const generation = generations[key] + 1
    generations[key] = generation
    if (cancelled || unauthorized) return

    if (!canLoadTusResource(key, options.session.permissions)) {
      setState(
        key,
        createState(
          key,
          'disabled',
          `${RESOURCE_LABEL[key]} is unavailable for this authorized scope.`
        )
      )
      return
    }

    setState(
      key,
      createState(key, 'loading', `Loading authoritative ${RESOURCE_LABEL[key].toLowerCase()}…`)
    )
    try {
      const data = await requestResource(key)
      if (cancelled || unauthorized || generations[key] !== generation) return
      setState(
        key,
        createState(key, isEmpty(key, data) ? 'empty' : 'ready', emptyMessage(key, data), data)
      )
    } catch (error: unknown) {
      if (cancelled || unauthorized || generations[key] !== generation) return
      if (statusOf(error) === 401) {
        withholdProtectedResources()
        options.onUnauthorized?.()
        return
      }
      setState(key, createErrorState(key, error))
    }
  }

  async function requestResource(key: TusResourceKey): Promise<unknown> {
    const context = sessionRequestContext(options.session)
    if (key === TUS_RESOURCE.DISCOVERY) return options.client.discoverMarketplace(context)
    if (key === TUS_RESOURCE.COMMITMENTS)
      return options.client.marketplaceCustomerCommitments(context)
    if (key === TUS_RESOURCE.MERCHANT) return options.client.merchantMarketplaceOperations(context)
    return options.client.operationsReport(context)
  }

  async function load(): Promise<TusResourceStates> {
    await Promise.all(
      (Object.keys(TUS_RESOURCE) as Array<keyof typeof TUS_RESOURCE>).map((name) =>
        loadResource(TUS_RESOURCE[name])
      )
    )
    return snapshot()
  }

  async function retry(key: TusResourceKey): Promise<void> {
    await loadResource(key)
  }

  function withholdProtectedResources(): void {
    unauthorized = true
    for (const key of Object.values(TUS_RESOURCE)) {
      generations[key] += 1
      states[key] = createState(
        key,
        'disabled',
        'Your TUS session is no longer valid. Sign in again to view protected data.'
      )
    }
    publish()
  }

  function cancel(): void {
    cancelled = true
    for (const key of Object.values(TUS_RESOURCE)) generations[key] += 1
  }

  return { load, retry, snapshot, cancel }
}

function createInitialState(key: TusResourceKey): TusResourceState<unknown> {
  return createState(key, 'loading', `Loading authoritative ${RESOURCE_LABEL[key].toLowerCase()}…`)
}

function createState<TData>(
  key: TusResourceKey,
  status: TusResourceState<TData>['status'],
  message: string,
  data?: TData
): TusResourceState<TData> {
  return {
    status,
    resource: RESOURCE_LABEL[key],
    message,
    ...(data === undefined ? {} : { data }),
    retry: () => undefined,
  }
}

function createErrorState(key: TusResourceKey, error: unknown): TusResourceState<never> {
  const code = codeOf(error)
  return {
    ...createState(
      key,
      'error',
      `${RESOURCE_LABEL[key]} could not be loaded from TUS. Retry this resource for a fresh server response.`
    ),
    ...(code === undefined ? {} : { code }),
  }
}

function emptyMessage(key: TusResourceKey, data: unknown): string {
  if (!isEmpty(key, data)) return `${RESOURCE_LABEL[key]} is current according to TUS.`
  return `No ${RESOURCE_LABEL[key].toLowerCase()} records are available for this authorized scope yet.`
}

function isEmpty(key: TusResourceKey, data: unknown): boolean {
  if (key === TUS_RESOURCE.DISCOVERY)
    return (
      asRecord(data)['items'] instanceof Array &&
      (asRecord(data)['items'] as unknown[]).length === 0
    )
  if (key === TUS_RESOURCE.COMMITMENTS)
    return (
      asRecord(data)['commitments'] instanceof Array &&
      (asRecord(data)['commitments'] as unknown[]).length === 0
    )
  if (key === TUS_RESOURCE.MERCHANT) {
    const record = asRecord(data)
    const listings = record['listings'] ?? record['items']
    return listings instanceof Array && listings.length === 0
  }
  return false
}

function statusOf(error: unknown): number | undefined {
  const record = asRecord(error)
  return typeof record['status'] === 'number' ? record['status'] : undefined
}

function codeOf(error: unknown): string | undefined {
  const code = asRecord(error)['code']
  return typeof code === 'string' && code.trim().length > 0 ? code : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

const tusResourceLoaderModule = { canLoadTusResource, createTusResourceLoader }

export default tusResourceLoaderModule
