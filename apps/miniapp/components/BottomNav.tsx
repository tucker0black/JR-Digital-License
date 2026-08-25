'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { getSupportUnreadCount } from '@/lib/api';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { useTranslation } from '@/lib/i18n';

const NAV_ITEMS = [
  {
    href: '/',
    key: 'nav.home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
        <path d="M9.5 21v-6h5v6" />
      </svg>
    ),
    iconFilled: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[22px] w-[22px]">
        <path d="M12 2.1L1 12h3v9h6v-6h4v6h6v-9h3L12 2.1z" />
      </svg>
    )
  },
  {
    href: '/store',
    key: 'nav.store',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
        <path d="M3 9l1.5-5h15L21 9" />
        <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
        <path d="M5 12v9h14v-9" />
        <path d="M10 21v-5h4v5" />
      </svg>
    ),
    iconFilled: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[22px] w-[22px]">
        <path d="M4.5 9l1-4.5h13L19.5 9a3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1-3 3 3 3 0 0 1-3-3h-.5zM6 12v9h12v-9H6zm3 7v-5h6v5H9z" />
      </svg>
    )
  },
  {
    href: '/favorites',
    key: 'nav.favorites',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
        <path d="M4.318 6.318a4.5 4.5 0 0 0 0 6.364L12 20.364l7.682-7.682a4.5 4.5 0 0 0-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 0 0-6.364 0z" />
      </svg>
    ),
    iconFilled: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[22px] w-[22px]">
        <path d="M4.318 6.318a4.5 4.5 0 0 0 0 6.364L12 20.364l7.682-7.682a4.5 4.5 0 0 0-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 0 0-6.364 0z" />
      </svg>
    )
  },
  {
    href: '/orders',
    key: 'nav.orders',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
    iconFilled: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[22px] w-[22px]">
        <path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm2 6h8v2H8V8zm0 4h8v2H8v-2zm0 4h5v2H8v-2z" />
      </svg>
    )
  },
  {
    href: '/wallet',
    key: 'nav.wallet',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
        <rect x="3" y="6" width="18" height="14" rx="3" />
        <path d="M3 10h18" />
        <circle cx="16.5" cy="15.5" r="1.5" />
      </svg>
    ),
    iconFilled: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[22px] w-[22px]">
        <path d="M5 6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6zm4-1a1 1 0 0 0-1 1v2h10V6a1 1 0 0 0-1-1H9zm-1 5v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-8H8zm8 3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
      </svg>
    )
  },
  {
    href: '/support',
    key: 'nav.support',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
        <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5H4l1.8-3.2A8.5 8.5 0 1 1 21 12Z" />
        <circle cx="9" cy="12" r="0.5" fill="currentColor" />
        <circle cx="12" cy="12" r="0.5" fill="currentColor" />
        <circle cx="15" cy="12" r="0.5" fill="currentColor" />
      </svg>
    ),
    iconFilled: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[22px] w-[22px]">
        <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5H4l1.8-3.2A8.5 8.5 0 1 1 21 12zM9 11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm3-1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm3 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
      </svg>
    )
  }
];

export const SUPPORT_READ_EVENT = 'jr:support-read';

export function BottomNav() {
  const pathname = usePathname();
  const { status: telegramStatus } = useTelegramAuth();
  const { t } = useTranslation();
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
      aria-label={t('generic.mainNavigation')}
      className="fixed inset-x-0 bottom-0 z-40 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="glass-strong border-t border-line/30">
        <div className="mx-auto grid max-w-lg grid-cols-6 px-1 pt-1 pb-0.5">
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
                className="group relative flex flex-col items-center gap-0.5 py-1.5 transition-default"
              >
                {/* Active indicator pill - blue accent */}
                {active && (
                  <span className="absolute -top-0.5 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-gradient-to-r from-primary to-primary-light shadow-glow-sm" />
                )}

                <span
                  className={`relative flex items-center justify-center transition-default ${
                    active
                      ? 'text-primary scale-105'
                      : 'text-soft group-hover:text-ink group-active:scale-95'
                  }`}
                >
                  {active ? item.iconFilled : item.icon}
                  {item.href === '/support' && unreadCount > 0 && (
                    <span
                      aria-label={t('support.unreadBadge', { count: String(unreadCount) })}
                      className="absolute -right-2.5 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white shadow-sm shadow-danger/40"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
                <span
                  className={`text-[10px] font-medium transition-default ${
                    active ? 'text-primary' : 'text-soft group-hover:text-ink'
                  }`}
                >
                  {t(item.key)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
