import type { Category } from './api';

// Canonical slugs identifying the Top-Up category. Mirrors the redirect
// convention in /store/[slug]; the admin dashboard links banners to the
// category UUID, which the Mini App resolves through these slugs.
export const TOP_UP_CATEGORY_SLUGS = ['topup', 'top-up'];

export function findTopUpCategory(categories: Category[]): Category | undefined {
  return categories.find((category) => TOP_UP_CATEGORY_SLUGS.includes(category.slug));
}
