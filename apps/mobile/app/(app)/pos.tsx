import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { createPosOperationId, createStableIdempotencyKey, createTusMobileClient, createTusMobileFetchTransport, parseManualPosAmount, posFeedback, type ManualPosOperation, type MobilePosFeedback, type MobileQueueEnvelope, type MobileQueueQuarantineRecord, type OfflinePosStorage, type TusMobileClient } from '@application/tus-client';
import { readMobileRuntimeConfig, type MobileRuntimeConfig } from '@core/config/runtime-profile';
import { SecureCredentialStore } from '@core/services/secure-credential-store';
import { createEncryptedMMKVClient, type MMKVLocalStorageClient } from '@core/services/mmkv-storage';
import { posIntentActionLabel, useAppStore } from '@/store';
import { TusAccessibleButton, TusStateView } from '@presentation/components';
import { TUS_MOBILE_LAYOUT, resolveTusConnectivityPresentation } from '@presentation/layout/tus-responsive';
import { resolveMobilePosMode, resolveMobileRoleLabel } from '@presentation/journeys/tus-journeys';

type PosMode = 'product' | 'service';

export default function PosScreen() {
  const subjectId = useAppStore((state) => state.auth.subjectId);
  const tenantId = useAppStore((state) => state.auth.tenantId);
  const roles = useAppStore((state) => state.auth.roles);
  const networkOnline = useAppStore((state) => state.network.isOnline);
  const markPosIntent = useAppStore((state) => state.markPosIntent);
  const [mode, setMode] = useState<PosMode>('product');
  const [amountInput, setAmountInput] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<'loading' | 'missing' | 'ready'>('loading');
  const [storageStatus, setStorageStatus] = useState<'loading' | 'unavailable' | 'quarantined' | 'ready'>('loading');
  const [storageRetry, setStorageRetry] = useState(0);
  const [quarantineCount, setQuarantineCount] = useState(0);
  const [feedback, setFeedback] = useState<MobilePosFeedback | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [session, setSession] = useState<{ accessToken: string; tenantId: string; actorId: string; correlationId: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const onlineRef = useRef(true);
  const storageRef = useRef<MMKVLocalStorageClient | null>(null);
  const clientRef = useRef<TusMobileClient | null>(null);
  const lastOperationRef = useRef<ManualPosOperation | null>(null);
  const draftVersionRef = useRef(0);
  const lastIntentDraftRef = useRef<{ version: number; mode: PosMode; amount: number } | null>(null);
  const runtimeRef = useRef<MobileRuntimeConfig | null>(null);
  const wasOnlineRef = useRef(false);

  onlineRef.current = !offline && networkOnline;
  useEffect(() => {
    let cancelled = false;
    async function restoreSession(): Promise<void> {
      try {
        const runtime = readMobileRuntimeConfig();
        runtimeRef.current = runtime;
        const credentials = new SecureCredentialStore({ runtime });
        const accessToken = await credentials.getAccessToken();
        if (!cancelled && subjectId !== null && tenantId !== null && accessToken !== null && tenantId.trim().length > 0) {
          setSession({ accessToken, tenantId, actorId: subjectId, correlationId: `mobile-pos-${Date.now()}` });
          setCredentialStatus('ready');
          return;
        }
        if (!cancelled) setCredentialStatus('missing');
      } catch {
        if (!cancelled) setCredentialStatus('missing');
      }
    }
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [subjectId, tenantId]);

  useEffect(() => {
    let cancelled = false;
    async function restoreQueue(): Promise<void> {
      try {
        const runtime = runtimeRef.current ?? readMobileRuntimeConfig();
        runtimeRef.current = runtime;
        const storage = await createEncryptedMMKVClient({ runtime, namespace: 'tus-pos' });
        const queueStorage = createQueueStorage(storage);
        const client = createTusMobileClient(createTusMobileFetchTransport(runtime), {
          runtime,
          isOnline: () => onlineRef.current,
          storage: queueStorage,
          ...(tenantId === null ? {} : { tenantId }),
        });
        clientRef.current = client;
        if (!cancelled) {
          storageRef.current = storage;
          setPendingCount(client.pendingOperations().length);
          setQuarantineCount(client.quarantinedOperations().length);
          setStorageStatus(client.quarantinedOperations().length > 0 ? 'quarantined' : 'ready');
        }
      } catch {
        if (!cancelled) setStorageStatus('unavailable');
      }
    }
    void restoreQueue();
    return () => {
      cancelled = true;
      clientRef.current = null;
      storageRef.current = null;
    };
  }, [storageRetry, tenantId]);

  function clearQuarantinedOperations(): void {
    try {
      if (clientRef.current?.clearQuarantinedOperations() !== true) {
        setFeedback(posFeedback({ status: 'error', operationId: 'quarantine', reason: 'storage_unavailable' }));
        return;
      }
      setQuarantineCount(0);
      setStorageStatus('ready');
    } catch (error) {
      setFeedback(posFeedback({ status: 'error', operationId: 'quarantine', reason: error instanceof Error ? error.message : 'storage_unavailable' }));
    }
  }

  function updateAmount(value: string): void {
    draftVersionRef.current += 1;
    setAmountInput(value);
    if (amountError !== null) setAmountError(null);
  }

  function updateMode(nextMode: PosMode): void {
    if (nextMode === mode) return;
    draftVersionRef.current += 1;
    setMode(nextMode);
  }

  function applyFeedback(result: { status: string; operationId: string; reason?: string }): void {
    const nextFeedback = posFeedback(result);
    setFeedback(nextFeedback);
    markPosIntent({ status: result.status, operationId: result.operationId, message: `${nextFeedback.message} ${nextFeedback.evidence}`, action: nextFeedback.action });
  }

  async function recordManualOperation(): Promise<void> {
    if (session === null || clientRef.current === null) return;
    const parsedAmount = parseManualPosAmount(amountInput);
    if (parsedAmount.error !== null || parsedAmount.amount === null) {
      setAmountError(parsedAmount.error ?? 'Enter a valid ARS amount.');
      return;
    }
    setSubmitting(true);
    const previousDraft = lastIntentDraftRef.current;
    const canReuseIntent = previousDraft?.version === draftVersionRef.current && previousDraft.mode === mode && previousDraft.amount === parsedAmount.amount && lastOperationRef.current !== null;
    const operation = canReuseIntent ? lastOperationRef.current : createNewOperation(session, mode, parsedAmount.amount);
    if (operation === null) return;
    lastOperationRef.current = operation;
    lastIntentDraftRef.current = { version: draftVersionRef.current, mode, amount: parsedAmount.amount };
    markPosIntent({ status: 'submitting', operationId: operation.operationId, message: 'Submitting this operation to TUS. No success is claimed yet.', action: 'none' });
    try {
      const result = await clientRef.current.recordManualOperation(operation);
      applyFeedback(result);
      setPendingCount(clientRef.current.pendingOperations().length);
    } catch (error) {
      applyFeedback({ status: 'error', operationId: operation.operationId, reason: error instanceof Error ? error.message : 'storage_unavailable' });
    } finally {
      setSubmitting(false);
    }
  }

  async function retryLastOperation(): Promise<void> {
    if (clientRef.current === null || lastOperationRef.current === null) return;
    setSubmitting(true);
    try {
      const result = await clientRef.current.recordManualOperation(lastOperationRef.current);
      applyFeedback(result);
      setPendingCount(clientRef.current.pendingOperations().length);
    } catch (error) {
      applyFeedback({ status: 'error', operationId: lastOperationRef.current.operationId, reason: error instanceof Error ? error.message : 'retry_unavailable' });
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveLastConflict(): Promise<void> {
    if (clientRef.current === null || feedback === null) return;
    try {
      const result = await clientRef.current.resolveConflict(feedback.operationId, 'discard');
      if (result.status === 'discarded') {
        const resolved = { status: 'error' as const, operationId: result.operationId, reason: 'conflict_discarded_locally' };
        applyFeedback(resolved);
        setFeedback((current) => current === null ? null : { ...current, message: 'Conflict discarded locally. No server success is claimed.', action: 'refresh' });
        setPendingCount(clientRef.current.pendingOperations().length);
        return;
      }
      if (result.status === 'not-found') {
        applyFeedback({ status: 'error', operationId: result.operationId, reason: 'preserved_operation_not_found' });
        return;
      }
      applyFeedback(result);
    } catch (error) {
      applyFeedback({ status: 'error', operationId: feedback.operationId, reason: error instanceof Error ? error.message : 'storage_unavailable' });
    }
  }

  async function syncPending(): Promise<void> {
    if (clientRef.current === null || !onlineRef.current) return;
    setSyncing(true);
    try {
      const pending = clientRef.current.pendingOperations();
      if (lastOperationRef.current === null && pending.length > 0) lastOperationRef.current = pending[pending.length - 1] ?? null;
      const results = await clientRef.current.syncPendingOperations();
      const last = results.at(-1);
      if (last !== undefined) applyFeedback(last);
      setPendingCount(clientRef.current.pendingOperations().length);
    } catch (error) {
      applyFeedback({ status: 'error', operationId: 'pending-sync', reason: error instanceof Error ? error.message : 'sync_unavailable' });
    } finally {
      setSyncing(false);
    }
  }

  const canCapture = credentialStatus === 'ready' && storageStatus === 'ready' && session !== null && clientRef.current !== null;
  const isOnline = onlineRef.current;
  const connectivity = resolveTusConnectivityPresentation({ isOnline, pendingCount });
  const modePresentation = resolveMobilePosMode(mode);

  useEffect(() => {
    const becameOnline = !wasOnlineRef.current && isOnline;
    wasOnlineRef.current = isOnline;
    if ((becameOnline || storageStatus === 'ready') && isOnline && clientRef.current?.pendingOperations().length) {
      void syncPending();
    }
  }, [isOnline, storageStatus]);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" style={styles.container}>
      <View style={styles.header}><Text style={styles.eyebrow}>{resolveMobileRoleLabel(roles)} / POS</Text><Text accessibilityLabel={connectivity.message} style={styles.syncLabel}>{connectivity.label}</Text></View>
      <Text accessibilityRole="header" style={styles.title}>Keep the counter moving.</Text>
      <Text style={styles.body}>Product sales and service captures remain separate. Offline and uncertain operations stay pending until TUS acknowledges them.</Text>
      <View accessibilityLiveRegion="polite" style={[styles.connectivity, connectivity.status === 'offline' ? styles.connectivityOffline : undefined]}><Text style={styles.connectivityLabel}>{connectivity.label}</Text><Text style={styles.connectivityMessage}>{connectivity.message}</Text></View>
      <View style={styles.modeCard}>
        <Text style={styles.cardLabel}>Capture context · {modePresentation.label}</Text>
         <View accessibilityLabel="Capture context" accessibilityRole="radiogroup" style={styles.modeRow}><ModeButton label="Product" active={mode === 'product'} onPress={() => updateMode('product')} /><ModeButton label="Service" active={mode === 'service'} onPress={() => updateMode('service')} /></View>
        <Text style={styles.modeDescription}>{modePresentation.description}</Text>
        <Pressable accessibilityLabel={offline ? 'Return online' : 'Simulate offline mode'} accessibilityRole="switch" accessibilityState={{ checked: offline }} style={styles.toggle} onPress={() => setOffline((value) => !value)}><Text style={styles.toggleText}>{offline ? 'Return online' : 'Simulate offline mode'}</Text></Pressable>
      </View>
      {credentialStatus === 'loading' ? <TusStateView message="Restoring secure session…" status="loading" title="Loading" /> : null}
      {credentialStatus === 'missing' ? <TusStateView message="Reauthentication and a tenant-scoped session are required before capture." status="disabled" title="POS capture disabled" /> : null}
      {storageStatus === 'unavailable' ? <TusStateView actionLabel="Retry encrypted storage" message="Encrypted offline storage is unavailable, so this operation cannot be preserved safely." onAction={() => { setStorageStatus('loading'); setStorageRetry((value) => value + 1); }} status="error" title="POS capture unavailable" /> : null}
      {storageStatus === 'quarantined' ? <TusStateView message={`${quarantineCount} legacy or cross-profile queue record(s) were quarantined and will not be replayed.`} status="error" title="Review quarantined queue data" /> : null}
      {quarantineCount > 0 ? <TusAccessibleButton label="Clear quarantined records" onPress={clearQuarantinedOperations} style={styles.feedbackButton} /> : null}
      <View style={styles.amountField}>
        <Text style={styles.fieldLabel}>Amount · ARS</Text>
        <TextInput
          accessibilityHint={amountError ?? 'Enter a product or service amount in Argentine pesos.'}
          accessibilityLabel="Amount in Argentine pesos"
          keyboardType="decimal-pad"
          onBlur={() => setAmountError(parseManualPosAmount(amountInput).error)}
          onChangeText={updateAmount}
          placeholder="0.00"
          placeholderTextColor="#6D8874"
          style={styles.amountInput}
          value={amountInput}
        />
        {amountError === null ? null : <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.fieldError}>{amountError}</Text>}
      </View>
      <TusAccessibleButton disabled={!canCapture || syncing} label="Record manual operation" loading={submitting} onPress={() => void recordManualOperation()} style={styles.primaryButton} />
      <View style={styles.queueRow}><Text style={styles.queueLabel}>Pending local operations</Text><Text style={styles.queueCount}>{pendingCount}</Text></View>
      {pendingCount > 0 ? <TusAccessibleButton disabled={!isOnline} label={isOnline ? 'Sync pending operations' : 'Sync unavailable offline'} loading={syncing} loadingLabel="Syncing pending operations…" onPress={() => void syncPending()} style={styles.secondaryButton} /> : null}
       {feedback === null ? <Text style={styles.status}>No local success state is shown. The next state comes from the server or remains pending.</Text> : <FeedbackView feedback={feedback} onRetry={() => void retryLastOperation()} onResolve={() => void resolveLastConflict()} />}
      <Text style={styles.policy}>Provider capture: not claimed · Settlement: not claimed · Conflict policy: preserve and review</Text>
    </ScrollView>
  );
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="radio" accessibilityState={{ selected: active }} style={[styles.modeButton, active ? styles.modeButtonActive : undefined]} onPress={onPress}><Text style={styles.modeButtonText}>{label}</Text></Pressable>;
}

function createNewOperation(session: { accessToken: string; tenantId: string; actorId: string; correlationId: string }, mode: PosMode, amount: number): ManualPosOperation {
  const operationId = createPosOperationId();
  return {
    ...session,
    operationId,
    idempotencyKey: createStableIdempotencyKey('pos', operationId),
    kind: mode === 'product' ? 'manual-sale' : 'manual-service',
    context: mode,
    amount,
    currency: 'ARS',
    deviceId: 'mobile-pos',
    shiftId: 'mobile-shift',
    schemaVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    accessToken: session.accessToken,
  };
}

function FeedbackView({ feedback, onRetry, onResolve }: { feedback: MobilePosFeedback; onRetry: () => void; onResolve: () => void }) {
  const isAlert = feedback.status === 'conflict' || feedback.status === 'error';
  const actionLabel = feedback.action === 'resolve' ? 'Discard preserved conflict' : posIntentActionLabel(feedback.action);
  if (feedback.status === 'conflict') return <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.feedback}><Text style={styles.feedbackTitle}>{feedback.message}</Text><Text style={styles.feedbackBody}>{feedback.evidence}</Text><Text style={styles.feedbackMeta}>Operation: {feedback.operationId}</Text><TusAccessibleButton label="Retry preserved operation" onPress={onRetry} style={styles.feedbackButton} /><TusAccessibleButton label="Discard preserved conflict" onPress={onResolve} style={styles.feedbackButton} /></View>;
  return <View accessibilityLiveRegion={isAlert ? 'assertive' : 'polite'} accessibilityRole={isAlert ? 'alert' : undefined} style={styles.feedback}><Text style={styles.feedbackTitle}>{feedback.message}</Text><Text style={styles.feedbackBody}>{feedback.evidence}</Text><Text style={styles.feedbackMeta}>Operation: {feedback.operationId}</Text><TusAccessibleButton disabled={!feedback.retryable && feedback.action !== 'refresh'} label={actionLabel} onPress={onRetry} style={styles.feedbackButton} /></View>;
}

function createQueueStorage(storage: MMKVLocalStorageClient): OfflinePosStorage {
  const read = (key: string): unknown => {
    const value = storage.getString(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  };

  return {
    load: () => read('pending-operations'),
    save: (envelope: MobileQueueEnvelope) => {
      storage.setString('pending-operations', JSON.stringify(envelope));
    },
    quarantine: (entry: MobileQueueQuarantineRecord) => {
      const existing = read('quarantined-operations');
      const entries = Array.isArray(existing) ? existing.filter(isQuarantineRecord) : [];
      storage.setString('quarantined-operations', JSON.stringify([...entries, entry]));
    },
    loadQuarantine: () => {
      const existing = read('quarantined-operations');
      return Array.isArray(existing) ? existing.filter(isQuarantineRecord) : [];
    },
    clearQuarantine: () => {
      storage.removeItem('quarantined-operations');
    },
  };
}

function isQuarantineRecord(value: unknown): value is MobileQueueQuarantineRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['profile'] === 'string' && typeof record['reason'] === 'string' && 'data' in record;
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#14251D', flex: 1 },
  content: { padding: TUS_MOBILE_LAYOUT.contentPadding, paddingBottom: TUS_MOBILE_LAYOUT.contentBottomPadding },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 56 },
  eyebrow: { color: '#E8B38E', fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  syncLabel: { borderColor: '#A7C6A5', borderRadius: 99, borderWidth: 1, color: '#A7C6A5', fontSize: 12, paddingHorizontal: 10, paddingVertical: 5 },
  title: { color: '#F4F0E7', fontFamily: 'Georgia', fontSize: 42, lineHeight: 46, marginBottom: 14 },
  body: { color: '#C7D4C5', fontSize: 16, lineHeight: 24, marginBottom: 34 },
  modeCard: { backgroundColor: '#A7C6A5', borderRadius: 18, padding: 20 },
  amountField: { marginTop: 20 },
  amountInput: { backgroundColor: '#F4F0E7', borderRadius: 12, color: '#17211B', fontSize: 22, minHeight: 56, paddingHorizontal: 16 },
  cardLabel: { color: '#344B36', fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  modeButton: { alignItems: 'center', borderColor: '#344B36', borderRadius: 99, borderWidth: 1, justifyContent: 'center', minHeight: TUS_MOBILE_LAYOUT.minimumTouchTarget, minWidth: 104, paddingHorizontal: 16 },
  modeButtonActive: { backgroundColor: '#344B36' },
  modeButtonText: { color: '#F4F0E7', fontSize: 13, fontWeight: '700' },
  modeDescription: { color: '#344B36', fontSize: 13, lineHeight: 19, marginTop: 14 },
  toggle: { alignItems: 'center', alignSelf: 'flex-start', borderColor: '#344B36', borderRadius: 99, borderWidth: 1, justifyContent: 'center', marginTop: 20, minHeight: TUS_MOBILE_LAYOUT.minimumTouchTarget, paddingHorizontal: 13 },
  toggleText: { color: '#344B36', fontSize: 13, fontWeight: '700' },
  primaryButton: { backgroundColor: '#C96742', borderRadius: 99, marginTop: 18, minHeight: 52, width: '100%' },
  primaryButtonText: { color: '#FFF7ED', fontSize: 15, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', borderColor: '#A7C6A5', borderRadius: 99, borderWidth: 1, marginTop: 14, paddingVertical: 12 },
  secondaryButtonText: { color: '#A7C6A5', fontSize: 13, fontWeight: '700' },
  queueRow: { alignItems: 'center', borderBottomColor: '#496451', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 42, paddingBottom: 14 },
  queueLabel: { color: '#C7D4C5', fontSize: 14 },
  queueCount: { color: '#E8B38E', fontFamily: 'Georgia', fontSize: 26 },
  status: { color: '#F4F0E7', fontSize: 13, lineHeight: 20, marginTop: 18 },
  feedback: { borderLeftColor: '#E8B38E', borderLeftWidth: 3, gap: 8, marginTop: 18, paddingLeft: 14 },
  feedbackTitle: { color: '#F4F0E7', fontSize: 14, fontWeight: '800', lineHeight: 20 },
  feedbackBody: { color: '#C7D4C5', fontSize: 13, lineHeight: 20 },
  feedbackMeta: { color: '#8CA891', fontSize: 11 },
  feedbackButton: { alignSelf: 'flex-start', borderColor: '#E8B38E', borderRadius: 999, borderWidth: 1, marginTop: 6, minHeight: TUS_MOBILE_LAYOUT.minimumTouchTarget, paddingHorizontal: 14 },
  fieldError: { color: '#F2B49B', fontSize: 13, lineHeight: 19, marginTop: 7 },
  fieldLabel: { color: '#C7D4C5', fontSize: 13, fontWeight: '800', marginBottom: 8 },
  policy: { color: '#8CA891', fontSize: 12, lineHeight: 18, marginTop: 14 },
  connectivity: { backgroundColor: '#E8F0E2', borderLeftColor: '#A7C6A5', borderLeftWidth: 3, marginBottom: 18, padding: 14 },
  connectivityOffline: { backgroundColor: '#F2DDCF', borderLeftColor: '#C96742' },
  connectivityLabel: { color: '#344B36', fontSize: 13, fontWeight: '800' },
  connectivityMessage: { color: '#344B36', fontSize: 12, lineHeight: 18, marginTop: 4 },
});
