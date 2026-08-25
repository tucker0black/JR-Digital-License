import Link from 'next/link';
import { memo, useCallback, useState } from 'react';
import type { Product } from '@/lib/api';
import { addFavorite, removeFavorite } from '@/lib/api';
import { Badge } from '@/components/Badge';
import type { CustomerFlashDeal } from '@jr/shared';
import { useTranslation } from '@/lib/i18n';
import { showToast } from '@/components/Toast';

// Locale keys per delivery enum; unknown values fall back to a derived label.
const DELIVERY_LABEL_KEYS: Record<string, string> = {
  DIGITAL_LINK: 'store.deliveryLink',
  DIGITAL_CODE: 'store.deliveryCode',
  DIGITAL_TEXT: 'store.deliveryText',
  DIGITAL_FILE: 'store.deliveryFile',
  DIGITAL_ACCOUNT: 'store.deliveryAccount',
  SMM_API: 'store.deliverySmm'
};

interface ProductCardProps {
  product: Product;
  flashDeal?: CustomerFlashDeal | null;
  isFavorited?: boolean;
  onFavoriteToggle?: (productId: string, favorited: boolean) => void;
  translations?: {
    featured?: string;
    popular?: string;
    outOfStock?: string;
  };
}

export const ProductCard = memo(function ProductCard({ product, flashDeal, isFavorited = false, onFavoriteToggle, translations }: ProductCardProps) {
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);
  const isOutOfStock = product.isOutOfStock === true;
  const deliveryLabelKey = DELIVERY_LABEL_KEYS[product.deliveryType];
  const deliveryLabel = deliveryLabelKey
    ? t(deliveryLabelKey)
    : product.deliveryType.toLowerCase().replace('_', ' ');
  const labels = {
    featured: translations?.featured ?? t('product.featured'),
    popular: translations?.popular ?? t('product.popular'),
    outOfStock: translations?.outOfStock ?? t('product.outOfStock'),
    handDelivery: t('product.handDelivery'),
  };

  const [favLoading, setFavLoading] = useState(false);
  const [favLocal, setFavLocal] = useState(isFavorited);

  const handleFavoriteClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (favLoading) return;
    const nextFav = !favLocal;
    setFavLoading(true);
    setFavLocal(nextFav); // optimistic; reverted below on failure
    try {
      if (nextFav) {
        await addFavorite(product.id);
      } else {
        await removeFavorite(product.id);
      }
      onFavoriteToggle?.(product.id, nextFav);
    } catch {
      setFavLocal(!nextFav); // revert visual state
      showToast(t('product.favoriteError'));
    } finally {
      setFavLoading(false);
    }
  }, [favLocal, favLoading, product.id, onFavoriteToggle, t]);

  const salePrice = flashDeal ? parseFloat(flashDeal.salePrice) : null;
  const originalPrice = parseFloat(product.price);
  const discountPercent = salePrice !== null && originalPrice > 0
    ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
    : 0;

  return (
    <Link
      href={`/product/${product.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl card-cosmic transition-luxury hover:-translate-y-1 hover:shadow-glow active:scale-[0.98]"
    >
      <div className="relative aspect-square overflow-hidden bg-muted/40">
        {product.imageUrl && !imageFailed ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            decoding="async"
            width={600}
            height={600}
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 to-violet/10">
            <span className="text-3xl font-bold text-primary/20">{product.name.charAt(0)}</span>
          </div>
        )}

        {/* Flash Deal Badge */}
        {flashDeal && !isOutOfStock && (
          <div className="absolute left-2.5 top-2.5">
            <Badge tone="red">🔥 {discountPercent}% OFF</Badge>
          </div>
        )}

        {/* Favorite Heart Button — 44px tap target, compact visual chip */}
        <button
          onClick={handleFavoriteClick}
          disabled={favLoading}
          className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center"
          aria-label={favLocal ? t('product.removeFromFavorites') : t('product.addToFavorites')}
        >
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-luxury hover:bg-black/60 ${
              favLoading ? 'opacity-50' : ''
            }`}
          >
            {favLoading ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <svg viewBox="0 0 24 24" fill={favLocal ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" className={`h-4 w-4 ${favLocal ? 'text-red-400' : 'text-white/80'}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            )}
          </span>
        </button>

        <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1">
          {product.isFeatured && <Badge tone="primary">{labels.featured}</Badge>}
          {product.isPopular && <Badge tone="amber">{labels.popular}</Badge>}
          {product.isHandDelivery && <Badge tone="violet">{labels.handDelivery}</Badge>}
        </div>

        {isOutOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <Badge tone="red">{labels.outOfStock}</Badge>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink">{product.name}</h3>
        {product.description && (
          <p className="line-clamp-1 text-xs text-muted-text">{product.description}</p>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="flex shrink-0 items-baseline gap-1.5">
            {salePrice !== null ? (
              <>
                <span className="text-base font-bold tracking-premium text-primary tabular-nums">
                  {product.currency === 'USD' ? '$' : ''}{salePrice.toFixed(2)}
                </span>
                <span className="text-xs text-muted-text line-through tabular-nums">
                  {product.currency === 'USD' ? '$' : ''}{originalPrice.toFixed(2)}
                </span>
              </>
            ) : (
              <span className="text-base font-bold tracking-premium text-ink tabular-nums">
                {product.currency === 'USD' ? '$' : ''}{originalPrice.toFixed(2)}
              </span>
            )}
          </div>
          {/* min-w-0 + truncate keeps the delivery label from colliding with the price at 320px */}
          <span className="ml-auto min-w-0 truncate rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary/80">
            {deliveryLabel}
          </span>
        </div>
      </div>
    </Link>
  );
});
