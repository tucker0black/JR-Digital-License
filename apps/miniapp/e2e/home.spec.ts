import { expect, test } from '@playwright/test';

test('renders the Mini App foundation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'JR Digital license' })).toBeVisible();
});
