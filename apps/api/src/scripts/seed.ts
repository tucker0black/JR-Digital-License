import crypto from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import { ensureAdminBootstrap } from './admin-bootstrap.js';

export function generateAdminToken(length = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

async function main() {
  const providedToken = process.env.ADMIN_API_TOKEN?.trim();
  const token = providedToken || generateAdminToken();

  const result = await ensureAdminBootstrap(prisma, {
    ...process.env,
    ADMIN_API_TOKEN: token
  });

  if (result.status !== 'synced') {
    if (result.reason === 'MISSING_ADMIN_TELEGRAM_ID') {
      throw new Error('ADMIN_TELEGRAM_ID environment variable is required (numeric Telegram user ID)');
    }
    throw new Error(`Admin bootstrap failed: ${result.reason}`);
  }

  console.log('Seeded roles and permissions.');
  console.log(`Admin ready: telegramId=${result.telegramId} role=SUPER_ADMIN`);
  // The resolved token (configured or generated) is shown exactly once here.
  console.log('=== ADMIN API TOKEN (store securely, shown once) ===');
  console.log(token);
  console.log('=====================================================');
}

main()
  .then(() => {
    return prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
