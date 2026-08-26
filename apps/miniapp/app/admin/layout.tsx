'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { adminLogout, checkAdminAuth, getAdminPendingHandDeliveryCount, getAdminToken, getAdminTicketUnreadCount, isAdminApiError } from '@/lib/api-admin';

const NAV_ITEMS: Array<{ href: string; label: string; icon?: string } | { divider: true }> = [
  { href: '/admin', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1' },
  { href: '/admin/products', label: 'Products', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { href: '/admin/categories', label: 'Categories', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
  { href: '/admin/banners', label: 'Banners', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
  { href: '/admin/flash-deals', label: 'Flash Deals', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { href: '/admin/coupons', label: 'Coupons', icon: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z' },
  { href: '/admin/stock', label: 'Stock', icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4' },
  { href: '/admin/orders', label: 'Orders', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { href: '/admin/payments', label: 'Payments', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
  { href: '/admin/wallet', label: 'Wallet', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
  { href: '/admin/topup', label: 'Top Up', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { divider: true },
  { href: '/admin/users', label: 'Users', icon: 'M12 4.354a4 4 0 110 7.292 4 4 0 010-7.292zM15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { href: '/admin/tickets', label: 'Tickets', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { href: '/admin/smm', label: 'SMM', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { divider: true },
  { href: '/admin/analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { href: '/admin/audit', label: 'Audit Logs', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { href: '/admin/security', label: 'Security', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
  { href: '/admin/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState<'server' | 'network' | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ticketUnread, setTicketUnread] = useState(0);
  const [pendingHandDelivery, setPendingHandDelivery] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const token = getAdminToken();
    if (!token) {
      router.replace('/admin/login');
      return;
    }

    setAuthError(null);

    // Use the lightweight auth-check endpoint instead of the heavy
    // dashboard-stats call.  The check endpoint only validates the token
    // which is O(1) in the database.
    checkAdminAuth()
      .then(() => {
        if (!cancelled) setAuthorized(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isAdminApiError(error) && (error.status === 401 || error.status === 403)) {
          adminLogout();
          router.replace('/admin/login');
          return;
        }
        // Server outage / timeout / connectivity problem. Never leave the
        // operator stuck on the spinner and never blame the admin token.
        setAuthError(isAdminApiError(error) ? 'server' : 'network');
      });

    return () => { cancelled = true; };
  }, [router, retryNonce]);

  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await getAdminTicketUnreadCount();
        if (!cancelled) setTicketUnread(result.unreadCount);
      } catch { /* keep last known count */ }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [authorized]);

  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await getAdminPendingHandDeliveryCount();
        if (!cancelled) setPendingHandDelivery(result.count);
      } catch { /* keep last known count */ }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    const onCountChanged = () => void refresh();
    window.addEventListener('hand-delivery-count-changed', onCountChanged);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('hand-delivery-count-changed', onCountChanged); };
  }, [authorized]);

  const navLink = (item: (typeof NAV_ITEMS)[number], mode: 'sidebar' | 'mobile') => {
    if ('divider' in item) {
      return mode === 'sidebar'
        ? <div key="divider" className="my-2 mx-3 border-t border-line/30" />
        : <div key="divider" className="h-px w-px" />;
    }
    const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setSidebarOpen(false)}
        className={
          mode === 'sidebar'
            ? `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-luxury ${
                active
                  ? 'bg-gradient-to-r from-primary/15 to-primary/5 text-primary font-medium shadow-glow-sm'
                  : 'text-soft hover:text-ink hover:bg-muted/50'
              }`
            : `flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs transition-luxury ${
                active
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-soft'
              }`
        }
      >
        {mode === 'sidebar' && item.icon && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-primary' : 'text-muted-text group-hover:text-ink'}`}>
            <path d={item.icon} />
          </svg>
        )}
        <span>{item.label}</span>
        {item.href === '/admin/tickets' && ticketUnread > 0 && (
          <span className="ml-auto flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white">
            {ticketUnread > 99 ? '99+' : ticketUnread}
          </span>
        )}
        {item.href === '/admin/orders' && pendingHandDelivery > 0 && (
          <span className="ml-auto flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white">
            {pendingHandDelivery > 99 ? '99+' : pendingHandDelivery}
          </span>
        )}
      </Link>
    );
  };

  if (pathname === '/admin/login') return <>{children}</>;

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-4 text-ink">
        <div className="w-full max-w-sm rounded-2xl border border-line/50 bg-card p-6 text-center shadow-lg">
          <p className="text-base font-bold tracking-premium">Admin authentication failed.</p>
          <p className="mt-2 text-sm text-soft">
            {authError === 'network'
              ? 'Cannot reach JR Digital license. Check your internet connection.'
              : 'The admin service is temporarily unavailable. Please try again.'}
          </p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-luxury hover:bg-primary-dark active:scale-[0.98]"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => { adminLogout(); router.replace('/admin/login'); }}
              className="flex-1 rounded-xl border border-line/40 px-4 py-2.5 text-sm font-medium text-soft transition-luxury hover:text-ink active:scale-[0.98]"
            >
              Go to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page text-sm text-soft">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-primary" />
          Checking admin access…
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    adminLogout();
    router.replace('/admin/login');
  };

  return (
    <div className="min-h-screen bg-page text-ink bg-ambient">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — desktop */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-60 border-r border-line/30 bg-surface/80 backdrop-blur-xl lg:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-line/30 px-5 py-5">
            <p className="text-sm font-bold tracking-premium text-ink">JR Digital license</p>
            <p className="mt-0.5 text-[11px] font-medium text-primary">Admin Dashboard</p>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-0.5">
              {NAV_ITEMS.map((item) => navLink(item, 'sidebar'))}
            </div>
          </nav>
          <div className="border-t border-line/30 p-3">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-line/40 px-3 py-2.5 text-sm text-soft transition-luxury hover:border-danger/30 hover:bg-danger/5 hover:text-danger"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Log out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar drawer */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-line/30 bg-surface/95 backdrop-blur-xl transition-transform duration-200 lg:hidden ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line/30 px-5 py-4">
            <div>
              <p className="text-sm font-bold tracking-premium text-ink">JR Digital license</p>
              <p className="mt-0.5 text-[11px] font-medium text-primary">Admin Dashboard</p>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-1.5 text-soft hover:text-ink"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-0.5">
              {NAV_ITEMS.map((item) => navLink(item, 'mobile'))}
            </div>
          </nav>
          <div className="border-t border-line/30 p-3">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-line/40 px-3 py-2.5 text-sm text-soft transition-luxury hover:border-danger/30 hover:bg-danger/5 hover:text-danger"
            >
              Log out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="lg:pl-60">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 border-b border-line/30 bg-surface/80 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-1.5 text-soft hover:text-ink"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <p className="text-sm font-bold tracking-premium text-ink">JR Digital license</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-line/40 px-3 py-1.5 text-xs text-soft"
            >
              Log out
            </button>
          </div>
          <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-3">
            {NAV_ITEMS.map((item) => navLink(item, 'mobile'))}
          </nav>
        </header>

        <main className="p-4 lg:p-6 xl:p-8">{children}</main>
      </div>
    </div>
  );
}
