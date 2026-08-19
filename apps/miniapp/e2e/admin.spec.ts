import { expect, test } from '@playwright/test';

const adminToken = process.env.ADMIN_E2E_TOKEN;

test('redirects visitors without an admin token away from the dashboard', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('redirects visitors without an admin token away from admin sections', async ({ page }) => {
  await page.goto('/admin/products');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('renders the admin login page', async ({ page }) => {
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: 'JR Digital license' })).toBeVisible();
  await expect(page.getByPlaceholder('Paste your admin API token')).toBeVisible();
});

test.skip(!adminToken, 'ADMIN_E2E_TOKEN not set');

test('logs in with a valid admin token and renders the dashboard', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByPlaceholder('Paste your admin API token').fill(adminToken as string);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});