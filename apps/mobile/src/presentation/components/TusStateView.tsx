import { StyleSheet, Text, View } from 'react-native';
import { TusAccessibleButton } from './TusAccessibleButton';

export const TUS_MOBILE_STATE = {
  LOADING: 'loading',
  SUBMITTING: 'submitting',
  EMPTY: 'empty',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  DISABLED: 'disabled',
  ERROR: 'error',
} as const;

export type TusMobileState = (typeof TUS_MOBILE_STATE)[keyof typeof TUS_MOBILE_STATE];

export interface TusStateViewProps {
  status: TusMobileState;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export function TusStateView({ status, title, message, actionLabel, onAction, secondaryActionLabel, onSecondaryAction }: TusStateViewProps) {
  const isAlert = status === TUS_MOBILE_STATE.CONFLICT || status === TUS_MOBILE_STATE.ERROR;

  return (
    <View
      accessibilityLabel={`${title}: ${message}`}
      accessibilityLiveRegion={isAlert ? 'assertive' : 'polite'}
      accessibilityRole={isAlert ? 'alert' : undefined}
      accessibilityState={{ busy: status === TUS_MOBILE_STATE.LOADING || status === TUS_MOBILE_STATE.SUBMITTING }}
      style={styles.container}
    >
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel === undefined || onAction === undefined ? null : <TusAccessibleButton label={actionLabel} labelStyle={styles.actionLabel} onPress={onAction} style={styles.action} />}
      {secondaryActionLabel === undefined || onSecondaryAction === undefined ? null : <TusAccessibleButton label={secondaryActionLabel} labelStyle={styles.secondaryActionLabel} onPress={onSecondaryAction} style={styles.secondaryAction} />}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderColor: '#C96742',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  actionLabel: {
    color: '#C96742',
    fontSize: 14,
    fontWeight: '800',
  },
  container: {
    borderColor: '#C96742',
    borderLeftWidth: 3,
    paddingLeft: 16,
    paddingVertical: 8,
  },
  message: {
    color: '#344B36',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
  },
  secondaryAction: {
    borderColor: '#496451',
    marginTop: 8,
  },
  secondaryActionLabel: {
    color: '#496451',
    fontSize: 14,
    fontWeight: '800',
  },
  title: {
    color: '#17211B',
    fontSize: 15,
    fontWeight: '800',
  },
});
