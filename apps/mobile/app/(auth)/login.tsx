import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { createTusMobileAuthClient, sanitizeTusReturnTo } from '@application/tus-auth';
import { SecureCredentialStore } from '@core/services/secure-credential-store';
import { readMobileRuntimeConfig } from '@core/config/runtime-profile';
import { AUTH_STATUS, useAppStore } from '@/store';

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const markAuthenticated = useAppStore((state) => state.markAuthenticated);
  const authStatus = useAppStore((state) => state.auth.status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialMessage(authStatus));
  const returnTo = sanitizeTusReturnTo(Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    const runtime = readMobileRuntimeConfig();
    const client = createTusMobileAuthClient({ runtime, credentials: new SecureCredentialStore({ runtime }) });
    const result = await client.signIn({ email, password });
    if (result.status !== 'authenticated' || result.session === undefined) {
      setError(result.message);
      setSubmitting(false);
      return;
    }

    markAuthenticated(result.session);
    router.replace(returnTo as never);
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" style={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>TUS / secure entry</Text>
        <Text accessibilityRole="header" style={styles.title}>Return to the work{`\n`}with the facts intact.</Text>
        <Text style={styles.body}>TUS confirms your identity and tenant scope with the server before opening protected work.</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Email address</Text>
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#718096"
            style={styles.input}
            textContentType="username"
            value={email}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="password"
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor="#718096"
            secureTextEntry
            style={styles.input}
            textContentType="password"
            value={password}
          />
          {error === null ? null : <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting }} disabled={submitting} onPress={() => void submit()} style={styles.button}>
            <Text style={styles.buttonText}>{submitting ? 'Verifying with TUS…' : 'Sign in securely'}</Text>
          </Pressable>
          <Pressable accessibilityLabel="Recover account access" accessibilityRole="button" onPress={() => router.push('/(auth)/recovery')} style={styles.recoveryButton}>
            <Text style={styles.recoveryText}>Recover account access</Text>
          </Pressable>
        </View>
        <Text style={styles.note}>No tenant, actor, permission, or financial authority is entered on this screen.</Text>
      </View>
    </ScrollView>
  );
}

function initialMessage(status: string): string | null {
  if (status === AUTH_STATUS.EXPIRED) return 'Your TUS session expired. Sign in again.';
  if (status === AUTH_STATUS.UNAVAILABLE) return 'Secure session recovery is unavailable. Sign in again when storage is ready.';
  return null;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F4F0E7',
    flex: 1,
  },
  content: {
    justifyContent: 'center',
    minHeight: '100%',
    padding: 24,
  },
  panel: {
    backgroundColor: '#FFFDF8',
    borderColor: '#C8BFAF',
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: '#B65035',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  title: {
    color: '#17211B',
    fontFamily: 'Georgia',
    fontSize: 34,
    lineHeight: 36,
    marginBottom: 18,
  },
  body: {
    color: '#344B36',
    fontFamily: 'Georgia',
    fontSize: 16,
    lineHeight: 24,
  },
  form: {
    gap: 10,
    marginTop: 26,
  },
  label: {
    color: '#344B36',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  input: {
    borderColor: '#C8BFAF',
    borderWidth: 1,
    color: '#17211B',
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  error: {
    color: '#8E3027',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#B65035',
    minHeight: 50,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 18,
  },
  buttonText: {
    color: '#FFFDF8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  note: {
    color: '#66705F',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 20,
  },
  recoveryButton: {
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 4,
  },
  recoveryText: {
    color: '#344B36',
    fontSize: 14,
    fontWeight: '800',
  },
});
