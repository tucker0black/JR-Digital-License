'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getCategories, getMe, getOrders, getProducts } from '@/lib/api';
import type { Category, Order, Product } from '@/lib/api';
import { ProductCard } from '@/components/ProductCard';
import { SearchBar } from '@/components/SearchBar';
import { StoreHeader } from '@/components/StoreHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { appName } from '@jr/shared';

const ORDER_STATUS_TONES: Record<string, 'green' | 'red' | 'violet' | 'amber' | 'slate'> = {
  COMPLETED: 'green',
  CANCELLED: 'red',
  REFUNDED: 'red',
  DELIVERY_FAILED: 'red',
  PROCESSING: 'amber',
  FULFILLING: 'amber',
  PAYMENT_PENDING: 'amber',
  PAID: 'violet',
  DRAFT: 'slate',
  EXPIRED: 'slate'
};

export default function HomePage() {
  const { status: telegramStatus } = useTelegramAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [popularProducts, setPopularProducts] = useState<Product[]>([]);
  const [recentProducts, setRecentProducts] = useState<Product[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [profile, setProfile] = useState<{
    firstName: string;
    lastName: string | null;
    username: string | null;
    photoUrl: string | null;
    accountStatus: 'NEW' | 'EXISTING';
    totalItemsPurchased: number;
    totalOrders: number;
    totalDeposited: string;
  } | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const homeLoadStarted = useRef(false);

  const loadHomeData = useCallback(() => {
    setLoading(true);
    setCatalogError(null);
    setWalletError(null);

    let pendingRequests = 6;
    const settle = () => {
      pendingRequests -= 1;
      if (pendingRequests === 0) setLoading(false);
    };
    const load = <T,>(
      request: Promise<T>,
      onSuccess: (result: T) => void,
      onFailure?: () => void
    ) => {
      void request.then(onSuccess).catch(() => onFailure?.()).finally(settle);
    };

    const catalogFailed = () => {
      setCatalogError('Some store sections are temporarily unavailable. Please try again.');
    };

    load(
      getProducts({ featured: true, pageSize: 6 }),
      (result) => setFeaturedProducts(result.products),
      catalogFailed
    );
    load(
      getProducts({ popular: true, pageSize: 6 }),
      (result) => setPopularProducts(result.products),
      catalogFailed
    );
    load(
      getProducts({ pageSize: 6 }),
      (result) => setRecentProducts(result.products),
      catalogFailed
    );
    load(
      getCategories(),
      (result) => setCategories(result.categories),
      catalogFailed
    );
    load(getOrders({ pageSize: 3 }), (result) => setRecentOrders(result.orders));
    load(
      getMe(),
      (result) => {
        setProfile(result.user);
        setBalance(result.wallet.balance);
        setCurrency(result.wallet.currency);
      },
      () => setWalletError('Telegram authentication failed. Please reopen JR Digital license from Telegram.')
    );
  }, []);

  useEffect(() => {
    if (telegramStatus !== 'ready' || homeLoadStarted.current) return;
    homeLoadStarted.current = true;
    loadHomeData();
  }, [loadHomeData, telegramStatus]);

  if (telegramStatus === 'unavailable') {
    return (
      <main className="min-h-screen bg-page px-4 pb-24 pt-6 text-ink sm:px-6 sm:pt-8">
        <div className="mx-auto w-full max-w-5xl">
          <TelegramAuthNotice />
        </div>
      </main>
    );
  }

  const hasProducts =
    featuredProducts.length > 0 || popularProducts.length > 0 || recentProducts.length > 0;
  const displayName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null
    : null;

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        {/* Profile + balance */}
        <section className="animate-fade-up relative overflow-hidden rounded-3xl border border-line bg-card p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-violet/15 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {profile?.photoUrl ? (
                <img
                  src={profile.photoUrl}
                  alt={displayName ?? 'Telegram profile'}
                  width={56}
                  height={56}
                  decoding="async"
                  className="h-14 w-14 rounded-2xl border border-line object-cover shadow-sm"
                />
              ) : profile ? (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet text-xl font-bold text-white">
                  {displayName?.charAt(0) ?? '?'}
                </div>
              ) : (
                <div className="skeleton h-14 w-14 rounded-2xl">
                </div>
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-bold leading-tight text-ink">
                    {displayName ?? (walletError ? 'Telegram account unavailable' : 'Loading Telegram account...')}
                  </p>
                  {profile?.accountStatus && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        profile.accountStatus === 'NEW'
                          ? 'border-primary/40 bg-primary-soft text-primary'
                          : 'border-success/40 bg-muted text-success'
                      }`}
                    >
                      {profile.accountStatus === 'NEW' ? '🆕 New User' : '🟢 Existing User'}
                    </span>
                  )}
                </div>
                <p className="text-sm text-soft">
                  {profile?.username ? `@${profile.username}` : walletError ? 'Authentication error' : 'Loading profile...'}
                </p>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.15em] text-primary">
                  {appName}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-muted/60 px-5 py-4 sm:flex-col sm:items-start sm:justify-center sm:gap-1">
              <div>
                <p className="text-xs font-medium text-soft">Balance</p>
                <p className="text-2xl font-bold tracking-tight text-ink">
                  {!profile && walletError ? (
                    <span className="text-sm font-medium text-warning">Unavailable</span>
                  ) : loading && balance === null ? (
                    <span className="skeleton inline-block h-6 w-24 rounded" />
                  ) : (
                    <>
                      {currency === 'USD' ? '$' : ''}
                      {Number(balance ?? 0).toFixed(2)}
                      <span className="ml-1 text-sm font-medium text-soft">{currency}</span>
                    </>
                  )}
                </p>
              </div>
              <Button href="/wallet" size="md">
                + Deposit
              </Button>
            </div>
          </div>
          {walletError && <p className="relative mt-4 text-sm text-warning">{walletError}</p>}
          {profile && (
            <div className="relative mt-5 grid grid-cols-3 gap-2.5">
              <div className="rounded-2xl border border-line bg-muted/50 px-3 py-3 text-center">
                <p className="text-lg font-bold leading-tight text-ink">{profile.totalItemsPurchased}</p>
                <p className="mt-0.5 text-[11px] font-medium text-soft">Purchased items</p>
              </div>
              <div className="rounded-2xl border border-line bg-muted/50 px-3 py-3 text-center">
                <p className="text-lg font-bold leading-tight text-ink">{profile.totalOrders}</p>
                <p className="mt-0.5 text-[11px] font-medium text-soft">Orders</p>
              </div>
              <div className="rounded-2xl border border-line bg-muted/50 px-3 py-3 text-center">
                <p className="text-lg font-bold leading-tight text-ink">
                  {currency === 'USD' ? '$' : ''}
                  {Number(profile.totalDeposited ?? 0).toFixed(2)}
                  {currency !== 'USD' && <span className="ml-0.5 text-[11px] font-medium text-soft">{currency}</span>}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-soft">Deposited</p>
              </div>
            </div>
          )}
        </section>

        {/* Search */}
        <div className="mt-6">
          <Suspense fallback={<Skeleton className="h-11 w-full rounded-2xl" />}>
            <SearchBar />
          </Suspense>
        </div>

        {/* Quick actions */}
        <div className="mt-5 grid grid-cols-4 gap-2.5">
          {[
            { href: '/store', label: 'Store', icon: '🛍' },
            { href: '/orders', label: 'Orders', icon: '📦' },
            { href: '/wallet', label: 'Wallet', icon: '💳' },
            { href: '/support', label: 'Support', icon: '💬' }
          ].map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-card px-2 py-3.5 text-xs font-medium text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30"
            >
              <span className="text-xl">{action.icon}</span>
              {action.label}
            </Link>
          ))}
        </div>

        {catalogError && (
          <div className="animate-fade-up mt-4 rounded-xl border border-line bg-card px-4 py-2.5 text-sm text-warning">
            {catalogError}
          </div>
        )}

        {/* Categories */}
        <section className="mt-8">
          <SectionHeader
            title="Categories"
            subtitle="Browse by category"
            action={
              <Link
                href="/store"
                className="text-sm font-medium text-primary transition hover:text-primary-dark"
              >
                All store
              </Link>
            }
          />
          {loading && categories.length === 0 ? (
            <div className="no-scrollbar -mx-4 mt-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[74px] w-40 shrink-0 rounded-2xl" />
              ))}
            </div>
          ) : categories.length > 0 ? (
            <div className="no-scrollbar -mx-4 mt-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={`/store/${category.slug}`}
                  className="group flex shrink-0 items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md active:scale-[0.98]"
                >
                  {category.icon ? (
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-lg">
                      {category.icon}
                    </span>
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-sm font-bold text-soft">
                      {category.name.charAt(0)}
                    </span>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-ink">{category.name}</p>
                    <p className="text-xs text-soft">Browse products</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        {/* Recent orders */}
        {recentOrders.length > 0 && (
          <section className="animate-fade-up mt-10">
            <SectionHeader
              title="Recent Orders"
              subtitle="Your latest purchases"
              action={
                <Link
                  href="/orders"
                  className="text-sm font-medium text-primary transition hover:text-primary-dark"
                >
                  View all
                </Link>
              }
            />
            <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-card">
              {recentOrders.map((order) => {
                const firstItem = order.items[0];
                const tone = ORDER_STATUS_TONES[order.status] ?? 'slate';
                return (
                  <li key={order.id}>
                    <Link
                      href={`/orders/${order.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          #{order.orderNumber} · {firstItem?.productNameSnapshot ?? 'Order'}
                        </p>
                        <p className="mt-0.5 text-xs text-soft">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-bold text-ink">
                          {order.currency === 'USD' ? '$' : ''}
                          {Number(order.total).toFixed(2)}
                        </span>
                        <Badge tone={tone}>{order.status.replace('_', ' ')}</Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {loading && !hasProducts ? (
          <section className="animate-fade-up mt-10">
            <SectionHeader title="Recently Added" subtitle="Fresh arrivals in the store" />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="aspect-[3/4] w-full rounded-2xl" />
              ))}
            </div>
          </section>
        ) : null}

        {featuredProducts.length > 0 && (
          <section className="animate-fade-up mt-10">
            <SectionHeader
              title="Featured"
              subtitle="Hand-picked products"
              action={
                <Link
                  href="/store?featured=true"
                  className="text-sm font-medium text-primary transition hover:text-primary-dark"
                >
                  View all
                </Link>
              }
            />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        )}

        {popularProducts.length > 0 && (
          <section className="animate-fade-up mt-10">
            <SectionHeader
              title="Popular"
              subtitle="Trending right now"
              action={
                <Link
                  href="/store?popular=true"
                  className="text-sm font-medium text-primary transition hover:text-primary-dark"
                >
                  View all
                </Link>
              }
            />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {popularProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        )}

        {recentProducts.length > 0 && (
          <section className="animate-fade-up mt-10">
            <SectionHeader title="Recently Added" subtitle="Fresh arrivals in the store" />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {recentProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        )}

        {!loading && !hasProducts && !catalogError && (
          <div className="animate-fade-up mt-10">
            <EmptyState
              title="No products available yet"
              description="Products will appear here once the store is stocked."
              action={<Button href="/store">Browse Store</Button>}
            />
          </div>
        )}
      </div>
    </main>
  );
}
