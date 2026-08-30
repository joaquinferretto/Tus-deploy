import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import {
  createEncryptedMMKVStateStorage,
  type MMKVEncryptionConfig,
} from '@core/services/mmkv-storage';
import { parseMobileRuntimeConfig, type MobileRuntimeConfig, type MobileProfile } from '@core/config/runtime-profile';

export const AUTH_STATUS = {
  UNKNOWN: 'unknown',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
  EXPIRED: 'expired',
  UNAVAILABLE: 'unavailable',
} as const;

export const THEME_MODE = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark',
} as const;

export type AuthStatus = (typeof AUTH_STATUS)[keyof typeof AUTH_STATUS];
export type ThemeMode = (typeof THEME_MODE)[keyof typeof THEME_MODE];

export const POS_INTENT_STATUS = {
  IDLE: 'idle',
  SUBMITTING: 'submitting',
  ACCEPTED: 'accepted',
  REPLAYED: 'replayed',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  ERROR: 'error',
} as const;

export type PosIntentStatus = (typeof POS_INTENT_STATUS)[keyof typeof POS_INTENT_STATUS];
export type PosIntentAction = 'retry' | 'refresh' | 'resolve' | 'none';

export interface PosIntentState {
  status: PosIntentStatus;
  operationId: string | null;
  message: string;
  action: PosIntentAction;
}

export interface AuthState {
  status: AuthStatus;
  subjectId: string | null;
  sessionId: string | null;
  tenantId: string | null;
  roles: string[];
  permissions: string[];
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
  authReady: boolean;
}

export interface AuthSessionInput {
  subjectId: string;
  sessionId: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  expiresAt: number;
}

export interface AppStoreState {
  runtimeProfile: MobileProfile | null;
  auth: AuthState;
  network: NetworkState;
  settings: SettingsState;
  pos: PosIntentState;
  hydration: HydrationState;
  markAuthenticated: (session: AuthSessionInput) => void;
  markUnauthenticated: () => void;
  markExpired: () => void;
  markUnavailable: () => void;
  setNetworkOnline: (isOnline: boolean) => void;
  setLastSyncAt: (lastSyncAt: number | null) => void;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: string) => void;
  markPosIntent: (input: { status: string; operationId: string; message?: string; action?: PosIntentAction }) => void;
  clearPosIntent: () => void;
  setQueryReady: (queryReady: boolean) => void;
  setStoreReady: (storeReady: boolean) => void;
  setAuthReady: (authReady: boolean) => void;
  resetClientState: () => void;
}

export interface PersistedAppStoreState {
  runtimeProfile: MobileRuntimeConfig['profile'] | null;
  auth: AuthState;
  network: NetworkState;
  settings: SettingsState;
  pos: PosIntentState;
}

export interface InitializeAppStoreOptions {
  runtime: MobileRuntimeConfig;
  encryptionKey?: string;
  encryptionEnabled?: boolean;
}

const STORE_SCHEMA_VERSION = 1;
const DEFAULT_AUTH_STATE: AuthState = {
  status: AUTH_STATUS.UNKNOWN,
  subjectId: null,
  sessionId: null,
  tenantId: null,
  roles: [],
  permissions: [],
  expiresAt: null,
};
const DEFAULT_NETWORK_STATE: NetworkState = {
  isOnline: true,
  lastSyncAt: null,
};
const DEFAULT_SETTINGS_STATE: SettingsState = {
  theme: THEME_MODE.SYSTEM,
  locale: 'es-AR',
};
const DEFAULT_HYDRATION_STATE: HydrationState = {
  queryReady: false,
  storeReady: false,
  authReady: false,
};
const DEFAULT_POS_INTENT_STATE: PosIntentState = {
  status: POS_INTENT_STATUS.IDLE,
  operationId: null,
  message: 'No POS intent has been submitted.',
  action: 'none',
};

let activeStorage: StateStorage = createInMemoryStateStorage();
let activeRuntime: MobileRuntimeConfig | null = null;

