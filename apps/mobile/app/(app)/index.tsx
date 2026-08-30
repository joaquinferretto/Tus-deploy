import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { clearPersistedAppState, useAppStore } from '@/store';
import { createTusMobileAuthClient } from '@application/tus-auth';
import { SecureCredentialStore } from '@core/services/secure-credential-store';
import { readMobileRuntimeConfig } from '@core/config/runtime-profile';
import { resolveMobileJourneyLinks, resolveMobileRoleLabel } from '@presentation/journeys/tus-journeys';

export default function ProtectedHomeScreen() {
  const subjectId = useAppStore((state) => state.auth.subjectId);
  const tenantId = useAppStore((state) => state.auth.tenantId);
  const sessionId = useAppStore((state) => state.auth.sessionId);
  const roles = useAppStore((state) => state.auth.roles);
  const permissions = useAppStore((state) => state.auth.permissions);
  const router = useRouter();
  const journeys = resolveMobileJourneyLinks({ roles, permissions });
  const roleLabel = resolveMobileRoleLabel(roles);

  async function signOut(): Promise<void> {
    const runtime = readMobileRuntimeConfig();
    await createTusMobileAuthClient({ runtime, credentials: new SecureCredentialStore({ runtime }) }).signOut();
    await clearPersistedAppState();
    router.replace('/(auth)/login');
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.container}>
      <Text style={styles.eyebrow}>{roleLabel} / TUS</Text>
      <Text accessibilityRole="header" style={styles.title}>The work after “buy”.</Text>
      <Text style={styles.body}>
        AuthGuard allows this route only after the auth store marks a non-secret authenticated session. Staff surfaces consume server contracts; local state never claims settlement or completion.
      </Text>
      <Text style={styles.meta}>Confirmed tenant: {tenantId ?? 'unavailable'} · actor: {subjectId ?? 'unavailable'}</Text>
      <Text style={styles.meta}>Session: {sessionId ?? 'unavailable'}</Text>
      <View accessibilityLabel="Staff operations summary" style={styles.surfaceCard}>
        <Text style={styles.surfaceTitle}>Staff operations</Text>
        <Text style={styles.surfaceBody}>POS captures keep product and service contexts separate, preserve offline conflicts, and wait for TUS acknowledgement.</Text>
      </View>
      {journeys.map((journey) => journey.key === 'pos' ? <Pressable accessibilityLabel={journey.allowed ? 'Open staff POS' : 'Staff POS unavailable for this scope'} accessibilityRole="button" accessibilityState={{ disabled: !journey.allowed }} disabled={!journey.allowed} key={journey.key} style={[styles.posButton, !journey.allowed ? styles.disabledButton : undefined]} onPress={() => router.push('/pos')}>
        <Text style={styles.buttonText}>{journey.allowed ? 'Open staff POS' : 'Staff POS unavailable'}</Text>
      </Pressable> : null)}
      <Pressable accessibilityLabel="Clear local session state" accessibilityRole="button" style={styles.button} onPress={() => void clearPersistedAppState()}>
        <Text style={styles.buttonText}>Clear local session state</Text>
      </Pressable>
      <Pressable accessibilityLabel="Sign out of TUS" accessibilityRole="button" style={styles.button} onPress={() => void signOut()}>
        <Text style={styles.buttonText}>Sign out of TUS</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F4F0E7',
    flex: 1,
  },
  content: {
    justifyContent: 'center',
    minHeight: '100%',
    padding: 20,
  },
  eyebrow: {
    color: '#B65035',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  title: {
    color: '#17211B',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 12,
  },
  body: {
    color: '#344B36',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  meta: {
    color: '#66705F',
    fontSize: 14,
    marginBottom: 24,
  },
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#344B36',
    borderRadius: 999,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  posButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#B65035',
    borderRadius: 999,
    marginBottom: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  disabledButton: {
    backgroundColor: '#66705F',
  },
  surfaceCard: {
    backgroundColor: '#DCE8D6',
    borderColor: '#A7C6A5',
    borderWidth: 1,
    marginBottom: 12,
    padding: 18,
  },
  surfaceTitle: {
    color: '#17211B',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  surfaceBody: {
    color: '#344B36',
    fontSize: 14,
    lineHeight: 21,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
