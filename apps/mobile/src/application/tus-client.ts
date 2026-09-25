import type { TusTenantContext } from '@factory/contracts/tus';
import { parseMobileRuntimeConfig, type MobileRuntimeConfig } from '../core/config/runtime-profile.ts';
import type { CredentialStore } from '../core/services/secure-credential-store';

export const MOBILE_POS_POLICY = {
  offline: 'queue-manual-operations',
  conflict: 'preserve-local-and-report',
} as const;

export const MOBILE_UI_STATUS = {
  SUBMITTING: 'submitting',
  ACCEPTED: 'accepted',
  REPLAYED: 'replayed',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  ERROR: 'error',
} as const;

export const MOBILE_INTENT_ACTION = {
  RETRY: 'retry',
  REFRESH: 'refresh',
  RESOLVE: 'resolve',
} as const;

export type MobileIntentAction = (typeof MOBILE_INTENT_ACTION)[keyof typeof MOBILE_INTENT_ACTION];

export type ManualOperationKind = 'manual-sale' | 'manual-service';

export const MOBILE_QUEUE_QUARANTINE_REASON = {
  LEGACY_FORMAT: 'legacy_format',
  INVALID_METADATA: 'invalid_metadata',
  PROFILE_MISMATCH: 'profile_mismatch',
  TENANT_MISMATCH: 'tenant_mismatch',
  INVALID_OPERATION: 'invalid_operation',
  DEVICE_REVOKED: 'device_revoked',
} as const;

export type MobileQueueQuarantineReason = (typeof MOBILE_QUEUE_QUARANTINE_REASON)[keyof typeof MOBILE_QUEUE_QUARANTINE_REASON];

export interface ManualPosOperation extends TusTenantContext {
  operationId: string;
  idempotencyKey: string;
  kind: ManualOperationKind;
  context: 'product' | 'service';
  amount: number;
  currency: string;
  deviceId: string;
  shiftId: string;
  schemaVersion: string;
  createdAt: string;
  expectedVersion?: number;
  accessToken?: string;
}

export interface MobileQueueEnvelope {
  profile: MobileRuntimeConfig['profile'];
  storageVersion: MobileRuntimeConfig['storageVersion'];
  operations: ManualPosOperation[];
}

export interface MobileQueueQuarantineRecord {
  profile: MobileRuntimeConfig['profile'];
  reason: MobileQueueQuarantineReason;
  data: unknown;
}

export interface MobileQueueRestoreResult {
  operations: ManualPosOperation[];
  quarantine: MobileQueueQuarantineRecord | null;
}

export type PosCommandResult =
  | { status: 'accepted'; operationId: string; receipt?: Record<string, unknown> }
  | { status: 'replayed'; operationId: string; receipt?: Record<string, unknown> }
  | { status: 'conflict'; operationId: string; reason: string }
  | { status: 'pending'; operationId: string; reason: 'uncertain_sync' | 'offline' | 'in_progress' | 'quarantined' | 'status_unavailable' }
  | { status: 'error'; operationId: string; reason: string };

export function createStableIdempotencyKey(scope: string, intentId: string): string {
  const normalizedScope = scope.trim();
  const normalizedIntent = intentId.trim();
  if (normalizedScope.length === 0 || normalizedIntent.length === 0) throw new Error('intent scope and id are required');
  return `tus:${normalizedScope}:${normalizedIntent}`;
}

export function createPosOperationId(now = Date.now(), entropy = Math.random()): string {
  const safeEntropy = Number.isFinite(entropy) ? Math.abs(entropy) : 0;
  return `mobile-pos-${now.toString(36)}-${Math.floor(safeEntropy * 0xFFFFFF).toString(36)}`;
}

export function parseManualPosAmount(value: string): { amount: number | null; error: string | null } {
  const normalized = value.trim().replace(',', '.');
  if (normalized.length === 0 || normalized === '0' || /^0+\.0+$/.test(normalized)) {
    return { amount: null, error: 'Enter an amount greater than 0 ARS.' };
  }
  if (normalized.startsWith('-')) return { amount: null, error: 'Enter an amount greater than 0 ARS.' };
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return { amount: null, error: 'Enter a valid ARS amount.' };
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return { amount: null, error: 'Enter a valid ARS amount.' };
  if (amount <= 0) return { amount: null, error: 'Enter an amount greater than 0 ARS.' };
  return { amount, error: null };
}

