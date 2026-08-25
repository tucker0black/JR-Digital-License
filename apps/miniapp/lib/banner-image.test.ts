import { describe, expect, it } from 'vitest';
import {
  BANNER_IMAGE_RETRY_DELAYS_MS,
  bannerImageAttemptUrl,
  classifyBannerImage,
  nextBannerImageRetryDelayMs
} from './banner-image';

describe('classifyBannerImage', () => {
  it('treats null/empty/whitespace as "no image configured"', () => {
    expect(classifyBannerImage(null)).toEqual({ hasImage: false, renderUrl: null });
    expect(classifyBannerImage(undefined)).toEqual({ hasImage: false, renderUrl: null });
    expect(classifyBannerImage('')).toEqual({ hasImage: false, renderUrl: null });
    expect(classifyBannerImage('   ')).toEqual({ hasImage: false, renderUrl: null });
  });

  it('passes Cloudinary URLs through unchanged — stored URLs are never rewritten', () => {
    const cloudinary = 'https://res.cloudinary.com/dtz0urit6/image/upload/q_auto:best,f_jpg/folder/assetid';
    expect(classifyBannerImage(cloudinary)).toEqual({ hasImage: true, renderUrl: cloudinary });
  });

  it('normalizes Google Drive share links to direct-render URLs (pure, serve-time only)', () => {
    const result = classifyBannerImage('https://drive.google.com/file/d/DRIVEID123/view?usp=sharing');
    expect(result.hasImage).toBe(true);
    expect(result.renderUrl).toBe('https://drive.google.com/thumbnail?id=DRIVEID123&sz=w1600');
  });

  it('rejects unsafe protocols so they can never reach an <img src>', () => {
    expect(classifyBannerImage('javascript:alert(1)')).toEqual({ hasImage: false, renderUrl: null });
    expect(classifyBannerImage('data:text/html;base64,xxx')).toEqual({ hasImage: false, renderUrl: null });
  });
});

describe('nextBannerImageRetryDelayMs', () => {
  it('returns increasing delays and is bounded', () => {
    expect(nextBannerImageRetryDelayMs(0)).toBe(BANNER_IMAGE_RETRY_DELAYS_MS[0]);
    expect(nextBannerImageRetryDelayMs(1)).toBe(BANNER_IMAGE_RETRY_DELAYS_MS[1]);
    expect(nextBannerImageRetryDelayMs(2)).toBe(BANNER_IMAGE_RETRY_DELAYS_MS[2]);
    expect(nextBannerImageRetryDelayMs(3)).toBeNull();
    expect(nextBannerImageRetryDelayMs(100)).toBeNull();
  });

  it('never schedules retries for invalid input', () => {
    expect(nextBannerImageRetryDelayMs(-1)).toBeNull();
    expect(nextBannerImageRetryDelayMs(1.5)).toBeNull();
    expect(nextBannerImageRetryDelayMs(Number.NaN)).toBeNull();
  });

  it('delays are positive so a failed image recovers without recreating the banner', () => {
    for (const delay of BANNER_IMAGE_RETRY_DELAYS_MS) {
      expect(delay).toBeGreaterThan(0);
    }
  });
});

describe('bannerImageAttemptUrl', () => {
  it('returns the stored URL untouched for the first attempt', () => {
    const url = 'https://res.cloudinary.com/dtz0urit6/image/upload/q_auto:best,f_jpg/folder/assetid';
    expect(bannerImageAttemptUrl(url, 0)).toBe(url);
  });

  it('appends a UI-only cache-buster on retry attempts without destroying query strings', () => {
    const plain = bannerImageAttemptUrl('https://cdn.example.com/a.png', 2);
    expect(plain).toBe('https://cdn.example.com/a.png?_r=2');

    const withQuery = bannerImageAttemptUrl('https://cdn.example.com/a.png?v=1', 3);
    expect(withQuery).toBe('https://cdn.example.com/a.png?v=1&_r=3');
  });
});
