import { normalizeBannerImageUrl } from '@jr/shared';

/**
 * Classification of a banner's stored image URL. The database is the source
 * of truth: "no image configured" (imageUrl null/empty) is a fundamentally
 * different state from "image configured but the host currently returns an
 * error" (imageUrl present, HTTP failure). Neither state ever justifies a
 * write to the banner record.
 */
export interface BannerImageClassification {
  hasImage: boolean;
  renderUrl: string | null;
}

export function classifyBannerImage(url: string | null | undefined): BannerImageClassification {
  const renderUrl = normalizeBannerImageUrl(url);
  return { hasImage: Boolean(renderUrl), renderUrl };
}

/**
 * Bounded, increasing UI-only retry delays (ms) for a banner image that
 * failed to load. Retrying lets an existing banner recover automatically —
 * e.g. when a CDN edge 404s transiently or the host comes back — without any
 * database mutation and without recreating the banner. `null` means no more
 * automatic retries; recovery then happens on the next url change or remount.
 */
export const BANNER_IMAGE_RETRY_DELAYS_MS = [5_000, 15_000, 60_000] as const;

export function nextBannerImageRetryDelayMs(failureCount: number): number | null {
  if (!Number.isInteger(failureCount) || failureCount < 0) return null;
  const delay = BANNER_IMAGE_RETRY_DELAYS_MS[failureCount] as number | undefined;
  return delay === undefined ? null : delay;
}

/**
 * Cache-busting render URL used for retry attempts only. The parameter is
 * never persisted: it exists solely so a recovering <img> bypasses a cached
 * failed response in the browser.
 */
export function bannerImageAttemptUrl(renderUrl: string, attempt: number): string {
  if (attempt <= 0) return renderUrl;
  const separator = renderUrl.includes('?') ? '&' : '?';
  return `${renderUrl}${separator}_r=${attempt}`;
}
