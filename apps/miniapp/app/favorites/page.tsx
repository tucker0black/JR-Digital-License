'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFavorites } from '@/lib/api';
import type { FavoriteDetail } from '@jr/shared';
import { ProductCard } from '@/components/ProductCard';
import { StoreHeader } from '@/components/StoreHeader';
import { ProductCardSkeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { useTranslation } from '@/lib/i18n';

export default function FavoritesPage() {
  const { status: telegramStatus } = useTelegramAuth();
  const { t } = useTranslation();
  const [favorites, setFavorites] = useState<FavoriteDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const loadFavorites = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getFavorites({ page, pageSize });
      setFavorites(result.favorites);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('favorites.loadError'));
    } finally {
      setLoading(false);
    }
    // Deliberately not keyed on t: switching language must not refetch data.
  }, [page]);

  useEffect(() => {
    if (telegramStatus === 'ready') {
      void loadFavorites();
    }
  }, [loadFavorites, telegramStatus]);

  const handleFavoriteToggle = useCallback(async (productId: string, favorited: boolean) => {
    if (!favorited) {
      setFavorites(prev => prev.filter(f => f.productId !== productId));
      setTotal(prev => prev - 1);
    }
  }, []);

  if (telegramStatus === 'unavailable') {
    return (
      <main className="min-h-screen bg-page px-4 pb-24 pt-6 text-ink sm:px-6 sm:pt-8">
        <div className="mx-auto w-full max-w-5xl">
          <p className="text-center text-sm text-soft">{t('favorites.openInTelegram')}</p>
        </div>
      </main>
    );
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <main className="min-h-screen bg-page bg-cosmic text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-ink">{t('favorites.title')}</h1>
          <p className="mt-1 text-sm text-soft">
            {total === 1
              ? t('favorites.savedCountOne', { total: String(total) })
              : t('favorites.savedCountMany', { total: String(total) })}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-danger/20 bg-danger/5 p-4 text-center text-sm text-danger">
            {error}
          </div>
        ) : favorites.length === 0 ? (
          <EmptyState
            title={t('favorites.emptyTitle')}
            description={t('favorites.emptyDescription')}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
                <path d="M4.318 6.318a4.5 4.5 0 0 0 0 6.364L12 20.364l7.682-7.682a4.5 4.5 0 0 0-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 0 0-6.364 0z" />
              </svg>
            }
            action={<Button href="/store">{t('home.browseStore')}</Button>}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {favorites.map((fav) => (
                <ProductCard
                  key={fav.id}
                  product={{
                    id: fav.product.id,
                    name: fav.product.name,
                    slug: fav.product.slug,
                    description: null,
                    price: fav.product.price,
                    currency: fav.product.currency,
                    imageUrl: fav.product.imageUrl,
                    deliveryType: fav.product.deliveryType,
                    isOutOfStock: fav.product.isOutOfStock,
                    categoryId: fav.product.category?.id ?? '',
                    type: 'DIGITAL_LINK',
                    minimumQuantity: 1,
                    maximumQuantity: null,
                    hideWhenOutOfStock: false,
                    status: fav.product.status,
                    isActive: fav.product.isActive,
                    isFeatured: false,
                    isPopular: false,
                    sortOrder: 0,
                    instructions: null,
                    keywords: [],
                    isHandDelivery: false,
                    createdAt: fav.createdAt,
                    updatedAt: fav.createdAt
                  }}
                  isFavorited={true}
                  onFavoriteToggle={handleFavoriteToggle}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <span className="text-xs text-soft">
                  {t('favorites.pageOf', { page: String(page), totalPages: String(totalPages) })}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-xl border border-line/40 px-4 py-2 text-sm text-soft transition-luxury hover:bg-muted/50 disabled:opacity-40"
                  >
                    {t('favorites.previous')}
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded-xl border border-line/40 px-4 py-2 text-sm text-soft transition-luxury hover:bg-muted/50 disabled:opacity-40"
                  >
                    {t('favorites.next')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
