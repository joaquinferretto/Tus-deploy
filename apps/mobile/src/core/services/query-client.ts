import { QueryClient, type Query } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

import { createEncryptedMMKVClient, type MMKVLocalStorageClient } from './mmkv-storage';

export const QUERY_CACHE_SCHEMA_VERSION = 1;

export interface OfflineQueryClientOptions {
  profile: string;
  maxAgeMs?: number;
  staleTimeMs?: number;
  gcTimeMs?: number;
  buster?: string;
  storage?: MMKVLocalStorageClient;
  throttleTimeMs?: number;
}

export interface OfflineQueryClientSetup {
  queryClient: QueryClient;
  persister: Persister;
  persistOptions: {
    persister: Persister;
    maxAge: number;
    buster: string;
    dehydrateOptions: {
      shouldDehydrateQuery: (query: Query) => boolean;
    };
  };
  cacheKey: string;
  clearPersistedCache(): Promise<void>;
}

const DEFAULT_QUERY_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const DEFAULT_STALE_TIME_MS = 1000 * 60;
const DEFAULT_THROTTLE_TIME_MS = 1000;

export async function createOfflineQueryClient(
  options: OfflineQueryClientOptions,
): Promise<OfflineQueryClientSetup> {
  const maxAge = options.maxAgeMs ?? DEFAULT_QUERY_MAX_AGE_MS;
  const storage =
    options.storage ??
    (await createEncryptedMMKVClient({
      profile: options.profile,
      namespace: 'cache',
      keyPrefix: `alqui:${options.profile}`,
      encryption: { enabled: true, secureStoreKey: 'mmkv.encryptionKey' },
    }));
  const cacheKey = buildQueryCacheKey(options.profile);
  const persister = createMMKVQueryPersister({
    storage,
    key: cacheKey,
    throttleTimeMs: options.throttleTimeMs ?? DEFAULT_THROTTLE_TIME_MS,
  });
  const buster = options.buster ?? buildQueryCacheBuster(options.profile);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        staleTime: options.staleTimeMs ?? DEFAULT_STALE_TIME_MS,
        gcTime: options.gcTimeMs ?? maxAge,
        retry: (failureCount, error) => failureCount < 2 && isTransientQueryError(error),
      },
      mutations: {
        networkMode: 'offlineFirst',
        retry: 1,
      },
    },
  });

  return {
    queryClient,
    persister,
    persistOptions: {
      persister,
      maxAge,
      buster,
      dehydrateOptions: {
        shouldDehydrateQuery,
      },
    },
    cacheKey,
    clearPersistedCache: async () => {
      queryClient.clear();
      await persister.removeClient();
    },
  };
}

export interface MMKVQueryPersisterOptions {
  storage: MMKVLocalStorageClient;
  key: string;
  throttleTimeMs?: number;
  serialize?: (client: PersistedClient) => string;
  deserialize?: (value: string) => PersistedClient;
}

export function createMMKVQueryPersister(options: MMKVQueryPersisterOptions): Persister {
  const serialize = options.serialize ?? JSON.stringify;
  const deserialize = options.deserialize ?? JSON.parse;
  const throttleTimeMs = options.throttleTimeMs ?? DEFAULT_THROTTLE_TIME_MS;
  let pendingClient: PersistedClient | null = null;
  let throttleHandle: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (pendingClient === null) return;
    options.storage.setString(options.key, serialize(pendingClient));
    pendingClient = null;
    throttleHandle = null;
  };

  return {
    persistClient: async (client) => {
      pendingClient = client;
      if (throttleHandle !== null) return;
      throttleHandle = setTimeout(flush, throttleTimeMs);
    },
    restoreClient: async () => {
      const value = options.storage.getString(options.key);
      if (value === null) return undefined;

      try {
        return deserialize(value);
      } catch {
        options.storage.removeItem(options.key);
        return undefined;
      }
    },
    removeClient: async () => {
      if (throttleHandle !== null) {
        clearTimeout(throttleHandle);
        throttleHandle = null;
      }
      pendingClient = null;
      options.storage.removeItem(options.key);
    },
  };
}

export function buildQueryCacheKey(profile: string): string {
  return `alqui:${profile}:tanstack:query`;
}

export function buildQueryCacheBuster(profile: string): string {
  return `${profile}:query-schema-v${QUERY_CACHE_SCHEMA_VERSION}`;
}

function shouldDehydrateQuery(query: Query): boolean {
  const meta = query.meta;
  if (meta?.sensitive === true) return false;
  if (meta?.persist === false) return false;
  return query.state.status === 'success';
}

function isTransientQueryError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('retryable' in error && error.retryable === true) return true;
  if ('kind' in error && (error.kind === 'offline' || error.kind === 'timeout' || error.kind === 'server')) {
    return true;
  }
  return false;
}
