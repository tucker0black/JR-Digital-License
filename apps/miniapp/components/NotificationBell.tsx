'use client';

import { useEffect, useState, useCallback } from 'react';
import { getUnreadNotificationCount } from '@/lib/api';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { useTelegramAuth } from '@/components/TelegramProvider';

export function NotificationBell() {
  const { t } = useTranslation();
  const { status: telegramStatus } = useTelegramAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const result = await getUnreadNotificationCount();
      setUnreadCount(result.unreadCount);
    } catch {
      // Keep last known count
    }
  }, []);

  useEffect(() => {
    // Never poll before authentication is ready, and pause while hidden.
    if (telegramStatus !== 'ready') return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const startPolling = () => {
      if (interval || document.visibilityState !== 'visible') return;
      interval = setInterval(fetchCount, 30_000);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchCount();
        startPolling();
      } else {
        stopPolling();
      }
    };

    void fetchCount();
    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchCount, telegramStatus]);

  return (
    <Link
      href="/notifications"
      aria-label={t('nav.notifications')}
      className="relative rounded-xl p-2 text-soft transition-luxury hover:bg-muted/50 hover:text-ink"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5 text-soft"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}