import { describe, expect, it } from 'vitest';
import { appName, createProductRequestSchema, healthResponseSchema, normalizeBannerImageUrl, productSchema } from './index.js';

describe('shared foundation', () => {
  it('exposes the official application name', () => {
    expect(appName).toBe('JR Digital license');
  });

  it('validates the health response contract', () => {
    expect(
      healthResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        timestamp: '2026-01-01T00:00:00.000Z'
      }).success
    ).toBe(true);
  });

  it('allows an unconfigured product maximum quantity', () => {
    expect(productSchema.shape.maximumQuantity.safeParse(null).success).toBe(true);
    expect(createProductRequestSchema.shape.maximumQuantity.safeParse(null).success).toBe(true);
  });
});

describe('normalizeBannerImageUrl', () => {
  it('normalizes Google Drive sharing URLs to direct-render URLs', () => {
    expect(
      normalizeBannerImageUrl('https://drive.google.com/file/d/1LrHPSiTIidTzRYYNmhQPucn5qb84k7O1/view?usp=sharing')
    ).toBe('https://drive.google.com/thumbnail?id=1LrHPSiTIidTzRYYNmhQPucn5qb84k7O1&sz=w1600');
  });

  it('normalizes Drive /open?id= links', () => {
    expect(normalizeBannerImageUrl('https://drive.google.com/open?id=ABC123_-')).toBe(
      'https://drive.google.com/thumbnail?id=ABC123_-&sz=w1600'
    );
  });

  it('normalizes Drive /uc?id= variants idempotently', () => {
    const direct = 'https://drive.google.com/thumbnail?id=FILE_9&sz=w1600';
    expect(normalizeBannerImageUrl(direct)).toBe(direct);
    expect(normalizeBannerImageUrl('https://drive.google.com/uc?export=view&id=FILE_9')).toBe(direct);
    expect(normalizeBannerImageUrl('https://drive.google.com/uc?id=FILE_9')).toBe(direct);
  });

  it('leaves normal public HTTPS image URLs untouched', () => {
    const url = 'https://cdn.example.com/images/banner.png?a=1';
    expect(normalizeBannerImageUrl(url)).toBe(url);
  });

  it('does not transform arbitrary hosts that merely mention drive', () => {
    const url = 'https://evil.example.com/file/d/SECRET/view';
    expect(normalizeBannerImageUrl(url)).toBe(url);
  });

  it('passes through relative paths, empty values, and junk safely', () => {
    expect(normalizeBannerImageUrl('/images/banner.png')).toBe('/images/banner.png');
    expect(normalizeBannerImageUrl(null)).toBeNull();
    expect(normalizeBannerImageUrl('')).toBeNull();
    expect(normalizeBannerImageUrl(undefined)).toBeNull();
    expect(normalizeBannerImageUrl('   ')).toBeNull();
    expect(normalizeBannerImageUrl('not a url')).toBe('not a url');
  });

  it('rejects malformed Drive file ids instead of guessing', () => {
    expect(normalizeBannerImageUrl('https://drive.google.com/file/d/bad id/view')).toBe(
      'https://drive.google.com/file/d/bad id/view'
    );
  });

  it('passes Cloudinary delivery URLs with a plain public id through unchanged', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    expect(normalizeBannerImageUrl(url)).toBe(url);
  });

  it('keeps Cloudinary transformations and folders intact (q_auto:best,f_jpg)', () => {
    const url =
      'https://res.cloudinary.com/dtz0urit6/image/upload/q_auto:best,f_jpg/cloudinary-tools-uploads/example.jpg';
    expect(normalizeBannerImageUrl(url)).toBe(url);
  });

  it('keeps reordered Cloudinary transformation combinations intact', () => {
    const url = 'https://res.cloudinary.com/dtz0urit6/image/upload/f_auto,q_auto/w_1200,h_600,c_fill/folder/example.png';
    expect(normalizeBannerImageUrl(url)).toBe(url);
  });

  it('keeps Cloudinary nested folder paths intact', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/q_auto:best,banners/nested/deep/asset_name-1.jpg';
    expect(normalizeBannerImageUrl(url)).toBe(url);
  });

  it('rejects unsafe protocols instead of passing them to <img>', () => {
    expect(normalizeBannerImageUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBannerImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(normalizeBannerImageUrl('file:///C:/Windows/system32/config')).toBeNull();
    expect(normalizeBannerImageUrl('vbscript:msgbox(1)')).toBeNull();
  });
});
