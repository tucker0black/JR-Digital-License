'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { adminLogout, getAdminToken, getAdminTicketUnreadCount, getDashboardStats, isAdminApiError } from '@/lib/api-admin';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/stock', label: 'Stock' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/wallet', label: 'Wallet' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/tickets', label: 'Tickets' },
  { href: '/admin/smm', label: 'SMM' },
  { href: '/admin/analytics', label: 'Analytics' },
  { href: '/admin/audit', label: 'Audit Logs' },
  { href: '/admin/settings', label: 'Settings' }
];

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);
  const [ticketUnread, setTicketUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const token = getAdminToken();
    if (!token) {
      router.replace('/admin/login');
      return;
    }

    getDashboardStats()
      .then(() => {
        if (!cancelled) setAuthorized(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isAdminApiError(error) && (error.status === 401 || error.status === 403)) {
          adminLogout();
        }
        router.replace('/admin/login');
      });

    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  useEffect(() => {
    if (!authorized) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await getAdminTicketUnreadCount();
        if (!cancelled) setTicketUnread(result.unreadCount);
      } catch {
        // keep the last known count
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authorized]);

  const navLink = (item: (typeof NAV_ITEMS)[number], mobile: boolean) => {
    const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={
          mobile
            ? `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${
                active ? 'bg-cyan-500/15 font-medium text-cyan-300' : 'text-slate-300'
              }`
            : `block rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? 'bg-cyan-500/15 font-medium text-cyan-300' : 'text-slate-300 hover:bg-slate-800'
              }`
        }
      >
        <span className="inline-flex items-center gap-2">
          {item.label}
          {item.href === '/admin/tickets' && ticketUnread > 0 && (
            <span className="flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">
              {ticketUnread > 99 ? '99+' : ticketUnread}
            </span>
          )}
        </span>
      </Link>
    );
  };

  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  if (!authorized) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-page text-sm text-slate-400">
        Checking admin access…
      </div>
    );
  }

  const handleLogout = () => {
    adminLogout();
    router.replace('/admin/login');
  };

  return (
    <div className="dark min-h-screen bg-page text-slate-200">
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-slate-800 bg-card lg:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-800 px-4 py-4">
            <p className="text-sm font-bold text-slate-100">JR Digital license</p>
            <p className="text-xs text-cyan-400">Admin Dashboard</p>
          </div>
          <nav className="flex-1 overflow-y-auto p-2">
            {NAV_ITEMS.map((item) => navLink(item, false))}
          </nav>
          <div className="border-t border-slate-800 p-3">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Log out
            </button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-56">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-surface/90 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm font-bold text-slate-100">JR Digital license</p>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300"
            >
              Log out
            </button>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
            {NAV_ITEMS.map((item) => navLink(item, true))}
          </nav>
        </header>

        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}