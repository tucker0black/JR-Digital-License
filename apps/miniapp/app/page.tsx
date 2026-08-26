'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { classifyApiFailure, getBanners, getCategories, getFlashDeals, getMeHome, getOrders, getProducts } from '@/lib/api';
import type { Category, CustomerBanner, CustomerFlashDeal, MeHomeResponse, Order, Product } from '@/lib/api';
import { ProductCard } from '@/components/ProductCard';
import { SearchBar } from '@/components/SearchBar';
import { StoreHeader } from '@/components/StoreHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton, ProductCardSkeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { CategoryIcon } from '@/components/CategoryIcon';
import { BannerCarousel } from '@/components/BannerCarousel';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { useTranslation } from '@/lib/i18n';
import { getOrderStatusTone } from '@/components/orderStatusTone';
import { appName } from '@jr/shared';

export default function HomePage() {
  const { status: telegramStatus } = useTelegramAuth();
  const { t } = useTranslation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [banners, setBanners] = useState<CustomerBanner[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [popularProducts, setPopularProducts] = useState<Product[]>([]);
  const [recentProducts, setRecentProducts] = useState<Product[]>([]);
  const [flashDeals, setFlashDeals] = useState<CustomerFlashDeal[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [profile, setProfile] = useState<MeHomeResponse['user'] | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<'auth' | 'server' | 'network' | null>(null);
  const homeLoadStarted = useRef(false);

  const loadHomeData = useCallback(() => {
    setLoading(true);
    setCatalogError(null);
    setWalletError(null);

    let pendingRequests = 8;
    const settle = () => {
      pendingRequests -= 1;
      if (pendingRequests === 0) setLoading(false);
    };
    const load = <T,>(
      request: Promise<T>,
      onSuccess: (result: T) => void,
      onFailure?: (error: unknown) => void
    ) => {
      void request.then(onSuccess).catch((error) => onFailure?.(error)).finally(settle);
    };

    const catalogFailed = (error: unknown) => {
      setCatalogError(
        classifyApiFailure(error) === 'network'
          ? t('errors.connectionDown')
          : t('errors.serviceDown')
      );
    };

    load(
      getBanners({ targetType: 'HOME' }),
      (result) => setBanners(result.banners),
      () => {}
    );
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
    load(
      getFlashDeals(),
      (result) => setFlashDeals(result.deals),
      () => {}
    );
    load(getOrders({ pageSize: 3 }), (result) => setRecentOrders(result.orders));
    load(
      getMeHome(),
      (result) => {
        setProfile(result.user);
        setBalance(result.wallet.balance);
        setCurrency(result.wallet.currency);
      },
      (error) => setWalletError(classifyApiFailure(error))
    );
  }, [t]);

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

  const productLabels = {
    featured: t('product.featured'),
    popular: t('product.popular'),
    outOfStock: t('product.outOfStock'),
  };

  return (
    <main className="min-h-screen bg-page bg-cosmic text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        {/* Profile + wallet card */}
        <section className="animate-fade-up relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-violet to-accent p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-white/5 blur-3xl" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-32 w-96 -translate-x-1/2 bg-gradient-to-b from-white/8 to-transparent blur-2xl" />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {profile?.photoUrl ? (
                <img
                  src={profile.photoUrl}
                  alt={displayName ?? 'Telegram profile'}
                  width={56}
                  height={56}
                  decoding="async"
                  className="h-14 w-14 rounded-2xl border-2 border-white/20 object-cover shadow-lg"
                />
              ) : profile ? (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 text-xl font-bold text-white shadow-lg">
                  {displayName?.charAt(0) ?? '?'}
                </div>
              ) : (
                <Skeleton className="h-14 w-14 rounded-2xl" />
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-bold leading-tight text-white">
                    {displayName ??
                      (walletError
                        ? walletError === 'auth'
                          ? t('auth.accountUnavailable')
                          : t('errors.accountServiceDown')
                        : t('auth.loadingAccount'))}
                  </p>
                  {profile?.accountStatus && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                      {profile.accountStatus === 'NEW' ? t('auth.newUser') : t('auth.existingUser')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/70">
                  {profile?.username
                    ? `@${profile.username}`
                    : walletError
                      ? walletError === 'auth'
                        ? t('auth.authError')
                        : t('errors.serviceDown')
                      : t('auth.loadingProfile')}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                  {appName}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-start sm:justify-center sm:gap-1.5">
              <div>
                <p className="text-xs font-medium text-white/60">{t('home.balance')}</p>
                <div className="text-3xl font-bold tracking-tight text-white">
                  {!profile && walletError ? (
                    <span className="text-sm font-medium">{t('home.unavailable')}</span>
                  ) : loading && balance === null ? (
                    <Skeleton className="inline-block h-7 w-24 rounded-lg bg-white/20" />
                  ) : (
                    <span>
                      {currency === 'USD' ? '$' : ''}
                      {Number(balance ?? 0).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              <Link
                href="/wallet"
                className="rounded-xl bg-white/20 px-5 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-luxury hover:bg-white/30 hover:shadow-lg active:scale-95"
              >
                {t('home.deposit')}
              </Link>
            </div>
          </div>

          {/* Stats row */}
          {profile && (
            <div className="relative mt-6 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white/10 px-3 py-3 text-center backdrop-blur-sm">
                <p className="text-lg font-bold tabular-nums leading-tight text-white">{profile.totalItemsPurchased}</p>
                <p className="mt-0.5 text-[10px] font-medium text-white/50">{t('home.purchasedItems')}</p>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-3 text-center backdrop-blur-sm">
                <p className="text-lg font-bold tabular-nums leading-tight text-white">{profile.totalOrders}</p>
                <p className="mt-0.5 text-[10px] font-medium text-white/50">{t('nav.orders')}</p>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-3 text-center backdrop-blur-sm">
                <p className="text-lg font-bold tabular-nums leading-tight text-white">
                  {currency === 'USD' ? '$' : ''}
                  {Number(profile.totalDeposited ?? 0).toFixed(2)}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-white/50">{t('home.deposited')}</p>
              </div>
            </div>
          )}
        </section>

        {/* Search */}
        <div className="mt-5">
          <Suspense fallback={<Skeleton className="h-12 w-full rounded-2xl" />}>
            <SearchBar />
          </Suspense>
        </div>

        {/* Promotional Banners */}
        {banners.length > 0 && (
          <div className="mt-5">
            <BannerCarousel banners={banners} />
          </div>
        )}

        {/* Hot Deals */}
        {flashDeals.length > 0 && (
          <section className="animate-fade-up mt-6">
            <SectionHeader
              title={t('home.hotDeals')}
              subtitle={t('home.limitedOffers')}
              action={
                <Link
                  href="/store?deals=true"
                  className="text-sm font-medium text-primary transition-luxury hover:text-primary-dark"
                >
                  {t('home.viewAll')}
                </Link>
              }
            />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {flashDeals.slice(0, 6).map((deal) => (
                <ProductCard
                  key={deal.id}
                  product={{
                    id: deal.product.id,
                    name: deal.product.name,
                    slug: deal.product.slug,
                    description: null,
                    price: deal.product.price,
                    currency: deal.product.currency,
                    imageUrl: deal.product.imageUrl,
                    deliveryType: deal.product.deliveryType,
                    isOutOfStock: deal.product.isOutOfStock,
                    categoryId: '',
                    type: 'DIGITAL_LINK',
                    minimumQuantity: 1,
                    maximumQuantity: null,
                    hideWhenOutOfStock: false,
                    status: 'ACTIVE',
                    isActive: true,
                    isFeatured: false,
                    isPopular: false,
                    sortOrder: 0,
                    instructions: null,
                    keywords: [],
                    isHandDelivery: false,
                    createdAt: '',
                    updatedAt: ''
                  }}
                  flashDeal={deal}
                  translations={productLabels}
                />
              ))}
            </div>
          </section>
        )}

        {/* Quick actions */}
        <div className="mt-5 grid grid-cols-4 gap-2 stagger-children">
          {[
            { href: '/store', label: t('home.storeAction'), icon: '🛍️' },
            { href: '/topup', label: t('home.topUp'), icon: '💎' },
            { href: '/orders', label: t('home.ordersAction'), icon: '📦' },
            { href: '/wallet', label: t('home.walletAction'), icon: '💳' },
          ].map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="group flex flex-col items-center gap-1.5 rounded-2xl card-cosmic px-2 py-3.5 text-[11px] font-medium text-ink transition-luxury hover:-translate-y-0.5 hover:shadow-glow-sm active:scale-[0.97]"
            >
              <span className="text-xl transition-transform duration-200 group-hover:scale-110">{action.icon}</span>
              {action.label}
            </Link>
          ))}
        </div>

        {catalogError && (
          <div className="animate-fade-up mt-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            {catalogError}
          </div>
        )}

        {/* Categories */}
        <section className="mt-8">
          <SectionHeader
            title={t('home.categories')}
            subtitle={t('home.browseByCategory')}
            action={
              <Link
                href="/store"
                    className="text-sm font-medium text-primary transition-luxury hover:text-primary-dark"
              >
                {t('home.allStore')}
              </Link>
            }
          />
          {loading && categories.length === 0 ? (
            <div className="no-scrollbar -mx-4 mt-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[70px] w-44 shrink-0 rounded-2xl" />
              ))}
            </div>
          ) : categories.length > 0 ? (
            <div className="no-scrollbar -mx-4 mt-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={`/store/${category.slug}`}
                  className="group flex shrink-0 items-center gap-3 rounded-2xl card-cosmic px-4 py-3.5 transition-luxury hover:-translate-y-0.5 hover:shadow-glow-sm active:scale-95"
                >
                  <CategoryIcon imageUrl={category.imageUrl} icon={category.icon} name={category.name} />
                  <div>
                    <p className="text-sm font-semibold text-ink">{category.name}</p>
                    <p className="text-xs text-soft">{t('home.browseProducts')}</p>
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
              title={t('home.recentOrders')}
              subtitle={t('home.yourLatestPurchases')}
              action={
                <Link
                  href="/orders"
                      className="text-sm font-medium text-primary transition-luxury hover:text-primary-dark"
                >
                  {t('home.viewAll')}
                </Link>
              }
            />
            <ul className="mt-4 space-y-2">
              {recentOrders.map((order) => {
                const firstItem = order.items[0];
                const tone = getOrderStatusTone(order.status);
                return (
                  <li key={order.id}>
                    <Link
                      href={`/orders/${order.id}`}
                      className="group flex items-center gap-4 rounded-2xl card-cosmic p-4 transition-luxury hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                        {order.status === 'COMPLETED' ? '✓' : order.status === 'CANCELLED' ? '✕' : '○'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">
                          #{order.orderNumber} · {firstItem?.productNameSnapshot ?? t('orders.order')}
                        </p>
                        <p className="mt-0.5 text-xs text-soft">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
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
          <section className="animate-fade-up mt-10" aria-hidden="true">
            <SectionHeader title={t('home.recentlyAdded')} subtitle={t('home.freshArrivals')} />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          </section>
        ) : null}

        {featuredProducts.length > 0 && (
          <section className="animate-fade-up mt-10">
            <SectionHeader
              title={t('home.featured')}
              subtitle={t('home.handPicked')}
              action={
                <Link
                  href="/store?featured=true"
                      className="text-sm font-medium text-primary transition-luxury hover:text-primary-dark"
                >
                  {t('home.viewAll')}
                </Link>
              }
            />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} translations={productLabels} />
              ))}
            </div>
          </section>
        )}

        {popularProducts.length > 0 && (
          <section className="animate-fade-up mt-10">
            <SectionHeader
              title={t('home.popular')}
              subtitle={t('home.trending')}
              action={
                <Link
                  href="/store?popular=true"
                      className="text-sm font-medium text-primary transition-luxury hover:text-primary-dark"
                >
                  {t('home.viewAll')}
                </Link>
              }
            />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {popularProducts.map((product) => (
                <ProductCard key={product.id} product={product} translations={productLabels} />
              ))}
            </div>
          </section>
        )}

        {recentProducts.length > 0 && (
          <section className="animate-fade-up mt-10">
            <SectionHeader title={t('home.recentlyAdded')} subtitle={t('home.freshArrivals')} />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {recentProducts.map((product) => (
                <ProductCard key={product.id} product={product} translations={productLabels} />
              ))}
            </div>
          </section>
        )}

        {!loading && !hasProducts && !catalogError && (
          <div className="animate-fade-up mt-10">
            <EmptyState
              title={t('home.noProductsYet')}
              description={t('home.noProductsDescription')}
              action={<Button href="/store">{t('home.browseStore')}</Button>}
            />
          </div>
        )}
      </div>
    </main>
  );
}
