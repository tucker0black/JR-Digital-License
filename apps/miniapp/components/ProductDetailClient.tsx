'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Product } from '@/lib/api';
import { getProductFlashDeal, addFavorite, removeFavorite, checkFavorite } from '@/lib/api';
import type { CustomerFlashDeal } from '@jr/shared';
import { useTranslation } from '@/lib/i18n';

interface ProductDetailClientProps {
  product: Product;
  children: React.ReactNode;
}

function getTimeRemaining(endsAt: string | null): { hours: number; minutes: number; seconds: number } | null {
  if (!endsAt) return null;
  const now = Date.now();
  const end = new Date(endsAt).getTime();
  const diff = end - now;
  if (diff <= 0) return null;
  return {
    hours: Math.floor(diff / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000)
  };
}

export function ProductDetailClient({ product, children }: ProductDetailClientProps) {
  const { t } = useTranslation();
  const [flashDeal, setFlashDeal] = useState<CustomerFlashDeal | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() => flashDeal?.endsAt ? getTimeRemaining(flashDeal.endsAt) : null);

  useEffect(() => {
    let cancelled = false;
    void getProductFlashDeal(product.slug).then((result) => {
      if (!cancelled) {
        setFlashDeal(result.deal);
        if (result.deal?.endsAt) {
          setTimeLeft(getTimeRemaining(result.deal.endsAt));
        }
      }
    }).catch(() => {});
    void checkFavorite(product.id).then((result) => {
      if (!cancelled) setIsFavorited(result.isFavorited);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [product.id, product.slug]);

  useEffect(() => {
    if (!flashDeal?.endsAt) return;
    const interval = setInterval(() => {
      setTimeLeft(getTimeRemaining(flashDeal.endsAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [flashDeal?.endsAt]);

  const handleFavoriteToggle = useCallback(async () => {
    if (favLoading) return;
    setFavLoading(true);
    try {
      if (isFavorited) {
        await removeFavorite(product.id);
        setIsFavorited(false);
      } else {
        await addFavorite(product.id);
        setIsFavorited(true);
      }
    } catch { /* ignore */ }
    finally { setFavLoading(false); }
  }, [isFavorited, favLoading, product.id]);

  const salePrice = flashDeal ? parseFloat(flashDeal.salePrice) : null;
  const originalPrice = parseFloat(product.price);
  const discountPercent = salePrice !== null && originalPrice > 0
    ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
    : 0;

  return (
    <>
      {/* Flash Deal Banner */}
      {flashDeal && (
        <div className="mb-5 rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-500/10 to-orange-500/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/20 text-2xl">
                🔥
              </div>
              <div>
                <p className="text-sm font-bold text-red-400">{t('product.flashDealBanner', { percent: discountPercent })}</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xl font-bold text-primary">
                    {product.currency === 'USD' ? '$' : ''}{salePrice?.toFixed(2)}
                  </span>
                  <span className="text-sm text-muted-text line-through">
                    {product.currency === 'USD' ? '$' : ''}{originalPrice.toFixed(2)}
                  </span>
                  <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-400">
                    {t('product.flashDealSave', { percent: discountPercent })}
                  </span>
                </div>
              </div>
            </div>
            {timeLeft && (
              <div className="text-right">
                <p className="text-xs text-soft">{t('product.flashDealEndsIn')}</p>
                <div className="mt-1 flex items-center gap-1">
                  {timeLeft.hours > 0 && (
                    <span className="rounded-lg bg-surface/80 px-2 py-1 text-sm font-bold tabular-nums text-ink">
                      {String(timeLeft.hours).padStart(2, '0')}
                    </span>
                  )}
                  {timeLeft.hours > 0 && <span className="text-xs text-soft">:</span>}
                  <span className="rounded-lg bg-surface/80 px-2 py-1 text-sm font-bold tabular-nums text-ink">
                    {String(timeLeft.minutes).padStart(2, '0')}
                  </span>
                  <span className="text-xs text-soft">:</span>
                  <span className="rounded-lg bg-surface/80 px-2 py-1 text-sm font-bold tabular-nums text-ink">
                    {String(timeLeft.seconds).padStart(2, '0')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Favorite Button */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={handleFavoriteToggle}
          disabled={favLoading}
          className="inline-flex items-center gap-2 rounded-xl border border-line/40 px-4 py-2.5 text-sm font-medium text-soft transition-luxury hover:bg-muted/50 hover:text-ink disabled:opacity-50"
        >
          {favLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-primary" />
          ) : (
            <svg viewBox="0 0 24 24" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" className={`h-4 w-4 ${isFavorited ? 'text-red-400' : ''}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          )}
          {isFavorited ? t('product.favorited') : t('product.addToFavorites')}
        </button>
      </div>

      {children}
    </>
  );
}
