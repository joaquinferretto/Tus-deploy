import { Pressable, StyleSheet, Text, View } from 'react-native';

import { clearPersistedAppState, useAppStore } from '@/store';

export default function ProtectedHomeScreen() {
  const subjectId = useAppStore((state) => state.auth.subjectId);

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Protected area</Text>
      <Text style={styles.title}>Alqui app shell</Text>
      <Text style={styles.body}>
        AuthGuard allows this route only after the auth store marks a non-secret authenticated session.
      </Text>
      <Text style={styles.meta}>Subject: {subjectId ?? 'pending auth wiring'}</Text>
      <Pressable style={styles.button} onPress={() => void clearPersistedAppState()}>
        <Text style={styles.buttonText}>Clear local session state</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F8FAFC',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  eyebrow: {
    color: '#0369A1',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  title: {
    color: '#0F172A',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 12,
  },
  body: {
    color: '#334155',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  meta: {
    color: '#475569',
    fontSize: 14,
    marginBottom: 24,
  },
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
