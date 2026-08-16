import * as Crypto from 'expo-crypto';
import { MMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

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
  profile: string;
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
  const id = `alqui-${options.profile}-${namespace}`;
  const keyPrefix = options.keyPrefix ?? `alqui:${options.profile}`;

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

  const secureStoreKey = encryption.secureStoreKey ?? 'mmkv.encryptionKey';
  const sensitiveStore =
    options.sensitiveStore ?? new SecureCredentialStore({ profile: options.profile });

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

async function generateEncryptionKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
