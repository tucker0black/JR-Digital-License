import { test, expect } from '@playwright/test';

test.describe('Customer Top-Up Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'JR Digital license' })).toBeVisible({ timeout: 10000 });
  });

  test('Home page loads and shows Top Up quick action', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Top Up' })).toBeVisible();
  });

  test('Home → Top Up opens game selection', async ({ page }) => {
    await page.getByRole('link', { name: 'Top Up' }).click();
    await expect(page).toHaveURL('/topup');
    
    // Should show game selection, not auto-select Free Fire
    await expect(page.getByText('Choose a game to top up')).toBeVisible({ timeout: 5000 });
    
    // Should NOT show Free Fire packages automatically
    await expect(page.getByText('Free Fire packages')).not.toBeVisible({ timeout: 2000 });
    await expect(page.getByText('86 Diamonds')).not.toBeVisible({ timeout: 2000 });
  });

  test('Store → Top Up category opens same game selection', async ({ page }) => {
    await page.getByRole('link', { name: 'Store' }).click();
    await expect(page).toHaveURL('/store');
    
    // Click Top Up category
    await page.getByRole('link', { name: 'Top Up' }).click();
    
    // Should redirect to /topup with game selection
    await expect(page).toHaveURL('/topup');
    await expect(page.getByText('Choose a game to top up')).toBeVisible({ timeout: 5000 });
  });

  test('Game selection shows all active games from Admin', async ({ page }) => {
    await page.goto('/topup');
    await expect(page.getByText('Choose a game to top up')).toBeVisible({ timeout: 5000 });
    
    // Should show at least one game card
    const gameCards = page.locator('button:has-text("Tap to view packages")');
    await expect(gameCards.first()).toBeVisible();
  });

  test('Selecting a game shows only its packages', async ({ page }) => {
    await page.goto('/topup');
    await expect(page.getByText('Choose a game to top up')).toBeVisible({ timeout: 5000 });
    
    // Click first game card
    const firstGameCard = page.locator('button:has-text("Tap to view packages")').first();
    const gameName = await firstGameCard.locator('span').nth(1).textContent();
    
    await firstGameCard.click();
    
    // Should show game name in header
    await expect(page.getByText(gameName || '')).toBeVisible();
    
    // Should show packages, not other games
    await expect(page.getByText('package')).toBeVisible({ timeout: 5000 });
    
    // Change game
    await page.getByRole('button', { name: '← Change Game' }).click();
    await expect(page.getByText('Choose a game to top up')).toBeVisible();
  });

  test('Different games show different packages', async ({ page }) => {
    await page.goto('/topup');
    await expect(page.getByText('Choose a game to top up')).toBeVisible({ timeout: 5000 });
    
    const gameCards = page.locator('button:has-text("Tap to view packages")');
    const gameCount = await gameCards.count();
    
    if (gameCount > 1) {
      // Get first game name
      await gameCards.nth(0).click();
      
      // Get package names for first game
      const firstPackages = page.locator('button:has-text("Diamonds")');
      const firstPackageNames: (string | null)[] = [];
      const firstPackageCount = await firstPackages.count();
      for (let i = 0; i < firstPackageCount; i++) {
        const name = await firstPackages.nth(i).locator('span').nth(1).textContent();
        firstPackageNames.push(name);
      }
      
      // Go back
      await page.getByRole('button', { name: '← Change Game' }).click();
      await expect(page.getByText('Choose a game to top up')).toBeVisible();
      
      // Get second game
      await gameCards.nth(1).click();
      
      // Get package names for second game
      const secondPackages = page.locator('button:has-text("Diamonds")');
      const secondPackageNames: (string | null)[] = [];
      const secondPackageCount = await secondPackages.count();
      for (let i = 0; i < secondPackageCount; i++) {
        const name = await secondPackages.nth(i).locator('span').nth(1).textContent();
        secondPackageNames.push(name);
      }
      
      // Package names should differ
      const hasDifference = firstPackageNames.some(name => !secondPackageNames.includes(name)) ||
                           secondPackageNames.some(name => !firstPackageNames.includes(name));
      expect(hasDifference).toBeTruthy();
    }
  });

  test('Player ID field shown when required by game config', async ({ page }) => {
    await page.goto('/topup');
    await page.locator('button:has-text("Tap to view packages")').first().click();
    await page.locator('button:has-text("Diamonds")').first().click();
    
    // Player ID should be required for provider-linked packages
    await expect(page.getByLabel('Player ID / UID *')).toBeVisible();
  });

  test('Mobile viewport - no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/topup');
    
    // Check no horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(360);
    
    // Check elements are visible
    await expect(page.getByText('Choose a game to top up')).toBeVisible();
  });

  test('No console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.goto('/topup');
    await page.waitForLoadState('networkidle');
    
    // Filter out known non-critical errors
    const criticalErrors = errors.filter(e => 
      !e.includes('favicon') && 
      !e.includes('manifest') &&
      !e.includes('Extension')
    );
    
    expect(criticalErrors).toEqual([]);
  });

  test('API responses - no 4xx/5xx on game load', async ({ page }) => {
    const failedRequests: string[] = [];
    page.on('response', response => {
      if (response.status() >= 400) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });
    
    await page.goto('/topup');
    await page.waitForLoadState('networkidle');
    
    expect(failedRequests).toEqual([]);
  });
});