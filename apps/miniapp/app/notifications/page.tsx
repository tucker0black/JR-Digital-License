'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getCustomerNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api';
import type { CustomerNotification } from '@jr/shared';
import { StoreHeader } from '@/components/StoreHeader';
import { RowSkeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { useTranslation } from '@/lib/i18n';
import { formatRelative } from '@/lib/format';

const PAGE_SIZE = 20;

const DEFAULT_ICON_PATH =
  'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9';

const NOTIFICATION_ICON_PATHS: Record<string, string> = {
  ORDER_COMPLETED: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  ORDER_PAID: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  DELIVERY: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  REFUND: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6',
  WALLET_DEPOSIT:
    'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  WALLET_CREDIT:
    'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  SMM_STATUS: 'M13 10V3L4 14h7v7l9-11h-7z',
  SUPPORT_RESPONSE:
    'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'
};

// Design-token tones per notification type (presentation only)
const NOTIFICATION_ICON_TONES: Record<string, string> = {
  ORDER_COMPLETED: 'bg-success/10 text-success',
  ORDER_PAID: 'bg-success/10 text-success',
  DELIVERY: 'bg-success/10 text-success',
  REFUND: 'bg-warning/10 text-warning',
  WALLET_DEPOSIT: 'bg-primary/10 text-primary',
  WALLET_CREDIT: 'bg-primary/10 text-primary',
  SMM_STATUS: 'bg-violet/10 text-violet',
  SUPPORT_RESPONSE: 'bg-accent/10 text-accent'
};

function getNotificationIconTone(type: string): string {
  return NOTIFICATION_ICON_TONES[type] ?? 'bg-muted/60 text-soft';
}

export default function NotificationsPage() {
  const { status: telegramStatus } = useTelegramAuth();
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (pageToLoad: number) => {
      const append = pageToLoad > 1;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const result = await getCustomerNotifications({ page: pageToLoad, pageSize: PAGE_SIZE });
        // Append on "load more" so previously loaded pages stay visible.
        setNotifications((prev) => (append ? [...prev, ...result.notifications] : result.notifications));
        setTotal(result.total);
        setUnreadCount(result.unreadCount);
        setPage(pageToLoad);
        setError(null);
      } catch {
        // Keep any already-loaded items; surface an error message instead.
        setError(t('notifications.unableToLoad'));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    // Deliberately not keyed on t: switching language must not refetch data.
    []
  );

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    void fetchPage(1);
  }, [fetchPage, telegramStatus]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Keep existing state
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // Keep existing state
    }
  };

  const hasMore = notifications.length < total;

  return (
    <main className="min-h-screen bg-page bg-cosmic text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{t('notifications.title')}</h1>
            {unreadCount > 0 && (
              <p className="mt-1 text-sm text-soft">
                {t('notifications.unreadCount', { count: String(unreadCount) })}
              </p>
            )}
          </div>
          {!loading && unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void handleMarkAllAsRead()}
              className="shrink-0 rounded-xl border border-line/50 px-3 py-1.5 text-sm font-medium text-primary transition-default hover:bg-primary/10"
            >
              {t('notifications.markAllRead')}
            </button>
          )}
        </header>

        {telegramStatus !== 'ready' ? (
          <TelegramAuthNotice />
        ) : loading ? (
          <div className="space-y-3" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          error ? (
            <EmptyState
              title={t('notifications.unableToLoad')}
              description={error}
              action={<Button onClick={() => void fetchPage(1)}>{t('notifications.retry')}</Button>}
            />
          ) : (
            <EmptyState
              title={t('notifications.emptyTitle')}
              description={t('notifications.emptyDescription')}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8" aria-hidden="true">
                  <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              }
              action={<Button href="/store">{t('orders.browseStore')}</Button>}
            />
          )
        ) : (
          <>
            {error && (
              <div className="animate-fade-up mb-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                {error}
              </div>
            )}

            <ul className="space-y-2.5">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <article
                    className={`flex items-start gap-3 rounded-2xl border p-4 transition-luxury ${
                      notification.isRead
                        ? 'border-line/40 bg-card/60'
                        : 'border-primary/25 bg-card shadow-glow-sm'
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${getNotificationIconTone(notification.type)}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.8}
                          d={NOTIFICATION_ICON_PATHS[notification.type] ?? DEFAULT_ICON_PATH}
                        />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm leading-snug ${
                            notification.isRead ? 'font-medium text-soft' : 'font-semibold text-ink'
                          }`}
                        >
                          {!notification.isRead && (
                            <span className="mr-1.5 inline-block h-2 w-2 translate-y-[-1px] rounded-full bg-primary align-middle" />
                          )}
                          {notification.title}
                        </p>
                        <span className="shrink-0 text-xs text-muted-text/80">
                          {formatRelative(notification.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-soft">
                        {notification.message}
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        {notification.orderId && (
                          <Link
                            href={`/orders/${notification.orderId}`}
                            className="text-xs font-medium text-primary transition-default hover:text-primary-dark"
                          >
                            {t('notifications.viewOrder')}
                          </Link>
                        )}
                        {!notification.isRead && (
                          <button
                            type="button"
                            onClick={() => void handleMarkAsRead(notification.id)}
                            className="text-xs text-muted-text transition-default hover:text-soft"
                          >
                            {t('notifications.markRead')}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => void fetchPage(page + 1)}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-xl border border-line/50 px-5 py-2.5 text-sm font-medium text-primary transition-default hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore && (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                  )}
                  {loadingMore ? t('notifications.loadingMore') : t('notifications.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
