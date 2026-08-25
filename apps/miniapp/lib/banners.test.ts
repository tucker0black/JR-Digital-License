import { describe, expect, it } from 'vitest';
import { TOP_UP_CATEGORY_SLUGS, findTopUpCategory } from './banners';
import type { Category } from './api';

function makeCategory(overrides: Partial<Category> & Pick<Category, 'id' | 'slug'>): Category {
  return {
    name: overrides.id,
    description: null,
    icon: null,
    imageUrl: null,
    isActive: true,
    isArchived: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

const topUpCategory = makeCategory({ id: 'topup-id', slug: 'topup', name: 'TopUp' });
const otherCategories = [
  makeCategory({ id: 'ai-id', slug: 'artificial-intelligence-ai', name: 'Artificial Intelligence (AI)' }),
  makeCategory({ id: 'vpn-id', slug: 'vpn', name: 'VPN' })
];

describe('findTopUpCategory (banner targeting resolution)', () => {
  it('resolves the canonical "topup" slug to its category id', () => {
    expect(findTopUpCategory([...otherCategories, topUpCategory])).toMatchObject({ id: 'topup-id' });
  });

  it('also accepts the "top-up" spelling used by legacy store links', () => {
    const hyphenated = makeCategory({ id: 'top-up-id', slug: 'top-up', name: 'TopUp' });
    expect(findTopUpCategory([...otherCategories, hyphenated])).toMatchObject({ id: 'top-up-id' });
  });

  it('does not match unrelated categories', () => {
    expect(findTopUpCategory(otherCategories)).toBeUndefined();
  });

  it('returns nothing when no categories exist yet', () => {
    expect(findTopUpCategory([])).toBeUndefined();
  });

  it('keeps both accepted slugs in one shared source of truth', () => {
    expect(TOP_UP_CATEGORY_SLUGS).toEqual(['topup', 'top-up']);
  });
});
