import Constants from 'expo-constants';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AUTH_STATUS, initializeAppStorePersistence, useAppStore } from '@/store';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AppBootstrap>
      <AuthGuard>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </AuthGuard>
    </AppBootstrap>
  );
}

interface LayoutChildrenProps {
  children: ReactNode;
}

function AppBootstrap({ children }: LayoutChildrenProps) {
  const storeReady = useAppStore((state) => state.hydration.storeReady);
  const markUnauthenticated = useAppStore((state) => state.markUnauthenticated);
  const setStoreReady = useAppStore((state) => state.setStoreReady);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapStore(): Promise<void> {
      try {
        await initializeAppStorePersistence({ profile: readRuntimeProfile() });
      } catch {
        if (!cancelled) {
          markUnauthenticated();
          setStoreReady(true);
        }
      }
    }

    void bootstrapStore();

    return () => {
      cancelled = true;
    };
  }, [markUnauthenticated, setStoreReady]);

  useEffect(() => {
    if (storeReady) {
      void SplashScreen.hideAsync();
    }
  }, [storeReady]);

  if (!storeReady) {
    return <BootFallback />;
  }

  return <>{children}</>;
}

function AuthGuard({ children }: LayoutChildrenProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const storeReady = useAppStore((state) => state.hydration.storeReady);
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    if (!storeReady || rootNavigationState?.key === undefined) {
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
  }, [authStatus, rootNavigationState?.key, router, segments, storeReady]);

  return <>{children}</>;
}

function BootFallback() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator accessibilityLabel="Preparing secure local storage" />
      <Text style={styles.message}>Preparing secure session</Text>
    </View>
  );
}

function readRuntimeProfile(): string {
  const runtime = Constants.expoConfig?.extra?.runtime;
  if (typeof runtime === 'object' && runtime !== null && 'profile' in runtime) {
    const profile = runtime.profile;
    if (typeof profile === 'string' && profile.length > 0) {
      return profile;
    }
  }

  return 'dev';
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    backgroundColor: '#0B1220',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    color: '#E5E7EB',
    fontSize: 16,
    marginTop: 12,
  },
});
