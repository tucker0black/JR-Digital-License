'use client';

import { useCallback, useEffect, useState } from 'react';
import { getOrders } from '@/lib/api';
import type { Order } from '@/lib/api';
import { OrderCard } from '@/components/OrderCard';
import { StoreHeader } from '@/components/StoreHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { RowSkeleton } from '@/components/Skeleton';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { useTranslation } from '@/lib/i18n';

const PAGE_SIZE = 20;

// Display-only grouping for the filter tabs. Order status logic is unchanged.
const STATUS_GROUPS: Record<string, string[]> = {
  pending: ['DRAFT', 'PENDING', 'PAYMENT_PENDING'],
  processing: ['PAID', 'PROCESSING', 'FULFILLING'],
  completed: ['COMPLETED']
};

type StatusFilter = keyof typeof STATUS_GROUPS | 'all';

export default function OrdersPage() {
  const { status: telegramStatus } = useTelegramAuth();
  const { t } = useTranslation();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async (pageToLoad: number) => {
    const append = pageToLoad > 1;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const result = await getOrders({ page: pageToLoad, pageSize: PAGE_SIZE });
      setOrders((prev) => (append ? [...prev, ...result.orders] : result.orders));
      setTotal(result.total);
      setPage(pageToLoad);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('orders.unableToLoad'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
    // Deliberately not keyed on t: switching language must not refetch data.
  }, []);

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    void loadOrders(1);
  }, [loadOrders, telegramStatus]);

  // Client-side display filtering of already-loaded orders only.
  const visibleOrders =
    statusFilter === 'all'
      ? orders
      : orders.filter((order) => STATUS_GROUPS[statusFilter]?.includes(order.status));

  const FILTER_TABS: Array<{ key: StatusFilter; label: string }> = [
    { key: 'all', label: t('orders.filterAll') },
    { key: 'pending', label: t('orders.filterPending') },
    { key: 'processing', label: t('orders.filterProcessing') },
    { key: 'completed', label: t('orders.filterCompleted') }
  ];

  const hasMore = orders.length < total;

  return (
    <main className="min-h-screen bg-page bg-cosmic text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        <header className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{t('orders.title')}</h1>
          {!loading && !error && (
            <p className="mt-1 text-sm text-soft">
              {total === 1
                ? t('orders.orderTotal', { total: String(total) })
                : t('orders.orderTotalPlural', { total: String(total) })}
            </p>
          )}
        </header>

        {telegramStatus !== 'ready' ? (
          <TelegramAuthNotice />
        ) : loading ? (
          <div className="space-y-2.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : error && orders.length === 0 ? (
          <EmptyState
            title={t('orders.unableToLoad')}
            description={error}
            action={<Button href="/">{t('store.backToHome')}</Button>}
          />
        ) : orders.length === 0 ? (
          <EmptyState
            title={t('orders.noOrders')}
            description={t('orders.noOrdersDescription')}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M8 8h8M8 12h8M8 16h5" />
              </svg>
            }
            action={<Button href="/store">{t('orders.browseStore')}</Button>}
          />
        ) : (
          <>
            {/* Status filter tabs — display-only grouping */}
            <div
              className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
              role="tablist"
              aria-label={t('orders.title')}
            >
              {FILTER_TABS.map((tab) => {
                const active = statusFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setStatusFilter(tab.key)}
                    className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition-default ${
                      active
                        ? 'bg-primary/10 text-primary shadow-glow-sm'
                        : 'text-soft hover:bg-muted/60 hover:text-ink'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {visibleOrders.length === 0 ? (
              <EmptyState
                title={t('orders.filteredEmptyTitle')}
                description={t('orders.filteredEmptyDescription')}
              />
            ) : (
              <div className="space-y-2.5">
                {visibleOrders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}
              </div>
            )}

            {hasMore && !error && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadOrders(page + 1)}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-xl border border-line/50 px-5 py-2.5 text-sm font-medium text-primary transition-default hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore && (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                  )}
                  {loadingMore ? t('orders.loadingMore') : t('orders.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
