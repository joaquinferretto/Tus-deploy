import * as Crypto from 'expo-crypto';
import { MMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

import { parseMobileRuntimeConfig, type MobileRuntimeConfig } from '../config/runtime-profile.ts';
import { SecureCredentialStore, type SensitiveItemStore } from './secure-credential-store';

export const MMKV_STORAGE_ERROR_KIND = {
  INITIALIZATION_FAILED: 'initialization_failed',
  ENCRYPTION_KEY_FAILED: 'encryption_key_failed',
} as const;

export type MMKVStorageErrorKind =
  (typeof MMKV_STORAGE_ERROR_KIND)[keyof typeof MMKV_STORAGE_ERROR_KIND];

export interface MMKVEncryptionConfig {
  enabled: boolean;
  key?: string;
  secureStoreKey?: string;
}

export interface MMKVLocalStorageOptions {
  runtime: MobileRuntimeConfig;
  namespace?: string;
  keyPrefix?: string;
  encryption?: MMKVEncryptionConfig;
  sensitiveStore?: SensitiveItemStore;
}

export class MMKVStorageError extends Error {
  readonly kind: MMKVStorageErrorKind;
  readonly originalError?: unknown;

  constructor(kind: MMKVStorageErrorKind, message: string, originalError?: unknown) {
    super(message);
    this.name = 'MMKVStorageError';
    this.kind = kind;
    if (originalError !== undefined) {
      this.originalError = originalError;
    }
  }
}

export function buildMMKVStorageIdentity(runtime: MobileRuntimeConfig, namespace = 'cache'): { id: string; keyPrefix: string } {
  const resolvedRuntime = parseMobileRuntimeConfig(runtime);
  const normalizedNamespace = namespace.trim();
  if (normalizedNamespace.length === 0) throw new Error('MMKV namespace is required');
  return {
    id: `alqui-${resolvedRuntime.profile}-${normalizedNamespace}`,
    keyPrefix: `alqui:${resolvedRuntime.profile}`,
  };
}

export class MMKVLocalStorageClient {
  private readonly storage: MMKV;
  private readonly keyPrefix: string;

  constructor(storage: MMKV, keyPrefix: string) {
    this.storage = storage;
    this.keyPrefix = keyPrefix;
  }

  getString(key: string): string | null {
    return this.storage.getString(this.resolveKey(key)) ?? null;
  }

  setString(key: string, value: string): void {
    this.storage.set(this.resolveKey(key), value);
  }

  removeItem(key: string): void {
    this.storage.delete(this.resolveKey(key));
  }

  clearAll(): void {
    this.storage.clearAll();
  }

  createZustandStorage(): StateStorage {
    return {
      getItem: (name: string) => this.getString(name),
      setItem: (name: string, value: string) => this.setString(name, value),
      removeItem: (name: string) => this.removeItem(name),
    };
  }

  private resolveKey(key: string): string {
    if (this.keyPrefix.length === 0 || key.startsWith(`${this.keyPrefix}:`)) {
      return key;
    }

    return `${this.keyPrefix}:${key}`;
  }
}

export async function createEncryptedMMKVClient(
  options: MMKVLocalStorageOptions,
): Promise<MMKVLocalStorageClient> {
  const namespace = options.namespace ?? 'cache';
  const identity = buildMMKVStorageIdentity(options.runtime, namespace);
  const id = identity.id;
  const keyPrefix = options.keyPrefix ?? identity.keyPrefix;
  if (keyPrefix !== identity.keyPrefix && !keyPrefix.startsWith(`${identity.keyPrefix}:`)) {
    throw new MMKVStorageError(
      MMKV_STORAGE_ERROR_KIND.INITIALIZATION_FAILED,
      `MMKV key prefix must remain within the ${identity.keyPrefix} profile namespace`,
    );
  }

  try {
    const encryptionKey = await resolveEncryptionKey(options);
    const mmkvOptions: { id: string; encryptionKey?: string } = { id };

    if (encryptionKey !== null) {
      mmkvOptions.encryptionKey = encryptionKey;
    }

    return new MMKVLocalStorageClient(new MMKV(mmkvOptions), keyPrefix);
  } catch (error: unknown) {
    if (error instanceof MMKVStorageError) {
      throw error;
    }

    throw new MMKVStorageError(
      MMKV_STORAGE_ERROR_KIND.INITIALIZATION_FAILED,
      `Unable to initialize MMKV storage ${id}`,
      error,
    );
  }
}

export async function createEncryptedMMKVStateStorage(
  options: MMKVLocalStorageOptions,
): Promise<StateStorage> {
  const client = await createEncryptedMMKVClient(options);
  return client.createZustandStorage();
}

async function resolveEncryptionKey(options: MMKVLocalStorageOptions): Promise<string | null> {
  const encryption = options.encryption ?? { enabled: true };

  if (!encryption.enabled) {
    return null;
  }

  if (encryption.key !== undefined && encryption.key.length > 0) {
    return encryption.key;
  }

  const runtime = parseMobileRuntimeConfig(options.runtime);
  const secureStoreKey = buildProfiledEncryptionKey(
    runtime,
    encryption.secureStoreKey ?? 'mmkv.encryptionKey',
  );
  const sensitiveStore =
    options.sensitiveStore ?? new SecureCredentialStore({ runtime });

  try {
    const existingKey = await sensitiveStore.getItem(secureStoreKey);
    if (existingKey !== null && existingKey.length > 0) {
      return existingKey;
    }

    const generatedKey = await generateEncryptionKey();
    await sensitiveStore.setItem(secureStoreKey, generatedKey);
    return generatedKey;
  } catch (error: unknown) {
    throw new MMKVStorageError(
      MMKV_STORAGE_ERROR_KIND.ENCRYPTION_KEY_FAILED,
      'Unable to resolve MMKV encryption key from SecureStore',
      error,
    );
  }
}

function buildProfiledEncryptionKey(runtime: MobileRuntimeConfig, key: string): string {
  const normalizedKey = key.trim();
  if (normalizedKey.startsWith(`alqui.${runtime.profile}.`)) return normalizedKey;
  return `alqui.${runtime.profile}.${normalizedKey}`;
}

async function generateEncryptionKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
