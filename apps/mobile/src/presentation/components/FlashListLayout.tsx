import { FlashList, type FlashListProps } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';

export interface FlashListLayoutProps<TItem>
  extends Omit<FlashListProps<TItem>, 'ListEmptyComponent'> {
  isLoading?: boolean;
  skeletonCount?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  ListEmptyComponent?: FlashListProps<TItem>['ListEmptyComponent'];
}

interface PerformanceRow {
  id: string;
  title: string;
  metric: string;
}

const LARGE_LIST_DATA: readonly PerformanceRow[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: `row-${index}`,
  title: `High-throughput row ${index + 1}`,
  metric: `${Math.round((index / 10_000) * 100)}% viewport-safe`,
}));

export function FlashListLayout<TItem>({
  data,
  isLoading = false,
  skeletonCount = 8,
  emptyTitle = 'Nothing to show yet',
  emptyDescription = 'Data will appear here as soon as it is available.',
  ListEmptyComponent,
  ...props
}: FlashListLayoutProps<TItem>) {
  return (
    <FlashList
      {...props}
      data={isLoading ? [] : data}
      ListEmptyComponent={
        isLoading ? (
          <SkeletonRows count={skeletonCount} />
        ) : (
          ListEmptyComponent ?? <EmptyState title={emptyTitle} description={emptyDescription} />
        )
      }
    />
  );
}

export function LargeListPerformanceSample() {
  return (
    <View style={styles.sampleScreen}>
      <Text accessibilityRole="header" style={styles.sampleTitle}>
        FlashList zero-jank sample
      </Text>
      <Text style={styles.sampleSubtitle}>
        10,000 stable rows, URI-only assets, and no render-time allocation churn.
      </Text>
      <FlashListLayout
        data={LARGE_LIST_DATA}
        keyExtractor={keyPerformanceRow}
        renderItem={renderPerformanceRow}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

function renderPerformanceRow({ item }: { item: PerformanceRow }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowBadge} />
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowMetric}>{item.metric}</Text>
      </View>
    </View>
  );
}

function keyPerformanceRow(item: PerformanceRow): string {
  return item.id;
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <View accessibilityLabel="Loading list rows" style={styles.skeletonWrap}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonLines}>
            <View style={styles.skeletonLineWide} />
            <View style={styles.skeletonLineShort} />
          </View>
        </View>
      ))}
    </View>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyDescription: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  row: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    padding: 14,
  },
  rowBadge: {
    backgroundColor: '#38BDF8',
    borderRadius: 999,
    height: 42,
    width: 42,
  },
  rowContent: {
    flex: 1,
    marginLeft: 12,
  },
  rowMetric: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 4,
  },
  rowTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  sampleScreen: {
    backgroundColor: '#F8FAFC',
    flex: 1,
    padding: 16,
  },
  sampleSubtitle: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
    marginTop: 6,
  },
  sampleTitle: {
    color: '#020617',
    fontSize: 28,
    fontWeight: '900',
  },
  skeletonAvatar: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    height: 42,
    width: 42,
  },
  skeletonLineShort: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    height: 12,
    marginTop: 8,
    width: '48%',
  },
  skeletonLineWide: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    height: 14,
    width: '78%',
  },
  skeletonLines: {
    flex: 1,
    marginLeft: 12,
  },
  skeletonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: 10,
  },
  skeletonWrap: {
    padding: 16,
  },
});
