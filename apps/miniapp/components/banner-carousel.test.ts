import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BannerCarousel } from './BannerCarousel';
import type { CustomerBanner } from '@/lib/api';

const baseBanner: CustomerBanner = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '5% OFF STOREWIDE',
  subtitle: 'Use code BESTJR and save 5% on your order',
  imageUrl: null,
  buttonText: 'SHOP NOW',
  buttonDestination: null,
  targetType: 'HOME',
  targetCategoryId: null,
  targetProductId: null,
  targetPage: null
};

function renderCarousel(banners: CustomerBanner[]): string {
  return renderToStaticMarkup(createElement(BannerCarousel, { banners }));
}

describe('BannerCarousel rendering', () => {
  it('renders a valid image as artwork-only with no title/subtitle/button overlay', () => {
    const html = renderCarousel([
      { ...baseBanner, imageUrl: 'https://res.cloudinary.com/demo/image/upload/banner.png', buttonDestination: '/store' }
    ]);

    expect(html).toContain('<img');
    expect(html).toContain('https://res.cloudinary.com/demo/image/upload/banner.png');
    // Cloudinary/HTTPS URLs pass through normalization untouched.
    expect(html).not.toContain('thumbnail?id=');
    // The database text must NOT be drawn on top of the artwork…
    expect(html).not.toContain('<h3');
    expect(html).not.toContain('>5% OFF STOREWIDE<');
    expect(html).not.toContain('Use code BESTJR and save 5% on your order</p>');
    expect(html).not.toContain('>SHOP NOW<');
    // …and the whole banner keeps the existing click destination.
    expect(html).toContain('href="/store"');
    expect(html).toContain('aspect-[2048/896]');
  });

  it('normalizes Google Drive share URLs and still renders artwork-only', () => {
    const html = renderCarousel([
      { ...baseBanner, imageUrl: 'https://drive.google.com/file/d/DRIVEID123/view?usp=sharing' }
    ]);
    // `&` is HTML-escaped inside rendered attributes.
    expect(html).toContain('https://drive.google.com/thumbnail?id=DRIVEID123&amp;sz=w1600');
    expect(html).toContain('<img');
    expect(html).not.toContain('<h3');
  });

  it('falls back to gradient + title/subtitle/button when there is no image', () => {
    const html = renderCarousel([baseBanner]);
    expect(html).not.toContain('<img');
    expect(html).toContain('<h3');
    expect(html).toContain('5% OFF STOREWIDE');
    expect(html).toContain('Use code BESTJR and save 5% on your order');
    expect(html).toContain('SHOP NOW');
  });

  it('keeps multiple banners, dots, arrows, and per-banner destinations', () => {
    const html = renderCarousel([
      { ...baseBanner, id: '22222222-2222-4222-8222-222222222222', imageUrl: 'https://cdn.example.com/a.png' },
      {
        ...baseBanner,
        id: '33333333-3333-4333-8333-333333333333',
        subtitle: null,
        buttonText: null,
        targetType: 'PROMOTION'
      }
    ]);
    expect(html).toContain('https://cdn.example.com/a.png');
    // Second banner has no image -> its fallback text is expected.
    expect(html).toContain('<h3');
    // Carousel chrome for >1 banner.
    expect(html).toContain('aria-label="Previous banner"');
    expect(html).toContain('aria-label="Next banner"');
    expect((html.match(/aria-label="Go to banner/g) ?? []).length).toBe(2);
    // PROMOTION target falls back to /store navigation.
    expect(html).toContain('href="/store"');
  });

  it('renders a single banner without arrows or dots', () => {
    const html = renderCarousel([baseBanner]);
    expect(html).not.toContain('aria-label="Previous banner"');
    expect(html).not.toContain('aria-label="Next banner"');
    expect(html).not.toContain('aria-label="Go to banner');
  });

  it('links a CATEGORY/TopUp banner to its category page when no destination is set', () => {
    const html = renderCarousel([
      { ...baseBanner, targetType: 'CATEGORY', targetCategoryId: '41235c89-a91e-4115-a6cf-f4216c6cf1c2' }
    ]);
    expect(html).toContain('href="/store/41235c89-a91e-4115-a6cf-f4216c6cf1c2"');
  });

  it('renders nothing when the banner list is empty', () => {
    expect(renderCarousel([])).toBe('');
  });
});