export function parsePosCommandResponse(payload: unknown, fallbackOperationId: string): PosCommandResult {
  const record = asRecord(payload);
  const operationId = typeof record['operationId'] === 'string' && record['operationId'].length > 0
    ? record['operationId']
    : fallbackOperationId;
  const status = record['status'];
  if (status === 'accepted' || status === 'replayed') {
    const receipt = asRecord(record['receipt']);
    return { status, operationId, ...(Object.keys(receipt).length === 0 ? {} : { receipt }) };
  }
  if (status === 'conflict' && typeof record['reason'] === 'string') return { status, operationId, reason: record['reason'] };
  if (status === 'pending' && (record['reason'] === 'uncertain_sync' || record['reason'] === 'offline' || record['reason'] === 'in_progress')) {
    return { status, operationId, reason: record['reason'] };
  }
  if (status === 'in_progress') return { status: 'pending', operationId, reason: 'in_progress' };
  if (status === 'error' && typeof record['reason'] === 'string') return { status, operationId, reason: record['reason'] };
  return { status: 'error', operationId, reason: 'invalid_server_response' };
}

export interface TusMobileRequest {
  method: 'POST';
  path: '/tus/v1/pos/manual-operations';
  operation: ManualPosOperation;
}

export interface TusMobileTransport {
  request(input: TusMobileRequest): Promise<PosCommandResult>;
  queryStatus?(operationId: string, operation?: ManualPosOperation): Promise<PosCommandResult>;
}

export type OfflinePosResult =
  | { status: 'queued-offline'; operationId: string }
  | PosCommandResult;

export interface MobilePosFeedback {
  status: Exclude<(typeof MOBILE_UI_STATUS)[keyof typeof MOBILE_UI_STATUS], 'submitting'>;
  operationId: string;
  message: string;
  evidence: string;
  retryable: boolean;
  action: MobileIntentAction;
}

export function posFeedback(result: { status: string; operationId: string; reason?: string }): MobilePosFeedback {
  if (result.status === 'accepted') {
    return {
      status: MOBILE_UI_STATUS.ACCEPTED,
      operationId: result.operationId,
      message: 'Accepted by TUS. The server acknowledgement is authoritative.',
      evidence: 'TUS provider capture and settlement are not claimed by mobile POS.',
      retryable: false,
      action: MOBILE_INTENT_ACTION.REFRESH,
    };
  }
  if (result.status === 'replayed') {
    return {
      status: MOBILE_UI_STATUS.REPLAYED,
      operationId: result.operationId,
      message: 'TUS replayed the original result for this intent.',
      evidence: 'The server returned the existing result; provider capture and settlement are not claimed.',
      retryable: false,
      action: MOBILE_INTENT_ACTION.REFRESH,
    };
  }
  if (result.status === 'conflict') {
    return {
      status: MOBILE_UI_STATUS.CONFLICT,
      operationId: result.operationId,
      message: 'Conflict preserved for explicit staff review.',
      evidence: result.reason ?? 'The server reported a conflict.',
      retryable: false,
      action: MOBILE_INTENT_ACTION.RESOLVE,
    };
  }
  if (result.status === 'error') {
    return {
      status: MOBILE_UI_STATUS.ERROR,
      operationId: result.operationId,
      message: 'The server did not acknowledge this operation.',
      evidence: result.reason ?? 'No server acknowledgement; no success is claimed.',
      retryable: true,
      action: MOBILE_INTENT_ACTION.RETRY,
    };
  }
  return {
    status: MOBILE_UI_STATUS.PENDING,
    operationId: result.operationId,
    message: result.status === 'queued-offline' ? 'Queued offline; waiting for server acknowledgement.' : 'Sync is uncertain; no success is claimed.',
    evidence: result.reason ?? 'Pending server acknowledgement.',
    retryable: true,
    action: result.reason === 'in_progress' ? MOBILE_INTENT_ACTION.REFRESH : MOBILE_INTENT_ACTION.RETRY,
  };
}

