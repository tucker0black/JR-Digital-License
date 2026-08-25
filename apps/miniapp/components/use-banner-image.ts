'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bannerImageAttemptUrl,
  classifyBannerImage,
  nextBannerImageRetryDelayMs
} from '@/lib/banner-image';

export type BannerImageStatus = 'no-url' | 'ok' | 'failed';

/**
 * Client-side lifecycle for a single banner image.
 *
 * The database record is NEVER touched here. This hook only manages how the
 * stored imageUrl is rendered:
 * - 'no-url':  no image configured (imageUrl null/empty).
 * - 'ok':      image configured and assumed/known loadable (optimistic first
 *              render so server markup always emits the <img> tag).
 * - 'failed':  the HTTP image request errored. The UI shows its fallback and
 *              the hook keeps bounded, delayed, cache-busted retries so the
 *              same banner recovers automatically once the image host serves
 *              the asset again — without recreating or editing anything.
 *
 * A change of the underlying URL always resets failure state: the new URL is
 * a fresh image that must be given a clean chance to load.
 */
export function useBannerImage(imageUrl: string | null | undefined): {
  status: BannerImageStatus;
  src: string | null;
  markLoaded: () => void;
  markFailed: () => void;
} {
  const { hasImage, renderUrl } = classifyBannerImage(imageUrl);
  const [failed, setFailed] = useState(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    attemptRef.current = 0;
    setFailed(false);
    clearRetryTimer();
    return clearRetryTimer;
  }, [renderUrl, clearRetryTimer]);

  const markLoaded = useCallback(() => {
    clearRetryTimer();
    attemptRef.current = 0;
    setFailed(false);
  }, [clearRetryTimer]);

  const markFailed = useCallback(() => {
    setFailed(true);
    const delay = nextBannerImageRetryDelayMs(attemptRef.current);
    if (delay === null) return;
    clearRetryTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      attemptRef.current += 1;
      setFailed(false);
    }, delay);
  }, [clearRetryTimer]);

  const src = hasImage && renderUrl ? bannerImageAttemptUrl(renderUrl, attemptRef.current) : null;

  const status: BannerImageStatus = !hasImage ? 'no-url' : failed ? 'failed' : 'ok';

  return { status, src, markLoaded, markFailed };
}
