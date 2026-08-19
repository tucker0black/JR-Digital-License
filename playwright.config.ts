import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/miniapp/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'corepack pnpm --filter @jr/miniapp dev',
    url: 'http://127.0.0.1:3001/admin/login',
    reuseExistingServer: true
  }
});