export type ConflictResolution = 'discard' | 'retry';

export interface TusMobileClient {
  recordManualOperation(operation: ManualPosOperation): Promise<OfflinePosResult>;
  pendingOperations(): readonly ManualPosOperation[];
  quarantinedOperations(): readonly MobileQueueQuarantineRecord[];
  clearQuarantinedOperations(): boolean;
  syncPendingOperations(): Promise<PosCommandResult[]>;
  resolveConflict(
    operationId: string,
    resolution: ConflictResolution,
  ): Promise<PosCommandResult | { status: 'discarded'; operationId: string } | { status: 'not-found'; operationId: string }>;
  queryOperationStatus(operationId: string): Promise<PosCommandResult>;
}

export interface TusMobileClientOptions {
  isOnline?: () => boolean;
  storage?: OfflinePosStorage;
  runtime?: MobileRuntimeConfig;
  tenantId?: string;
}

export interface OfflinePosStorage {
  load(): unknown;
  save(envelope: MobileQueueEnvelope): void;
  quarantine?(entry: MobileQueueQuarantineRecord): void;
  loadQuarantine?(): readonly MobileQueueQuarantineRecord[];
  clearQuarantine?(): void;
}

export function createTusMobileClient(
  transport: TusMobileTransport,
  options: TusMobileClientOptions = {},
): TusMobileClient {
  const isOnline = options.isOnline ?? (() => true);
  const runtime = options.runtime === undefined ? undefined : parseMobileRuntimeConfig(options.runtime);
  if (options.storage !== undefined && runtime === undefined) {
    throw new Error('A validated mobile runtime is required for offline queue storage');
  }
  const quarantined: MobileQueueQuarantineRecord[] = options.storage?.loadQuarantine?.().map((entry) => ({ ...entry })) ?? [];
  const restored = options.storage === undefined
    ? { operations: [], quarantine: null }
    : restoreMobileQueue(options.storage.load(), runtime!, options.tenantId);
  if (restored.quarantine !== null) {
    quarantined.push(restored.quarantine);
    options.storage?.quarantine?.(restored.quarantine);
  }
  const pending = new Map<string, ManualPosOperation>(
    restored.operations.map((operation) => [operation.operationId, { ...operation }]),
  );

  function persist(): boolean {
    try {
      if (options.storage !== undefined && runtime !== undefined) {
        options.storage.save({
          profile: runtime.profile,
          storageVersion: runtime.storageVersion,
        operations: [...pending.values()].map(stripOperationAccessToken),
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  async function submit(operation: ManualPosOperation): Promise<PosCommandResult> {
    try {
      const result = await transport.request({
        method: 'POST',
        path: '/tus/v1/pos/manual-operations',
        operation,
      });
      if (result.status === 'accepted' || result.status === 'replayed') pending.delete(operation.operationId);
      else if (result.status === 'conflict' && result.reason === MOBILE_QUEUE_QUARANTINE_REASON.DEVICE_REVOKED) {
        pending.delete(operation.operationId);
        const entry: MobileQueueQuarantineRecord = { profile: runtime?.profile ?? 'dev', reason: MOBILE_QUEUE_QUARANTINE_REASON.DEVICE_REVOKED, data: redactQueueData(operation) };
        quarantined.push(entry);
        options.storage?.quarantine?.(entry);
      }
      else pending.set(operation.operationId, operation);
      if (!persist()) {
        pending.set(operation.operationId, operation);
        return { status: 'error', operationId: operation.operationId, reason: 'storage_unavailable' };
      }
      return result;
    } catch {
      pending.set(operation.operationId, operation);
      if (!persist()) return { status: 'error', operationId: operation.operationId, reason: 'storage_unavailable' };
      return { status: 'pending', operationId: operation.operationId, reason: 'uncertain_sync' };
    }
  }

  return {
    async recordManualOperation(operation) {
      const preservedOperation = cloneManualPosOperation(operation);
      if (!isOnline()) {
        pending.set(preservedOperation.operationId, preservedOperation);
        if (!persist()) return { status: 'error', operationId: operation.operationId, reason: 'storage_unavailable' };
        return { status: 'queued-offline', operationId: operation.operationId };
      }
      return submit(preservedOperation);
    },

    pendingOperations() {
      return [...pending.values()].map((operation) => ({ ...operation }));
    },

    quarantinedOperations() {
      return quarantined.map((entry) => ({ ...entry }));
    },

    clearQuarantinedOperations() {
      try {
        options.storage?.clearQuarantine?.();
        quarantined.splice(0, quarantined.length);
        return true;
      } catch {
        return false;
      }
    },

    async syncPendingOperations() {
      if (!isOnline()) {
        return [...pending.keys()].map((operationId) => ({
          status: 'pending' as const,
          operationId,
          reason: 'offline' as const,
        }));
      }

      const results: PosCommandResult[] = [];
      for (const operation of [...pending.values()]) {
        results.push(await submit(operation));
      }
      return results;
    },

    async resolveConflict(operationId, resolution) {
      const operation = pending.get(operationId);
      if (operation === undefined) return { status: 'not-found', operationId };
      if (resolution === 'discard') {
        pending.delete(operationId);
        if (!persist()) {
          pending.set(operationId, operation);
          return { status: 'error', operationId, reason: 'storage_unavailable' };
        }
        return { status: 'discarded', operationId };
      }
      if (!isOnline()) return { status: 'conflict', operationId, reason: 'offline' };
      return submit(operation);
    },

    async queryOperationStatus(operationId) {
      if (quarantined.some((entry) => asRecord(entry.data)['operationId'] === operationId)) return { status: 'pending', operationId, reason: 'quarantined' };
      const operation = pending.get(operationId);
      if (operation === undefined) return { status: 'error', operationId, reason: 'not_found' };
      if (transport.queryStatus === undefined) return { status: 'pending', operationId, reason: 'in_progress' };
      return transport.queryStatus(operationId, operation);
    },
  };
}

export function restoreMobileQueue(value: unknown, runtime: MobileRuntimeConfig, tenantId?: string): MobileQueueRestoreResult {
  const resolvedRuntime = parseMobileRuntimeConfig(runtime);
  const profile = resolvedRuntime.profile;
  if (value === null || value === undefined) return { operations: [], quarantine: null };
  if (Array.isArray(value)) {
    return { operations: [], quarantine: { profile, reason: MOBILE_QUEUE_QUARANTINE_REASON.LEGACY_FORMAT, data: redactQueueData(value) } };
  }

  const record = asRecord(value);
  if (record['profile'] !== profile) {
    return { operations: [], quarantine: { profile, reason: MOBILE_QUEUE_QUARANTINE_REASON.PROFILE_MISMATCH, data: redactQueueData(value) } };
  }
  if (record['storageVersion'] !== resolvedRuntime.storageVersion || !Array.isArray(record['operations'])) {
    return { operations: [], quarantine: { profile, reason: MOBILE_QUEUE_QUARANTINE_REASON.INVALID_METADATA, data: redactQueueData(value) } };
  }
  if (record['namespace'] !== undefined && record['namespace'] !== `alqui:${profile}:tus-pos`) {
    return { operations: [], quarantine: { profile, reason: MOBILE_QUEUE_QUARANTINE_REASON.PROFILE_MISMATCH, data: redactQueueData(value) } };
  }
  if (!record['operations'].every((operation) => isManualPosOperation(operation, profile))) {
    return { operations: [], quarantine: { profile, reason: MOBILE_QUEUE_QUARANTINE_REASON.INVALID_OPERATION, data: redactQueueData(value) } };
  }
  if (tenantId !== undefined && record['operations'].some((operation) => operation.tenantId !== tenantId)) {
    return { operations: [], quarantine: { profile, reason: MOBILE_QUEUE_QUARANTINE_REASON.TENANT_MISMATCH, data: redactQueueData(value) } };
  }
  return { operations: record['operations'].map((operation) => stripOperationAccessToken(operation)), quarantine: null };
}

export function createTusMobileFetchTransport(runtime?: MobileRuntimeConfig, credentials?: CredentialStore): TusMobileTransport {
  const resolvedRuntime = runtime === undefined ? readExpoRuntime() : parseMobileRuntimeConfig(runtime);
  const baseUrl = resolvedRuntime.apiUrl;

  return {
    async request({ operation, path }) {
      if (path !== '/tus/v1/pos/manual-operations') {
        throw new Error('Unsupported TUS mobile POS route');
      }
      if (operation.schemaVersion !== resolvedRuntime.tusContractVersion) {
        throw new Error(`Unsupported TUS mobile contract version: ${operation.schemaVersion}`);
      }
      const accessToken = await credentials?.getAccessToken();
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': operation.correlationId,
          'Idempotency-Key': operation.idempotencyKey,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(stripOperationAccessToken(operation)),
      });

      const body: unknown = await response.json().catch(() => null);
      if (response.status === 409) {
        const code = asRecord(body)['code'];
        if (code === 'IN_PROGRESS') return { status: 'pending', operationId: operation.operationId, reason: 'in_progress' };
        return {
          status: 'conflict',
          operationId: operation.operationId,
          reason: code === 'IDEMPOTENCY_CONFLICT' ? 'idempotency_conflict' : 'server_version_changed',
        };
      }
      if (!response.ok) throw new Error(`POS request failed with HTTP ${response.status}`);
      return parsePosCommandResponse(body, operation.operationId);
    },
    async queryStatus(operationId, operation) {
      const accessToken = await credentials?.getAccessToken();
      const response = await fetch(`${baseUrl}/tus/v1/pos/operations/${encodeURIComponent(operationId)}/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(operation?.correlationId ? { 'X-Correlation-Id': operation.correlationId } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
      const body: unknown = await response.json().catch(() => null);
      return response.ok ? parsePosCommandResponse(body, operationId) : { status: 'pending', operationId, reason: 'status_unavailable' };
    },
  };
}

function readExpoRuntime(): MobileRuntimeConfig {
  const constantsModule = require('expo-constants') as { default?: ExpoConstantsLike } & ExpoConstantsLike;
  const constants = constantsModule.default ?? constantsModule;
  return parseMobileRuntimeConfig(constants.expoConfig?.extra?.runtime);
}

interface ExpoConstantsLike {
  expoConfig?: { extra?: { runtime?: unknown } };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function isManualPosOperation(value: unknown, profile: MobileRuntimeConfig['profile']): value is ManualPosOperation {
  const record = asRecord(value);
  const requiredStrings = ['tenantId', 'actorId', 'correlationId', 'operationId', 'idempotencyKey', 'kind', 'context', 'currency', 'deviceId', 'shiftId', 'schemaVersion', 'createdAt'];
  if (!requiredStrings.every((field) => typeof record[field] === 'string' && record[field].trim().length > 0)) return false;
  if (typeof record['amount'] !== 'number' || !Number.isFinite(record['amount']) || record['amount'] <= 0) return false;
  if ('profile' in record && record['profile'] !== profile) return false;
  return true;
}

function cloneManualPosOperation(operation: ManualPosOperation): ManualPosOperation {
  return stripOperationAccessToken(operation);
}

function stripOperationAccessToken(operation: ManualPosOperation): ManualPosOperation {
  const safeOperation = { ...operation };
  delete safeOperation.accessToken;
  return safeOperation;
}

function redactQueueData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactQueueData(item));
  if (typeof value !== 'object' || value === null) return value;
  const record = { ...(value as Record<string, unknown>) };
  delete record['accessToken'];
  for (const [key, nested] of Object.entries(record)) {
    record[key] = redactQueueData(nested);
  }
  return record;
}

export default { createTusMobileClient, createTusMobileFetchTransport, posFeedback };
