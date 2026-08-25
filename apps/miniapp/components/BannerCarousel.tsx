'use client';

import Link from 'next/link';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CustomerBanner } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { useBannerImage } from '@/components/use-banner-image';

// The banner artwork canvas: 2048×896 (≈ 2.286:1, identical to 16/7).
const BANNER_ASPECT = 'aspect-[2048/896]';

interface BannerCarouselProps {
  banners: CustomerBanner[];
  autoPlayInterval?: number;
}

function getBannerHref(banner: CustomerBanner): string | null {
  if (banner.buttonDestination) return banner.buttonDestination;
  if (banner.targetType === 'CATEGORY' && banner.targetCategoryId) return `/store/${banner.targetCategoryId}`;
  if (banner.targetType === 'PRODUCT' && banner.targetProductId) return `/product/${banner.targetProductId}`;
  if (banner.targetType === 'PAGE' && banner.targetPage) return banner.targetPage;
  if (banner.targetType === 'PROMOTION') return '/store';
  return null;
}

export const BannerCarousel = memo(function BannerCarousel({
  banners,
  autoPlayInterval = 5000
}: BannerCarouselProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const next = useCallback(() => {
    setCurrent((c) => (c + 1) % banners.length);
  }, [banners.length]);

  const prev = useCallback(() => {
    setCurrent((c) => (c - 1 + banners.length) % banners.length);
  }, [banners.length]);

  useEffect(() => {
    if (banners.length <= 1 || isPaused) return;
    const timer = setInterval(next, autoPlayInterval);
    return () => clearInterval(timer);
  }, [banners.length, isPaused, next, autoPlayInterval]);

  // Touch/swipe behavior unchanged: threshold-based swipe advances the slide.
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) touchStartX.current = touch.clientX;
    setIsPaused(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) touchEndX.current = touch.clientX;
  };

  const handleTouchEnd = () => {
    setIsPaused(false);
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 50) {
      if (diff > 0) next();
      else prev();
    }
  };

  if (banners.length === 0) return null;

  return (
    <div
      className="group relative overflow-hidden rounded-2xl"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className={`relative w-full overflow-hidden ${BANNER_ASPECT}`}>
        {/* GPU-friendly slide track: transform/opacity only */}
        <div
          className="flex h-full transition-transform duration-500 ease-luxury"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {banners.map((banner, index) => {
            const href = getBannerHref(banner);
            return (
              <div key={banner.id} className="h-full w-full shrink-0">
                {href ? (
                  <Link href={href} className="block h-full w-full" tabIndex={index === current ? 0 : -1}>
                    <BannerContent banner={banner} />
                  </Link>
                ) : (
                  <BannerContent banner={banner} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {banners.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            className="absolute left-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white opacity-75 backdrop-blur-sm transition-luxury hover:bg-black/50 hover:opacity-100 active:scale-95 sm:left-2 sm:h-9 sm:w-9 sm:opacity-0 sm:group-hover:opacity-100"
            aria-label={t('banner.previous')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={next}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white opacity-75 backdrop-blur-sm transition-luxury hover:bg-black/50 hover:opacity-100 active:scale-95 sm:right-2 sm:h-9 sm:w-9 sm:opacity-0 sm:group-hover:opacity-100"
            aria-label={t('banner.next')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Dots sit inside enlarged tap targets (~28px) for reliable mobile tapping */}
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center">
            {banners.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrent(i)}
                className="flex h-7 w-7 items-center justify-center"
                aria-label={t('banner.goTo', { index: i + 1 })}
                aria-current={i === current}
              >
                <span
                  className={`block rounded-full transition-all duration-300 ${
                    i === current ? 'h-1.5 w-5 bg-white' : 'h-1.5 w-1.5 bg-white/50'
                  }`}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

function BannerContent({ banner }: { banner: CustomerBanner }) {
  // The stored imageUrl is the single source of truth. A load failure here is
  // a RENDERING state only: it never mutates the banner, and the hook keeps
  // bounded retries so artwork returns automatically once the host serves it.
  const { status, src, markLoaded, markFailed } = useBannerImage(banner.imageUrl);

  // A loaded image IS the complete promotional artwork (branding, promo code,
  // CTA…). The database title/subtitle/button overlay is fallback-only so the
  // artwork is never covered by duplicated text.
  if (status !== 'ok') {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-violet to-accent">
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="relative flex h-full flex-col justify-end p-4 pr-12 sm:p-5">
          <h3 className="text-lg font-bold leading-tight text-white sm:text-xl">{banner.title}</h3>
          {banner.subtitle && (
            <p className="mt-1 text-xs text-white/80 sm:text-sm">{banner.subtitle}</p>
          )}
          {banner.buttonText && (
            <span className="mt-2 inline-flex w-fit items-center rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/30">
              {banner.buttonText}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-violet to-accent">
      {/* Artwork-only state: no text overlay on top of the image. */}
      <img
        src={src ?? undefined}
        alt={banner.title}
        className="absolute inset-0 h-full w-full object-cover"
        width={2048}
        height={896}
        loading="lazy"
        decoding="async"
        onLoad={markLoaded}
        onError={markFailed}
      />
    </div>
  );
}
