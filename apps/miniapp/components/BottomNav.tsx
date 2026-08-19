'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { getSupportUnreadCount } from '@/lib/api';
import { useTelegramAuth } from '@/components/TelegramProvider';

const NAV_ITEMS = [
  {
    href: '/',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
        <path d="M9.5 21v-6h5v6" />
      </svg>
    )
  },
  {
    href: '/store',
    label: 'Store',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M3 9l1.5-5h15L21 9" />
        <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
        <path d="M5 12v9h14v-9" />
        <path d="M10 21v-5h4v5" />
      </svg>
    )
  },
  {
    href: '/orders',
    label: 'Orders',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    )
  },
  {
    href: '/wallet',
    label: 'Wallet',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="3" y="6" width="18" height="14" rx="3" />
        <path d="M3 10h18" />
        <circle cx="16.5" cy="15.5" r="1.5" />
      </svg>
    )
  },
  {
    href: '/support',
    label: 'Support',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5H4l1.8-3.2A8.5 8.5 0 1 1 21 12Z" />
        <circle cx="9" cy="12" r="0.5" fill="currentColor" />
        <circle cx="12" cy="12" r="0.5" fill="currentColor" />
        <circle cx="15" cy="12" r="0.5" fill="currentColor" />
      </svg>
    )
  }
];

export const SUPPORT_READ_EVENT = 'jr:support-read';

export function BottomNav() {
  const pathname = usePathname();
  const { status: telegramStatus } = useTelegramAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnread = useCallback(async () => {
    try {
      const result = await getSupportUnreadCount();
      setUnreadCount(result.unreadCount);
    } catch {
      // keep the last known count; transient failures must not clear the badge
    }
  }, []);

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const startPolling = () => {
      if (interval || document.visibilityState !== 'visible') return;
      interval = setInterval(() => void refreshUnread(), 10_000);
    };
    const onSupportRead = () => void refreshUnread();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshUnread();
        startPolling();
      } else {
        stopPolling();
      }
    };

    void refreshUnread();
    startPolling();
    window.addEventListener(SUPPORT_READ_EVENT, onSupportRead);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopPolling();
      window.removeEventListener(SUPPORT_READ_EVENT, onSupportRead);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshUnread, telegramStatus]);

  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/90 backdrop-blur-lg md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                active ? 'text-primary' : 'text-soft hover:text-ink'
              }`}
            >
              <span className="relative">
                {item.icon}
                {item.href === '/support' && unreadCount > 0 && (
                  <span
                    aria-label={`${unreadCount} unread support replies`}
                    className="absolute -right-2 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white shadow-sm shadow-red-500/40"
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
