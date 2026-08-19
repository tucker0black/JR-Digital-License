'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { getCategory, getProducts } from '@/lib/api';
import type { Category, Product } from '@/lib/api';
import { ProductCard } from '@/components/ProductCard';
import { SearchBar } from '@/components/SearchBar';
import { StoreHeader } from '@/components/StoreHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';

function CategoryContent() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const search = searchParams.get('search') ?? '';

  const [category, setCategory] = useState<Category | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCategory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { category: loaded } = await getCategory(slug);
      setCategory(loaded);
      setProducts(loaded.products);
    } catch {
      setCategory(null);
      setProducts([]);
      setError('This category is not available.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const loadSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getProducts({ search, category: slug, pageSize: 24 });
      setProducts(result.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [search, slug]);

  useEffect(() => {
    if (search) {
      void loadSearch();
    } else {
      void loadCategory();
    }
  }, [search, loadSearch, loadCategory]);

  if (loading && !category && !error) {
    return (
      <main className="min-h-screen bg-page text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
          <Skeleton className="h-9 w-40 rounded-xl" />
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-2xl" />
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
            className="inline-flex items-center gap-1.5 text-sm text-soft transition hover:text-primary"
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
            Back to Store
          </Link>
          {category && !search && (
            <div className="mt-3 flex items-center gap-3">
              {category.icon ? (
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-xl">
                  {category.icon}
                </span>
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-base font-bold text-soft">
                  {category.name.charAt(0)}
                </span>
              )}
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
              Results for &quot;{search}&quot;
            </h1>
          )}
        </header>

        <SearchBar category={slug} />

        {error ? (
          <div className="mt-8">
            <EmptyState
              title="Category unavailable"
              description={error}
              action={<Button href="/store">Browse all categories</Button>}
            />
          </div>
        ) : loading && products.length === 0 ? (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-2xl" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title={search ? 'No matching products' : 'No products in this category'}
              description={
                search
                  ? `Nothing matched "${search}" in this category.`
                  : 'New products will appear here as they become available.'
              }
              action={
                <Button href={search ? `/store/${slug}` : '/store'}>
                  {search ? 'Clear search' : 'Browse all categories'}
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
