'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCategories, getProducts } from '@/lib/api';
import type { Category, Product } from '@/lib/api';
import { CategoryCard } from '@/components/CategoryCard';
import { ProductCard } from '@/components/ProductCard';
import { SearchBar } from '@/components/SearchBar';
import { StoreHeader } from '@/components/StoreHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { ProductCardSkeleton } from '@/components/Skeleton';
import { useTranslation } from '@/lib/i18n';

const SORT_OPTION_VALUES = ['', 'price_asc', 'price_desc', 'name', 'newest'] as const;

const SORT_LABEL_KEYS: Record<string, string> = {
  '': 'store.sortDefault',
  price_asc: 'store.sortPriceAsc',
  price_desc: 'store.sortPriceDesc',
  name: 'store.sortNameAZ',
  newest: 'store.sortNewest'
};

const DELIVERY_TYPE_VALUES = [
  '',
  'DIGITAL_LINK',
  'DIGITAL_CODE',
  'DIGITAL_TEXT',
  'DIGITAL_FILE',
  'DIGITAL_ACCOUNT',
  'SMM_API'
] as const;

const DELIVERY_TYPE_LABEL_KEYS: Record<string, string> = {
  '': 'store.allTypes',
  DIGITAL_LINK: 'store.deliveryLink',
  DIGITAL_CODE: 'store.deliveryCode',
  DIGITAL_TEXT: 'store.deliveryText',
  DIGITAL_FILE: 'store.deliveryFile',
  DIGITAL_ACCOUNT: 'store.deliveryAccount',
  SMM_API: 'store.deliverySmm'
};

function StoreContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const search = searchParams.get('search') ?? '';
  const featured = searchParams.get('featured') === 'true';
  const popular = searchParams.get('popular') === 'true';
  // Filters persist in the URL so back/forward, refresh and shared links work.
  const deliveryType = searchParams.get('type') ?? '';
  const sort = searchParams.get('sort') ?? '';
  const inStockOnly = searchParams.get('inStock') === 'true';
  // Starting page comes from the URL; filter changes clear it back to page 1.
  const initialPage = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const { t } = useTranslation();

  const isFiltered = search.length > 0 || featured || popular;

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const result = await getCategories();
      setCategories(result.categories);
    } catch {
      setError(t('store.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async (pageToLoad: number) => {
    const append = pageToLoad > 1;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await getProducts({
        search: search || undefined,
        featured: featured || undefined,
        popular: popular || undefined,
        deliveryType: deliveryType || undefined,
        inStock: inStockOnly ? 'true' : undefined,
        sort: sort || undefined,
        page: pageToLoad,
        pageSize: 24
      });
      setProducts((prev) => (append ? [...prev, ...result.products] : result.products));
      setTotal(result.total);
      setPage(pageToLoad);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('store.unableToLoad'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, featured, popular, deliveryType, inStockOnly, sort]);

  useEffect(() => {
    if (isFiltered) {
      void loadProducts(initialPage);
    } else {
      void loadCategories();
    }
  }, [isFiltered, initialPage, loadProducts, loadCategories]);

  const hasMore = products.length < total;

  // Filter changes persist to the URL; changing any filter resets pagination.
  const updateFilterParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    const qs = params.toString();
    router.replace(`/store${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  return (
    <main className="min-h-screen bg-page bg-cosmic text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        <header className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {isFiltered ? t('search.results') : t('store.title')}
          </h1>
          <p className="mt-1 text-sm text-soft">
            {isFiltered
              ? total === 1
                ? t('search.found', { total: String(total) })
                : t('search.foundPlural', { total: String(total) })
              : t('store.browseCategories')}
          </p>
        </header>

        <SearchBar />

        {isFiltered && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={deliveryType}
                onChange={(e) => updateFilterParam('type', e.target.value)}
                aria-label={t('store.filterByDeliveryType')}
                className="appearance-none rounded-xl border border-line/60 bg-card py-2 pl-3 pr-9 text-sm text-ink shadow-sm transition-default focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
              >
                {DELIVERY_TYPE_VALUES.map((value) => {
                  const labelKey = DELIVERY_TYPE_LABEL_KEYS[value];
                  return <option key={value} value={value}>{labelKey ? t(labelKey) : value}</option>;
                })}
              </select>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-text"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>

            <div className="relative">
              <select
                value={sort}
                onChange={(e) => updateFilterParam('sort', e.target.value)}
                aria-label={t('store.sortProducts')}
                className="appearance-none rounded-xl border border-line/60 bg-card py-2 pl-3 pr-9 text-sm text-ink shadow-sm transition-default focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
              >
                {SORT_OPTION_VALUES.map((value) => {
                  const labelKey = SORT_LABEL_KEYS[value];
                  return <option key={value} value={value}>{labelKey ? t(labelKey) : value}</option>;
                })}
              </select>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-text"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>

            <label
              className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-default ${
                inStockOnly
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-line/60 bg-card text-soft hover:border-primary/30'
              }`}
            >
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => updateFilterParam('inStock', e.target.checked ? 'true' : '')}
                className="h-4 w-4 accent-primary"
              />
              {t('store.inStockOnly')}
            </label>
          </div>
        )}

        {isFiltered ? (
          loading && products.length === 0 ? (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            <div className="mt-8">
              <EmptyState
                title={t('store.searchUnavailable')}
                description={error}
                action={<Button href="/store">{t('search.browseAll')}</Button>}
              />
            </div>
          ) : products.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                title={t('search.noResults')}
                description={
                  search
                    ? t('search.noResultsDescription', { search })
                    : t('search.noFilterResults')
                }
                icon={
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                }
                action={<Button href="/store">{t('search.clearFilters')}</Button>}
              />
            </div>
          ) : (
            <>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadProducts(page + 1)}
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
          )
        ) : error ? (
          <div className="mt-8">
            <EmptyState
              title={t('store.unableToLoad')}
              description={error}
              action={<Button href="/">{t('store.backToHome')}</Button>}
            />
          </div>
        ) : categories.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title={t('store.noCategories')}
              description={t('store.noCategoriesDescription')}
              action={<Button href="/">{t('store.backToHome')}</Button>}
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 stagger-children">
            {categories.map((category) => (
              <Link key={category.id} href={`/store/${category.slug}`} className="h-full">
                <CategoryCard category={category} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export default function StorePage() {
  return (
    <Suspense>
      <StoreContent />
    </Suspense>
  );
}
