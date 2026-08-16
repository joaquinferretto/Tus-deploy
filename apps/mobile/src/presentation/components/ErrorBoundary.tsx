import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { LoggerService, SafeLogValue } from '@core/domain';

export interface ErrorBoundaryProps {
  children: ReactNode;
  logger?: LoggerService;
  name?: string;
  resetKeys?: readonly unknown[];
  onRetry?: () => void;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  detailsVisible: boolean;
  componentStack: string;
  crashId: string;
}

const INITIAL_STATE: ErrorBoundaryState = {
  error: null,
  detailsVisible: false,
  componentStack: '',
  crashId: '',
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      error,
      crashId: createCrashId(),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const boundaryName = this.props.name ?? 'global';
    const componentStack = info.componentStack ?? '';

    this.setState({ componentStack });
    this.props.logger?.captureException(error, {
      tags: {
        boundary: boundaryName,
        crashId: this.state.crashId,
      },
      extra: {
        componentStack,
        message: error.message,
        name: error.name,
      },
    });
    this.props.logger?.addBreadcrumb({
      category: 'ui.error-boundary',
      message: `${boundaryName} rendered fallback`,
      level: 'error',
      data: { crashId: this.state.crashId },
    });
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (this.state.error === null) return;
    if (resetKeysChanged(previousProps.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }

    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.eyebrow}>
            Recoverable crash
          </Text>
          <Text style={styles.title}>Something went wrong.</Text>
          <Text style={styles.message}>
            This screen stopped rendering safely. Retry to remount this surface, or open details for
            a redacted crash report.
          </Text>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={this.reset} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={this.showDetails}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Crash details</Text>
            </Pressable>
          </View>

          <Text style={styles.crashId}>Crash ID: {this.state.crashId}</Text>
        </View>

        <Modal
          animationType="slide"
          onRequestClose={this.hideDetails}
          presentationStyle="pageSheet"
          visible={this.state.detailsVisible}
        >
          <View style={styles.modalScreen}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              Crash details
            </Text>
            <ScrollView contentContainerStyle={styles.detailBody}>
              <Text selectable style={styles.detailText}>
                {formatCrashDetails(this.state)}
              </Text>
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={this.hideDetails} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Close details</Text>
            </Pressable>
          </View>
        </Modal>
      </View>
    );
  }

  private reset = (): void => {
    this.props.onRetry?.();
    this.setState(INITIAL_STATE);
  };

  private showDetails = (): void => {
    this.setState({ detailsVisible: true });
  };

  private hideDetails = (): void => {
    this.setState({ detailsVisible: false });
  };
}

function resetKeysChanged(
  previousKeys: readonly unknown[] | undefined,
  nextKeys: readonly unknown[] | undefined,
): boolean {
  if (previousKeys === nextKeys) return false;
  if (previousKeys === undefined || nextKeys === undefined) return true;
  if (previousKeys.length !== nextKeys.length) return true;
  return previousKeys.some((key, index) => !Object.is(key, nextKeys[index]));
}

function createCrashId(): string {
  return `crash_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatCrashDetails(state: ErrorBoundaryState): string {
  const error = state.error;
  if (error === null) return 'No crash details available.';

  const detail: Record<string, SafeLogValue> = {
    crashId: state.crashId,
    name: error.name,
    message: error.message,
    stack: error.stack ?? 'unavailable',
    componentStack: state.componentStack || 'unavailable',
  };

  return JSON.stringify(detail, null, 2);
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 24,
  },
  card: {
    backgroundColor: '#111827',
    borderColor: '#374151',
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
  },
  crashId: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 16,
  },
  detailBody: {
    paddingBottom: 24,
  },
  detailText: {
    color: '#D1D5DB',
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 18,
  },
  eyebrow: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  message: {
    color: '#CBD5E1',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  modalScreen: {
    backgroundColor: '#020617',
    flex: 1,
    padding: 24,
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 18,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#38BDF8',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#082F49',
    fontSize: 14,
    fontWeight: '800',
  },
  screen: {
    backgroundColor: '#020617',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#475569',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 30,
    fontWeight: '800',
    marginTop: 8,
  },
});
