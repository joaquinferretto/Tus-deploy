import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import {
  createEncryptedMMKVStateStorage,
  type MMKVEncryptionConfig,
} from '@core/services/mmkv-storage';

export const AUTH_STATUS = {
  UNKNOWN: 'unknown',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
} as const;

export const THEME_MODE = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark',
} as const;

export type AuthStatus = (typeof AUTH_STATUS)[keyof typeof AUTH_STATUS];
export type ThemeMode = (typeof THEME_MODE)[keyof typeof THEME_MODE];

export interface AuthState {
  status: AuthStatus;
  subjectId: string | null;
  expiresAt: number | null;
}

export interface NetworkState {
  isOnline: boolean;
  lastSyncAt: number | null;
}

export interface SettingsState {
  theme: ThemeMode;
  locale: string;
}

export interface HydrationState {
  queryReady: boolean;
  storeReady: boolean;
}

export interface AuthSessionInput {
  subjectId: string;
  expiresAt: number;
}

export interface AppStoreState {
  auth: AuthState;
  network: NetworkState;
  settings: SettingsState;
  hydration: HydrationState;
  markAuthenticated: (session: AuthSessionInput) => void;
  markUnauthenticated: () => void;
  setNetworkOnline: (isOnline: boolean) => void;
  setLastSyncAt: (lastSyncAt: number | null) => void;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: string) => void;
  setQueryReady: (queryReady: boolean) => void;
  setStoreReady: (storeReady: boolean) => void;
  resetClientState: () => void;
}

export interface PersistedAppStoreState {
  auth: AuthState;
  network: NetworkState;
  settings: SettingsState;
}

export interface InitializeAppStoreOptions {
  profile: string;
  encryptionKey?: string;
  encryptionEnabled?: boolean;
}

const STORE_SCHEMA_VERSION = 1;
const DEFAULT_AUTH_STATE: AuthState = {
  status: AUTH_STATUS.UNKNOWN,
  subjectId: null,
  expiresAt: null,
};
const DEFAULT_NETWORK_STATE: NetworkState = {
  isOnline: true,
  lastSyncAt: null,
};
const DEFAULT_SETTINGS_STATE: SettingsState = {
  theme: THEME_MODE.SYSTEM,
  locale: 'en',
};
const DEFAULT_HYDRATION_STATE: HydrationState = {
  queryReady: false,
  storeReady: false,
};

let activeStorage: StateStorage = createInMemoryStateStorage();

export const useAppStore = create<AppStoreState>()(
  persist<AppStoreState, [], [], PersistedAppStoreState>(
    (set) => ({
      auth: DEFAULT_AUTH_STATE,
      network: DEFAULT_NETWORK_STATE,
      settings: DEFAULT_SETTINGS_STATE,
      hydration: DEFAULT_HYDRATION_STATE,
      markAuthenticated: (session: AuthSessionInput) =>
        set({
          auth: {
            status: AUTH_STATUS.AUTHENTICATED,
            subjectId: session.subjectId,
            expiresAt: session.expiresAt,
          },
        }),
      markUnauthenticated: () =>
        set({
          auth: {
            status: AUTH_STATUS.UNAUTHENTICATED,
            subjectId: null,
            expiresAt: null,
          },
        }),
      setNetworkOnline: (isOnline: boolean) =>
        set((state) => ({
          network: {
            ...state.network,
            isOnline,
          },
        })),
      setLastSyncAt: (lastSyncAt: number | null) =>
        set((state) => ({
          network: {
            ...state.network,
            lastSyncAt,
          },
        })),
      setTheme: (theme: ThemeMode) =>
        set((state) => ({
          settings: {
            ...state.settings,
            theme,
          },
        })),
      setLocale: (locale: string) =>
        set((state) => ({
          settings: {
            ...state.settings,
            locale,
          },
        })),
      setQueryReady: (queryReady: boolean) =>
        set((state) => ({
          hydration: {
            ...state.hydration,
            queryReady,
          },
        })),
      setStoreReady: (storeReady: boolean) =>
        set((state) => ({
          hydration: {
            ...state.hydration,
            storeReady,
          },
        })),
      resetClientState: () =>
        set({
          auth: {
            status: AUTH_STATUS.UNAUTHENTICATED,
            subjectId: null,
            expiresAt: null,
          },
          network: DEFAULT_NETWORK_STATE,
          settings: DEFAULT_SETTINGS_STATE,
          hydration: {
            queryReady: false,
            storeReady: true,
          },
        }),
    }),
    {
      name: buildPersistKey('dev'),
      version: STORE_SCHEMA_VERSION,
      storage: createJSONStorage(() => activeStorage),
      skipHydration: true,
      partialize: (state) => ({
        auth: state.auth,
        network: state.network,
        settings: state.settings,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error === undefined) {
          state?.setStoreReady(true);
          return;
        }

        state?.resetClientState();
      },
    },
  ),
);

export async function initializeAppStorePersistence(
  options: InitializeAppStoreOptions,
): Promise<void> {
  const encryption: MMKVEncryptionConfig = {
    enabled: options.encryptionEnabled ?? true,
    secureStoreKey: 'mmkv.encryptionKey',
  };

  if (options.encryptionKey !== undefined) {
    encryption.key = options.encryptionKey;
  }

  activeStorage = await createEncryptedMMKVStateStorage({
    profile: options.profile,
    namespace: 'cache',
    encryption,
  });

  useAppStore.persist.setOptions({
    name: buildPersistKey(options.profile),
    storage: createJSONStorage(() => activeStorage),
  });

  await useAppStore.persist.rehydrate();
}

export async function clearPersistedAppState(): Promise<void> {
  await useAppStore.persist.clearStorage();
  useAppStore.getState().resetClientState();
}

export function buildPersistKey(profile: string): string {
  return `alqui:${profile}:zustand:app`;
}

function createInMemoryStateStorage(): StateStorage {
  const memory = new Map<string, string>();

  return {
    getItem: (name: string) => memory.get(name) ?? null,
    setItem: (name: string, value: string) => {
      memory.set(name, value);
    },
    removeItem: (name: string) => {
      memory.delete(name);
    },
  };
}
