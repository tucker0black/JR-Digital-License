'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getCategories, getProducts } from '@/lib/api';
import type { Category, Product } from '@/lib/api';
import { CategoryCard } from '@/components/CategoryCard';
import { ProductCard } from '@/components/ProductCard';
import { SearchBar } from '@/components/SearchBar';
import { StoreHeader } from '@/components/StoreHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';

function StoreContent() {
  const searchParams = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const featured = searchParams.get('featured') === 'true';
  const popular = searchParams.get('popular') === 'true';
  const pageNum = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);

  const isFiltered = search.length > 0 || featured || popular;

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const result = await getCategories();
      setCategories(result.categories);
    } catch {
      setError('Unable to load the store. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getProducts({
        search: search || undefined,
        featured: featured || undefined,
        popular: popular || undefined,
        page: pageNum,
        pageSize: 24
      });
      setProducts(result.products);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load products');
    } finally {
      setLoading(false);
    }
  }, [search, featured, popular, pageNum]);

  useEffect(() => {
    if (isFiltered) {
      void loadProducts();
    } else {
      void loadCategories();
    }
  }, [isFiltered, loadProducts, loadCategories]);

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        <header className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {isFiltered ? 'Search results' : 'Store'}
          </h1>
          <p className="mt-1 text-sm text-soft">
            {isFiltered
              ? `Found ${total} product${total === 1 ? '' : 's'}`
              : 'Browse categories and discover products'}
          </p>
        </header>

        <SearchBar />

        {isFiltered ? (
          loading && products.length === 0 ? (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <Skeleton key={i} className="aspect-[3/4] w-full rounded-2xl" />
              ))}
            </div>
          ) : error ? (
            <div className="mt-8">
              <EmptyState
                title="Search unavailable"
                description={error}
                action={<Button href="/store">Browse all products</Button>}
              />
            </div>
          ) : products.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                title="No products found"
                description={
                  search
                    ? `Nothing matched "${search}". Try a different keyword.`
                    : 'No products match this filter yet.'
                }
                action={<Button href="/store">Clear filters</Button>}
              />
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )
        ) : error ? (
          <div className="mt-8">
            <EmptyState
              title="Unable to load the store"
              description={error}
              action={<Button href="/">Back to Home</Button>}
            />
          </div>
        ) : categories.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No categories available"
              description="Categories will appear here once the store is stocked."
              action={<Button href="/">Back to Home</Button>}
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
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
