import { createPosOperationId, createStableIdempotencyKey, createTusMobileClient, createTusMobileFetchTransport, parseManualPosAmount, parsePosCommandResponse, posFeedback, type ManualPosOperation, type MobileQueueEnvelope, type MobileQueueQuarantineRecord } from '../../src/application/tus-client'
import { POS_INTENT_STATUS, buildPersistKey, posIntentActionLabel, resolvePosIntentState } from '../../src/store/app-store'
import { resolveMobileRuntimeConfig } from '../../src/core/config/runtime-profile'
import { buildMMKVStorageIdentity } from '../../src/core/services/mmkv-storage'
import { buildSecureStorageKey } from '../../src/core/services/secure-credential-store'

const stagingRuntime = resolveMobileRuntimeConfig({ profile: 'staging' })

const operation: ManualPosOperation = {
  tenantId: 'tenant-a',
  actorId: 'staff-a',
  correlationId: 'corr-mobile',
  operationId: 'mobile-operation',
  idempotencyKey: 'mobile-key',
  kind: 'manual-sale',
  context: 'product',
  amount: 100,
  currency: 'ARS',
  deviceId: 'device-a',
  shiftId: 'shift-a',
  schemaVersion: '1.0.0',
  createdAt: '2026-08-26T12:00:00.000Z',
  expectedVersion: 0,
}