export const useAppStore = create<AppStoreState>()(
  persist<AppStoreState, [], [], PersistedAppStoreState>(
    (set) => ({
      auth: DEFAULT_AUTH_STATE,
      runtimeProfile: null,
      network: DEFAULT_NETWORK_STATE,
      settings: DEFAULT_SETTINGS_STATE,
      pos: DEFAULT_POS_INTENT_STATE,
      hydration: DEFAULT_HYDRATION_STATE,
      markAuthenticated: (session: AuthSessionInput) =>
        set({
          auth: {
            status: AUTH_STATUS.AUTHENTICATED,
            subjectId: session.subjectId,
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            roles: [...session.roles],
            permissions: [...session.permissions],
            expiresAt: session.expiresAt,
          },
        }),
      markUnauthenticated: () =>
        set({
          auth: {
            status: AUTH_STATUS.UNAUTHENTICATED,
            subjectId: null,
            sessionId: null,
            tenantId: null,
            roles: [],
            permissions: [],
            expiresAt: null,
          },
        }),
      markExpired: () =>
        set({
          auth: {
            ...DEFAULT_AUTH_STATE,
            status: AUTH_STATUS.EXPIRED,
          },
        }),
      markUnavailable: () =>
        set({
          auth: {
            ...DEFAULT_AUTH_STATE,
            status: AUTH_STATUS.UNAVAILABLE,
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
      markPosIntent: (input) =>
        set({
          pos: resolvePosIntentState(input),
        }),
      clearPosIntent: () =>
        set({
          pos: DEFAULT_POS_INTENT_STATE,
        }),
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
      setAuthReady: (authReady: boolean) =>
        set((state) => ({
          hydration: {
            ...state.hydration,
            authReady,
          },
        })),
      resetClientState: () =>
        set({
          runtimeProfile: activeRuntime?.profile ?? null,
          auth: {
            status: AUTH_STATUS.UNAUTHENTICATED,
            subjectId: null,
            sessionId: null,
            tenantId: null,
            roles: [],
            permissions: [],
            expiresAt: null,
          },
          network: DEFAULT_NETWORK_STATE,
          settings: DEFAULT_SETTINGS_STATE,
          pos: DEFAULT_POS_INTENT_STATE,
          hydration: {
            queryReady: false,
            storeReady: true,
            authReady: true,
          },
        }),
    }),
    {
      name: 'alqui:uninitialized:zustand:app',
      version: STORE_SCHEMA_VERSION,
      storage: createJSONStorage(() => activeStorage),
      skipHydration: true,
      partialize: (state) => ({
        runtimeProfile: state.runtimeProfile ?? activeRuntime?.profile ?? null,
        auth: state.auth,
        network: state.network,
        settings: state.settings,
        pos: state.pos,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error === undefined && state?.runtimeProfile === activeRuntime?.profile) {
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
  const runtime = parseMobileRuntimeConfig(options.runtime);
  activeRuntime = runtime;
  const encryption: MMKVEncryptionConfig = {
    enabled: options.encryptionEnabled ?? true,
    secureStoreKey: 'mmkv.encryptionKey',
  };

  if (options.encryptionKey !== undefined) {
    encryption.key = options.encryptionKey;
  }

  activeStorage = await createEncryptedMMKVStateStorage({
    runtime,
    namespace: 'cache',
    encryption,
  });

  useAppStore.persist.setOptions({
    name: buildPersistKey(runtime),
    storage: createJSONStorage(() => activeStorage),
  });

  await useAppStore.persist.rehydrate();
}

export function resolvePosIntentState(input: { status: string; operationId: string; message?: string; action?: PosIntentAction }): PosIntentState {
  const normalizedStatus = input.status === 'queued-offline' ? POS_INTENT_STATUS.PENDING : input.status;
  const status = isPosIntentStatus(normalizedStatus) ? normalizedStatus : POS_INTENT_STATUS.ERROR;
  return {
    status,
    operationId: input.operationId,
    message: input.message ?? defaultPosIntentMessage(status),
    action: input.action ?? defaultPosIntentAction(status),
  };
}

export function posIntentActionLabel(action: PosIntentAction): string {
  if (action === 'retry') return 'Retry same operation';
  if (action === 'refresh') return 'Refresh server status';
  if (action === 'resolve') return 'Review preserved conflict';
  return '';
}

function isPosIntentStatus(value: string): value is PosIntentStatus {
  return Object.values(POS_INTENT_STATUS).includes(value as PosIntentStatus);
}

function defaultPosIntentMessage(status: PosIntentStatus): string {
  if (status === POS_INTENT_STATUS.SUBMITTING) return 'POS intent is being submitted to TUS.';
  if (status === POS_INTENT_STATUS.ACCEPTED) return 'TUS acknowledged the POS intent.';
  if (status === POS_INTENT_STATUS.REPLAYED) return 'TUS replayed the original POS result.';
  if (status === POS_INTENT_STATUS.PENDING) return 'POS intent is pending server acknowledgement.';
  if (status === POS_INTENT_STATUS.CONFLICT) return 'POS intent requires staff review.';
  if (status === POS_INTENT_STATUS.ERROR) return 'POS intent was not acknowledged.';
  return 'No POS intent has been submitted.';
}

function defaultPosIntentAction(status: PosIntentStatus): PosIntentAction {
  if (status === POS_INTENT_STATUS.SUBMITTING) return 'none';
  if (status === POS_INTENT_STATUS.CONFLICT) return 'resolve';
  if (status === POS_INTENT_STATUS.PENDING || status === POS_INTENT_STATUS.ERROR) return 'retry';
  if (status === POS_INTENT_STATUS.ACCEPTED || status === POS_INTENT_STATUS.REPLAYED) return 'refresh';
  return 'none';
}

export async function clearPersistedAppState(): Promise<void> {
  await useAppStore.persist.clearStorage();
  useAppStore.getState().resetClientState();
}

export function buildPersistKey(runtime: MobileRuntimeConfig): string {
  return `alqui:${parseMobileRuntimeConfig(runtime).profile}:zustand:app`;
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
