import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AUTH_STATUS, initializeAppStorePersistence, useAppStore } from '@/store';
import { createTusMobileAuthClient } from '@application/tus-auth';
import { SecureCredentialStore } from '@core/services/secure-credential-store';
import { readMobileRuntimeConfig } from '@core/config/runtime-profile';
import { bootstrapMobileRuntime, type MobileRuntimeDiagnostics } from '@core/config/runtime-diagnostics';
import { MOBILE_SAFE_AREA_EDGES } from '@presentation/layout/tus-responsive';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={[...MOBILE_SAFE_AREA_EDGES]} style={styles.safeArea}>
        <AppBootstrap>
          <AuthGuard>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(app)" />
            </Stack>
          </AuthGuard>
        </AppBootstrap>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

interface LayoutChildrenProps {
  children: ReactNode;
}

function AppBootstrap({ children }: LayoutChildrenProps) {
  const [diagnostics, setDiagnostics] = useState<MobileRuntimeDiagnostics | null>(null);
  const storeReady = useAppStore((state) => state.hydration.storeReady);
  const markUnauthenticated = useAppStore((state) => state.markUnauthenticated);
  const markExpired = useAppStore((state) => state.markExpired);
  const markUnavailable = useAppStore((state) => state.markUnavailable);
  const markAuthenticated = useAppStore((state) => state.markAuthenticated);
  const setStoreReady = useAppStore((state) => state.setStoreReady);
  const setAuthReady = useAppStore((state) => state.setAuthReady);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapStore(): Promise<void> {
      const result = await bootstrapMobileRuntime({
        readRuntime: readMobileRuntimeConfig,
        initializePersistence: async (runtime) => initializeAppStorePersistence({ runtime }),
        restoreSession: async (runtime) => {
          const authClient = createTusMobileAuthClient({ runtime, credentials: new SecureCredentialStore({ runtime }) });
          return authClient.restore();
        },
        onDiagnostics: (nextDiagnostics) => {
          if (!cancelled) setDiagnostics(nextDiagnostics);
        },
      });

      if (cancelled) return;
      if (result.status === 'unavailable') {
        markUnavailable();
        setAuthReady(true);
        setStoreReady(true);
        return;
      }

      const { sessionState } = result;
      if (sessionState.status === 'authenticated' && sessionState.session !== undefined) {
        markAuthenticated(sessionState.session);
      } else if (sessionState.status === 'expired') {
        markExpired();
      } else if (sessionState.status === 'unavailable') {
        markUnavailable();
      } else {
        markUnauthenticated();
      }
      setAuthReady(true);
    }

    void bootstrapStore();

    return () => {
      cancelled = true;
    };
  }, [markAuthenticated, markExpired, markUnauthenticated, markUnavailable, setAuthReady, setStoreReady]);

  useEffect(() => {
    if (storeReady) {
      void SplashScreen.hideAsync();
    }
  }, [storeReady]);

  if (!storeReady) {
    return <BootFallback diagnostics={diagnostics} />;
  }

  if (diagnostics?.status === 'invalid') {
    return <RuntimeUnavailable diagnostics={diagnostics} />;
  }

  return <>{children}</>;
}

function AuthGuard({ children }: LayoutChildrenProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const storeReady = useAppStore((state) => state.hydration.storeReady);
  const authReady = useAppStore((state) => state.hydration.authReady);
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    if (!storeReady || !authReady || rootNavigationState?.key === undefined) {
      return;
    }

    const routeGroup = segments[0];
    const isAuthRoute = routeGroup === '(auth)';
    const isAuthenticated = authStatus === AUTH_STATUS.AUTHENTICATED;

    if (!isAuthenticated && !isAuthRoute) {
      router.replace('/(auth)/login');
      return;
    }

    if (isAuthenticated && isAuthRoute) {
      router.replace('/(app)');
    }
  }, [authReady, authStatus, rootNavigationState?.key, router, segments, storeReady]);

  return <>{children}</>;
}

function BootFallback({ diagnostics }: { diagnostics: MobileRuntimeDiagnostics | null }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator accessibilityLabel="Preparing secure local storage" />
      <Text accessibilityLiveRegion="polite" style={styles.message}>Preparing secure session…</Text>
      {diagnostics === null ? null : <Text accessibilityLiveRegion="polite" style={styles.diagnostic}>{diagnostics.message}</Text>}
    </View>
  );
}

function RuntimeUnavailable({ diagnostics }: { diagnostics: MobileRuntimeDiagnostics }) {
  return (
    <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.centered}>
      <Text accessibilityRole="header" style={styles.unavailableTitle}>TUS is temporarily unavailable</Text>
      <Text style={styles.message}>{diagnostics.message}</Text>
      <Text style={styles.diagnostic}>POS route: {diagnostics.posRoute}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: '#344B36',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    color: '#F4F0E7',
    fontSize: 16,
    marginTop: 12,
  },
  diagnostic: {
    color: '#F4F0E7',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 16,
    textAlign: 'center',
  },
  unavailableTitle: {
    color: '#F4F0E7',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
});
