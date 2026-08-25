'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { getBanners, getCategory, getProducts } from '@/lib/api';
import type { Category, CustomerBanner, Product } from '@/lib/api';
import { ProductCard } from '@/components/ProductCard';
import { SearchBar } from '@/components/SearchBar';
import { StoreHeader } from '@/components/StoreHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Skeleton, ProductCardSkeleton } from '@/components/Skeleton';
import { CategoryIcon } from '@/components/CategoryIcon';
import { BannerCarousel } from '@/components/BannerCarousel';
import { TOP_UP_CATEGORY_SLUGS } from '@/lib/banners';
import { useTranslation } from '@/lib/i18n';

function CategoryContent() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const router = useRouter();
  const { t } = useTranslation();

  const [category, setCategory] = useState<Category | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [banners, setBanners] = useState<CustomerBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect Top-Up category to unified Top-Up page
  useEffect(() => {
    if (TOP_UP_CATEGORY_SLUGS.includes(slug)) {
      router.replace('/topup');
    }
  }, [slug, router]);

  const loadCategory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { category: loaded } = await getCategory(slug);
      setCategory(loaded);
      setProducts(loaded.products);
      if (loaded.id) {
        try {
          const bannerResult = await getBanners({ targetType: 'CATEGORY', categoryId: loaded.id });
          setBanners(bannerResult.banners);
        } catch {
          // Banners are optional, don't fail the page
        }
      }
    } catch {
      setCategory(null);
      setProducts([]);
      setError(t('category.unavailableDescription'));
    } finally {
      setLoading(false);
    }
  }, [slug, t]);

  const loadSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getProducts({ search, category: slug, pageSize: 24 });
      setProducts(result.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('store.searchUnavailable'));
    } finally {
      setLoading(false);
    }
  }, [search, slug, t]);

  useEffect(() => {
    if (search) {
      void loadSearch();
    } else {
      void loadCategory();
    }
  }, [search, loadSearch, loadCategory]);

  if (loading && !category && !error) {
    return (
      <main className="min-h-screen bg-page bg-cosmic text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
          <Skeleton className="h-9 w-40 rounded-xl" />
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        <header className="mb-5">
          <Link
            href="/store"
            className="inline-flex items-center gap-1.5 text-sm text-soft transition-default hover:text-primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            {t('category.backToStore')}
          </Link>
          {category && !search && (
            <div className="mt-3 flex items-center gap-3">
              <CategoryIcon size="lg" imageUrl={category.imageUrl} icon={category.icon} name={category.name} />
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-ink">{category.name}</h1>
                {category.description && (
                  <p className="mt-0.5 text-sm text-soft">{category.description}</p>
                )}
              </div>
            </div>
          )}
          {search && (
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">
              {t('category.resultsFor', { search })}
            </h1>
          )}
        </header>

        <SearchBar category={slug} />

        {/* Category Banners */}
        {banners.length > 0 && (
          <div className="mt-5">
            <BannerCarousel banners={banners} />
          </div>
        )}

        {error ? (
          <div className="mt-8">
            <EmptyState
              title={t('category.unavailable')}
              description={error}
              action={<Button href="/store">{t('category.browseAll')}</Button>}
            />
          </div>
        ) : loading && products.length === 0 ? (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title={search ? t('category.noMatch') : t('category.noProducts')}
              description={
                search
                  ? t('category.noMatchDescription', { search })
                  : t('category.newProducts')
              }
              action={
                <Button href={search ? `/store/${slug}` : '/store'}>
                  {search ? t('category.clearSearch') : t('category.browseAll')}
                </Button>
              }
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export default function CategoryPage() {
  return (
    <Suspense>
      <CategoryContent />
    </Suspense>
  );
}
