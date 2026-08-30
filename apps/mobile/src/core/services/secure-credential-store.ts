import * as SecureStore from 'expo-secure-store';

import { parseMobileRuntimeConfig, type MobileRuntimeConfig } from '../config/runtime-profile.ts';

export const SECURE_STORE_ERROR_KIND = {
  UNAVAILABLE: 'unavailable',
  READ_FAILED: 'read_failed',
  WRITE_FAILED: 'write_failed',
  DELETE_FAILED: 'delete_failed',
} as const;

export type SecureStoreErrorKind =
  (typeof SECURE_STORE_ERROR_KIND)[keyof typeof SECURE_STORE_ERROR_KIND];

type ExpoSecureStoreOptions = NonNullable<Parameters<typeof SecureStore.getItemAsync>[1]>;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface CredentialSnapshot {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}

export interface CredentialStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  getTokenSnapshot(): Promise<CredentialSnapshot>;
  setTokens(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

export interface SensitiveItemStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SecureCredentialStoreOptions {
  runtime: MobileRuntimeConfig;
  namespace?: string;
  secureStoreOptions?: ExpoSecureStoreOptions;
}

export function buildSecureStorageKey(runtime: MobileRuntimeConfig, key: string, namespace = 'alqui'): string {
  const resolvedRuntime = parseMobileRuntimeConfig(runtime);
  if (key.trim().length === 0) throw new Error('SecureStore key is required');
  return `${namespace}.${resolvedRuntime.profile}.${key}`;
}

export class SecureStoreStorageError extends Error {
  readonly kind: SecureStoreErrorKind;
  readonly storageKey: string;
  readonly originalError?: unknown;

  constructor(kind: SecureStoreErrorKind, storageKey: string, message: string, originalError?: unknown) {
    super(message);
    this.name = 'SecureStoreStorageError';
    this.kind = kind;
    this.storageKey = storageKey;
    if (originalError !== undefined) {
      this.originalError = originalError;
    }
  }
}

export class SecureCredentialStore implements CredentialStore, SensitiveItemStore {
  private readonly runtime: MobileRuntimeConfig;
  private readonly namespace: string;
  private readonly secureStoreOptions: ExpoSecureStoreOptions | undefined;

  constructor(options: SecureCredentialStoreOptions) {
    this.runtime = parseMobileRuntimeConfig(options.runtime);
    this.namespace = options.namespace ?? 'alqui';
    this.secureStoreOptions = options.secureStoreOptions;
  }

  async getAccessToken(): Promise<string | null> {
    return this.getItem('auth.accessToken');
  }

  async getRefreshToken(): Promise<string | null> {
    return this.getItem('auth.refreshToken');
  }

  async getTokenSnapshot(): Promise<CredentialSnapshot> {
    const [accessToken, refreshToken, expiresAtRaw] = await Promise.all([
      this.getAccessToken(),
      this.getRefreshToken(),
      this.getItem('auth.expiresAt'),
    ]);

    const parsedExpiresAt = expiresAtRaw === null ? null : Number(expiresAtRaw);

    return {
      accessToken,
      refreshToken,
      expiresAt: parsedExpiresAt !== null && Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : null,
    };
  }

  async setTokens(tokens: TokenPair): Promise<void> {
    try {
      await Promise.all([
        this.setItem('auth.accessToken', tokens.accessToken),
        this.setItem('auth.refreshToken', tokens.refreshToken),
        this.setItem('auth.expiresAt', String(tokens.expiresAt)),
      ]);
    } catch (error: unknown) {
      await this.clear().catch(() => undefined);
      throw error;
    }
  }

  async setSessionToken(accessToken: string, expiresAt: number): Promise<void> {
    await this.setTokens({ accessToken, refreshToken: '', expiresAt })
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.removeItem('auth.accessToken'),
      this.removeItem('auth.refreshToken'),
      this.removeItem('auth.expiresAt'),
    ]);
  }

  async getItem(key: string): Promise<string | null> {
    const storageKey = this.resolveKey(key);
    await this.assertAvailable(storageKey);

    try {
      return await SecureStore.getItemAsync(storageKey, this.secureStoreOptions);
    } catch (error: unknown) {
      throw new SecureStoreStorageError(
        SECURE_STORE_ERROR_KIND.READ_FAILED,
        storageKey,
        `SecureStore failed to read ${storageKey}`,
        error,
      );
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const storageKey = this.resolveKey(key);
    await this.assertAvailable(storageKey);

    try {
      await SecureStore.setItemAsync(storageKey, value, this.secureStoreOptions);
    } catch (error: unknown) {
      throw new SecureStoreStorageError(
        SECURE_STORE_ERROR_KIND.WRITE_FAILED,
        storageKey,
        `SecureStore failed to write ${storageKey}`,
        error,
      );
    }
  }

  async removeItem(key: string): Promise<void> {
    const storageKey = this.resolveKey(key);
    await this.assertAvailable(storageKey);

    try {
      await SecureStore.deleteItemAsync(storageKey, this.secureStoreOptions);
    } catch (error: unknown) {
      throw new SecureStoreStorageError(
        SECURE_STORE_ERROR_KIND.DELETE_FAILED,
        storageKey,
        `SecureStore failed to delete ${storageKey}`,
        error,
      );
    }
  }

  private resolveKey(key: string): string {
    const prefix = `${this.namespace}.${this.runtime.profile}.`;
    return key.startsWith(prefix) ? key : `${prefix}${key}`;
  }

  private async assertAvailable(storageKey: string): Promise<void> {
    const available = await SecureStore.isAvailableAsync();
    if (!available) {
      throw new SecureStoreStorageError(
        SECURE_STORE_ERROR_KIND.UNAVAILABLE,
        storageKey,
        'SecureStore is unavailable on this device. Reauthentication is required.',
      );
    }
  }
}
