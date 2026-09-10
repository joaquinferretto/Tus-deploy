import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { createTusMobileAuthClient, type MobileAuthActionState } from '@application/tus-auth'
import { readMobileRuntimeConfig } from '@core/config/runtime-profile'
import { SecureCredentialStore } from '@core/services/secure-credential-store'

export default function RecoveryScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ token?: string | string[] }>()
  const tokenParam = Array.isArray(params.token) ? params.token[0] : params.token
  const [email, setEmail] = useState('')
  const [token, setToken] = useState(tokenParam ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<MobileAuthActionState | null>(null)

  async function submit(): Promise<void> {
    setSubmitting(true)
    setResult(null)
    try {
      const runtime = readMobileRuntimeConfig()
      const client = createTusMobileAuthClient({ runtime, credentials: new SecureCredentialStore({ runtime }) })
      const next = token.trim().length > 0
        ? await client.completeRecovery({ token: token.trim(), newPassword })
        : await client.requestRecovery(email.trim())
      setResult(next)
    } catch {
      setResult({ status: 'error', message: 'Recovery is unavailable. Try again or contact support.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" style={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>TUS / recovery</Text>
        <Text accessibilityRole="header" style={styles.title}>Recover access without guessing.</Text>
        <Text style={styles.body}>TUS confirms recovery server-side. This surface never chooses a tenant, role, permission, payment, or POS outcome.</Text>
        {token.trim().length === 0 ? <>
          <Text style={styles.label}>Account email</Text>
          <TextInput accessibilityLabel="Account email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} style={styles.input} value={email} />
        </> : <>
          <Text style={styles.label}>Recovery token</Text>
          <TextInput accessibilityLabel="Recovery token" autoCapitalize="none" onChangeText={setToken} style={styles.input} value={token} />
          <Text style={styles.label}>New password</Text>
          <TextInput accessibilityLabel="New password" secureTextEntry onChangeText={setNewPassword} style={styles.input} value={newPassword} />
        </>}
        {result === null ? null : <Text accessibilityLiveRegion={result.status === 'error' ? 'assertive' : 'polite'} accessibilityRole={result.status === 'error' ? 'alert' : undefined} style={result.status === 'error' ? styles.error : styles.success}>{result.message}</Text>}
        <Pressable accessibilityLabel={token.trim().length === 0 ? 'Request recovery email' : 'Complete account recovery'} accessibilityRole="button" accessibilityState={{ disabled: submitting }} disabled={submitting} onPress={() => void submit()} style={styles.button}>
          <Text style={styles.buttonText}>{submitting ? 'Contacting TUS…' : token.trim().length === 0 ? 'Request recovery email' : 'Complete recovery'}</Text>
        </Pressable>
        <Pressable accessibilityLabel="Return to sign in" accessibilityRole="button" onPress={() => router.replace('/(auth)/login')} style={styles.link}>
          <Text style={styles.linkText}>Return to sign in</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#F4F0E7', flex: 1 },
  content: { justifyContent: 'center', minHeight: '100%', padding: 24 },
  panel: { backgroundColor: '#FFFDF8', borderColor: '#C8BFAF', borderWidth: 1, padding: 24 },
  eyebrow: { color: '#B65035', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginBottom: 16, textTransform: 'uppercase' },
  title: { color: '#17211B', fontFamily: 'Georgia', fontSize: 32, lineHeight: 36, marginBottom: 18 },
  body: { color: '#344B36', fontFamily: 'Georgia', fontSize: 16, lineHeight: 24, marginBottom: 24 },
  label: { color: '#344B36', fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: 12, textTransform: 'uppercase' },
  input: { borderColor: '#C8BFAF', borderWidth: 1, color: '#17211B', fontSize: 16, minHeight: 50, marginTop: 8, paddingHorizontal: 14 },
  button: { alignItems: 'center', backgroundColor: '#B65035', justifyContent: 'center', marginTop: 22, minHeight: 50, paddingHorizontal: 18 },
  buttonText: { color: '#FFFDF8', fontSize: 13, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  link: { alignItems: 'center', minHeight: 48, justifyContent: 'center', marginTop: 10 },
  linkText: { color: '#344B36', fontSize: 14, fontWeight: '800' },
  error: { color: '#8E3027', fontSize: 14, lineHeight: 20, marginTop: 14 },
  success: { color: '#344B36', fontSize: 14, lineHeight: 20, marginTop: 14 },
})