describe('TUS mobile POS queue', () => {
  it('validates a real ARS amount before an intent can be created', () => {
    expect(parseManualPosAmount('125.50')).toEqual({ amount: 125.5, error: null })
    expect(parseManualPosAmount('125,50')).toEqual({ amount: 125.5, error: null })
    expect(parseManualPosAmount('')).toEqual({ amount: null, error: 'Enter an amount greater than 0 ARS.' })
    expect(parseManualPosAmount('0')).toEqual({ amount: null, error: 'Enter an amount greater than 0 ARS.' })
    expect(parseManualPosAmount('-1')).toEqual({ amount: null, error: 'Enter an amount greater than 0 ARS.' })
    expect(parseManualPosAmount('Infinity')).toEqual({ amount: null, error: 'Enter a valid ARS amount.' })
    expect(parseManualPosAmount('NaN')).toEqual({ amount: null, error: 'Enter a valid ARS amount.' })
    expect(parseManualPosAmount('12abc')).toEqual({ amount: null, error: 'Enter a valid ARS amount.' })
  })

  it('keeps product and service context distinct in the operation contract', () => {
    const product = { ...operation, kind: 'manual-sale' as const, context: 'product' as const, amount: 100 }
    const service = { ...operation, kind: 'manual-service' as const, context: 'service' as const, amount: 100 }

    expect(product.kind).toBe('manual-sale')
    expect(product.context).toBe('product')
    expect(service.kind).toBe('manual-service')
    expect(service.context).toBe('service')
    expect(createStableIdempotencyKey('pos', 'product-intent')).not.toBe(createStableIdempotencyKey('pos', 'service-intent'))
    expect(createPosOperationId(100, 0.25)).toBe(createPosOperationId(100, 0.25))
    expect(createPosOperationId(100, 0.25)).not.toBe(createPosOperationId(100, 0.5))
  })

  it('keeps the persisted POS intent state aligned with server evidence', () => {
    expect(resolvePosIntentState({ status: 'conflict', operationId: 'operation-conflict' })).toEqual({
      status: POS_INTENT_STATUS.CONFLICT,
      operationId: 'operation-conflict',
      message: 'POS intent requires staff review.',
      action: 'resolve',
    })
    expect(resolvePosIntentState({ status: 'queued-offline', operationId: 'operation-offline' }).status).toBe(POS_INTENT_STATUS.PENDING)
    expect(resolvePosIntentState({ status: 'unknown-server-status', operationId: 'operation-invalid' }).status).toBe(POS_INTENT_STATUS.ERROR)
  })

  it('provides accessible labels for every safe POS recovery action', () => {
    expect(posIntentActionLabel('retry')).toBe('Retry same operation')
    expect(posIntentActionLabel('refresh')).toBe('Refresh server status')
    expect(posIntentActionLabel('resolve')).toBe('Review preserved conflict')
    expect(posIntentActionLabel('none')).toBe('')
  })

  it('uses one stable idempotency key for an intent across a transport retry', async () => {
    let attempts = 0
    const keys: string[] = []
    const client = createTusMobileClient({
      request: async ({ operation: next }) => {
        attempts += 1
        keys.push(next.idempotencyKey)
        if (attempts === 1) throw new Error('timeout')
        return { status: 'accepted', operationId: next.operationId }
      },
    })

    const intentOperation = { ...operation, idempotencyKey: createStableIdempotencyKey('pos', 'intent-1') }
    expect(await client.recordManualOperation(intentOperation)).toEqual({ status: 'pending', operationId: operation.operationId, reason: 'uncertain_sync' })
    expect(await client.syncPendingOperations()).toEqual([{ status: 'accepted', operationId: operation.operationId }])
    expect(keys).toEqual(['tus:pos:intent-1', 'tus:pos:intent-1'])
  })

  it('keeps an offline operation durable and reconciles an accepted replay', async () => {
    let online = false
    let records: MobileQueueEnvelope = { profile: stagingRuntime.profile, storageVersion: stagingRuntime.storageVersion, operations: [] }
    const client = createTusMobileClient(
      { request: async ({ operation: next }) => ({ status: 'accepted', operationId: next.operationId }) },
      { runtime: stagingRuntime, isOnline: () => online, storage: { load: () => records, save: (next) => { records = next } } },
    )

    expect(await client.recordManualOperation(operation)).toEqual({ status: 'queued-offline', operationId: operation.operationId })
    expect(records.operations).toHaveLength(1)
    online = true

    expect(await client.syncPendingOperations()).toEqual([{ status: 'accepted', operationId: operation.operationId }])
    expect(client.pendingOperations()).toHaveLength(0)
    expect(records.operations).toEqual([])
  })

  it('preserves a server conflict until staff explicitly discards it', async () => {
    const client = createTusMobileClient(
      { request: async ({ operation: next }) => ({ status: 'conflict', operationId: next.operationId, reason: 'server_version_changed' }) },
      { isOnline: () => true },
    )

    await client.recordManualOperation(operation)
    expect(client.pendingOperations()).toHaveLength(1)
    expect(await client.resolveConflict(operation.operationId, 'discard')).toEqual({ status: 'discarded', operationId: operation.operationId })
    expect(client.pendingOperations()).toHaveLength(0)
  })

  it('keeps a conflict preserved when retry is attempted offline', async () => {
    const client = createTusMobileClient(
      { request: async () => ({ status: 'conflict', operationId: operation.operationId, reason: 'server_version_changed' }) },
      { isOnline: () => false, runtime: stagingRuntime, storage: { load: () => null, save: () => undefined } },
    )

    await client.recordManualOperation(operation)
    expect(await client.resolveConflict(operation.operationId, 'retry')).toEqual({ status: 'conflict', operationId: operation.operationId, reason: 'offline' })
    expect(client.pendingOperations()).toEqual([operation])
  })

  it('keeps replay pending while the device remains offline', async () => {
    const client = createTusMobileClient(
      { request: async ({ operation: next }) => ({ status: 'accepted', operationId: next.operationId }) },
      { isOnline: () => false },
    )

    await client.recordManualOperation(operation)

    expect(await client.syncPendingOperations()).toEqual([{ status: 'pending', operationId: operation.operationId, reason: 'offline' }])
    expect(client.pendingOperations()).toHaveLength(1)
  })

  it('reconnects with the exact queued payload and stable identity', async () => {
    let online = false
    const requests: ManualPosOperation[] = []
    const client = createTusMobileClient(
      { request: async ({ operation: next }) => { requests.push({ ...next }); return { status: 'accepted', operationId: next.operationId } } },
      { isOnline: () => online, runtime: stagingRuntime, storage: { load: () => null, save: () => undefined } },
    )
    const queued = { ...operation, idempotencyKey: createStableIdempotencyKey('pos', 'reconnect-intent') }

    await client.recordManualOperation(queued)
    queued.amount = 999
    queued.idempotencyKey = 'mutated-key'
    online = true

    expect(await client.syncPendingOperations()).toEqual([{ status: 'accepted', operationId: operation.operationId }])
    expect(requests).toEqual([{ ...operation, idempotencyKey: createStableIdempotencyKey('pos', 'reconnect-intent') }])
  })

  it('renders an explicit error without upgrading it to accepted', () => {
    expect(posFeedback({ status: 'error', operationId: 'error-operation', reason: 'server_unavailable' })).toEqual({
      status: 'error',
      operationId: 'error-operation',
      message: 'The server did not acknowledge this operation.',
      evidence: 'server_unavailable',
      action: 'retry',
      retryable: true,
    })
  })

  it('parses replay and in-flight acknowledgements without treating HTTP-shaped success as accepted', () => {
    expect(parsePosCommandResponse({ status: 'replayed', operationId: 'server-replay', receipt: { receiptId: 'receipt-replay' } }, 'local-operation')).toEqual({
      status: 'replayed',
      operationId: 'server-replay',
      receipt: { receiptId: 'receipt-replay' },
    })
    expect(parsePosCommandResponse({ status: 'in_progress', operationId: 'server-pending' }, 'local-operation')).toEqual({
      status: 'pending',
      operationId: 'server-pending',
      reason: 'in_progress',
    })
    expect(parsePosCommandResponse({ ok: true }, 'local-operation')).toEqual({
      status: 'error',
      operationId: 'local-operation',
      reason: 'invalid_server_response',
    })
  })

  it('turns offline, conflict, and replay states into explicit next actions', () => {
    expect(posFeedback({ status: 'queued-offline', operationId: 'offline-operation' })).toMatchObject({ status: 'pending', action: 'retry', retryable: true })
    expect(posFeedback({ status: 'conflict', operationId: 'conflict-operation', reason: 'idempotency_conflict' })).toMatchObject({ status: 'conflict', action: 'resolve', retryable: false })
    expect(posFeedback({ status: 'replayed', operationId: 'replay-operation' })).toMatchObject({ status: 'replayed', action: 'refresh', retryable: false })
  })

  it('reports storage rejection as an error instead of claiming server acceptance', async () => {
    const client = createTusMobileClient(
      { request: async ({ operation: next }) => ({ status: 'accepted', operationId: next.operationId }) },
      { runtime: stagingRuntime, storage: { load: () => null, save: () => { throw new Error('encrypted storage unavailable') } } },
    )

    await expect(client.recordManualOperation(operation)).resolves.toEqual({
      status: 'error',
      operationId: operation.operationId,
      reason: 'storage_unavailable',
    })
  })

  it('does not lose a conflict when clearing quarantine storage fails', () => {
    const quarantined: MobileQueueQuarantineRecord[] = []
    const client = createTusMobileClient(
      { request: async () => ({ status: 'accepted', operationId: operation.operationId }) },
      {
        runtime: stagingRuntime,
        storage: {
          load: () => [operation],
          save: () => undefined,
          quarantine: (entry) => quarantined.push(entry),
          clearQuarantine: () => { throw new Error('encrypted storage unavailable') },
        },
      },
    )

    expect(client.clearQuarantinedOperations()).toBe(false)
    expect(client.quarantinedOperations()).toHaveLength(1)
  })

  it('preserves the operation when a retry cannot update encrypted storage', async () => {
    let saves = 0
    const client = createTusMobileClient(
      { request: async ({ operation: next }) => ({ status: 'accepted', operationId: next.operationId }) },
      {
        runtime: stagingRuntime,
        storage: {
          load: () => ({ profile: 'staging', storageVersion: 1, operations: [operation] }),
          save: () => {
            saves += 1
            if (saves > 0) throw new Error('encrypted storage unavailable')
          },
        },
      },
    )

    await expect(client.syncPendingOperations()).resolves.toEqual([{ status: 'error', operationId: operation.operationId, reason: 'storage_unavailable' }])
    expect(client.pendingOperations()).toEqual([operation])
  })

  it('writes queued work in a profile-qualified versioned envelope', async () => {
    let persisted: unknown = null
    let online = false
    const client = createTusMobileClient(
      { request: async ({ operation: next }) => ({ status: 'accepted', operationId: next.operationId }) },
      {
        runtime: stagingRuntime,
        isOnline: () => online,
        storage: {
          load: () => persisted,
          save: (next) => { persisted = next },
        },
      },
    )

    expect(await client.recordManualOperation(operation)).toEqual({ status: 'queued-offline', operationId: operation.operationId })
    expect(persisted).toEqual({ profile: 'staging', storageVersion: 1, operations: [operation] })
    online = true
    await client.syncPendingOperations()
    expect(persisted).toEqual({ profile: 'staging', storageVersion: 1, operations: [] })
  })

  it('never persists an access token and resolves replay credentials securely', async () => {
    let online = false
    let persisted: MobileQueueEnvelope | null = null
    const client = createTusMobileClient(
      { request: async ({ operation: next }) => ({ status: 'accepted', operationId: next.operationId }) },
      {
        runtime: stagingRuntime,
        isOnline: () => online,
        storage: {
          load: () => null,
          save: (next) => { persisted = next },
        },
      },
    )

    await client.recordManualOperation({ ...operation, accessToken: 'must-persist' })

    expect(JSON.stringify(persisted)).not.toContain('must-persist')
    const saved = persisted as MobileQueueEnvelope | null
    expect(saved?.operations[0]).not.toHaveProperty('accessToken')
    const originalFetch = globalThis.fetch
    const authorizationHeaders: string[] = []
    globalThis.fetch = async (_input, init) => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '')
      return new Response(JSON.stringify({ status: 'accepted', operationId: operation.operationId }), { status: 200 })
    }

    try {
      const transport = createTusMobileFetchTransport(stagingRuntime, {
        getAccessToken: async () => 'fresh-token',
        getRefreshToken: async () => null,
        getTokenSnapshot: async () => ({ accessToken: 'fresh-token', refreshToken: null, expiresAt: null }),
        setTokens: async () => undefined,
        clear: async () => undefined,
      })

      await transport.request({
        method: 'POST',
        path: '/tus/v1/pos/manual-operations',
        operation: { ...operation, accessToken: 'stale-token' },
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(authorizationHeaders).toEqual(['Bearer fresh-token'])
  })

  it('quarantines legacy and cross-profile queue data without replaying it', async () => {
    const quarantined: MobileQueueQuarantineRecord[] = []
    let requests = 0
    const legacyOperation = { ...operation, accessToken: 'token-fixture' }
    const client = createTusMobileClient(
      { request: async () => { requests += 1; return { status: 'accepted', operationId: operation.operationId } } },
      {
        runtime: stagingRuntime,
        storage: {
          load: () => ({ profile: 'dev', storageVersion: 1, operations: [legacyOperation] }),
          save: () => undefined,
          quarantine: (entry) => quarantined.push(entry),
        },
      },
    )

    expect(client.pendingOperations()).toEqual([])
    expect(client.quarantinedOperations()).toEqual([
      expect.objectContaining({ profile: 'staging', reason: 'profile_mismatch' }),
    ])
    expect(quarantined).toEqual([
      expect.objectContaining({ profile: 'staging', reason: 'profile_mismatch' }),
    ])
    expect(JSON.stringify(quarantined[0]?.data)).not.toContain('token-fixture')
    expect(await client.syncPendingOperations()).toEqual([])
    expect(requests).toBe(0)
  })

  it('quarantines an unversioned legacy array and exposes an explicit clear boundary', () => {
    const quarantined: MobileQueueQuarantineRecord[] = []
    const client = createTusMobileClient(
      { request: async () => ({ status: 'accepted', operationId: operation.operationId }) },
      {
        runtime: stagingRuntime,
        storage: {
          load: () => [operation],
          save: () => undefined,
          quarantine: (entry) => quarantined.push(entry),
          clearQuarantine: () => quarantined.splice(0, quarantined.length),
        },
      },
    )

    expect(client.quarantinedOperations()[0]).toEqual(expect.objectContaining({ reason: 'legacy_format' }))
    client.clearQuarantinedOperations()
    expect(client.quarantinedOperations()).toEqual([])
    expect(quarantined).toEqual([])
  })

  it('does not replay a same-profile queue for a different tenant', () => {
    const quarantined: MobileQueueQuarantineRecord[] = []
    const client = createTusMobileClient(
      { request: async () => ({ status: 'accepted', operationId: operation.operationId }) },
      {
        runtime: stagingRuntime,
        tenantId: 'tenant-b',
        storage: {
          load: () => ({ profile: 'staging', storageVersion: 1, operations: [operation] }),
          save: () => undefined,
          quarantine: (entry) => quarantined.push(entry),
        },
      },
    )

    expect(client.pendingOperations()).toEqual([])
    expect(quarantined[0]).toEqual(expect.objectContaining({ reason: 'tenant_mismatch' }))
  })

  it('builds app state keys from the canonical runtime profile', () => {
    expect(buildPersistKey(stagingRuntime)).toBe('alqui:staging:zustand:app')
  })

  it('qualifies secure credentials, encryption keys, and caches by the same runtime profile', () => {
    const devRuntime = resolveMobileRuntimeConfig({ profile: 'dev' })
    expect(buildSecureStorageKey(stagingRuntime, 'auth.accessToken')).toBe('alqui.staging.auth.accessToken')
    expect(buildSecureStorageKey(devRuntime, 'auth.accessToken')).toBe('alqui.dev.auth.accessToken')
    expect(buildMMKVStorageIdentity(stagingRuntime, 'tus-pos')).toEqual({ id: 'alqui-staging-tus-pos', keyPrefix: 'alqui:staging' })
    expect(buildMMKVStorageIdentity(devRuntime, 'cache')).toEqual({ id: 'alqui-dev-cache', keyPrefix: 'alqui:dev' })
  })

  it('uses the server response body instead of inferring acceptance from HTTP success', () => {
    expect(parsePosCommandResponse({ status: 'pending', operationId: 'server-pending', reason: 'uncertain_sync' }, 'local-operation')).toEqual({
      status: 'pending',
      operationId: 'server-pending',
      reason: 'uncertain_sync',
    })
    expect(parsePosCommandResponse({ ok: true }, 'local-operation')).toEqual({
      status: 'error',
      operationId: 'local-operation',
      reason: 'invalid_server_response',
    })
  })
})
