import { buildApp } from './app.js';
import { prisma } from './infrastructure/prisma.js';
import { ensureAdminBootstrap } from './scripts/admin-bootstrap.js';

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';
const app = buildApp();

const WORKER_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);
const PAYMENT_EXPIRATION_MAX_AGE_MINUTES = Number(process.env.PAYMENT_EXPIRATION_MINUTES ?? 15);

let workerTimer: NodeJS.Timeout | null = null;
let running = false;

async function runExpirationWorker(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { PaymentExpirationService } = await import('./services/payment/payment-expiration.service.js');
    const service = new PaymentExpirationService(prisma);
    const result = await service.expireOldPayments(PAYMENT_EXPIRATION_MAX_AGE_MINUTES);
    if (result.expiredCount > 0) {
      app.log.info({ expiredCount: result.expiredCount }, 'Expired overdue payment sessions');
    }
  } catch (error) {
    app.log.error({ err: error }, 'Payment expiration worker failed');
  } finally {
    running = false;
  }
}

/**
 * Verify database connectivity before serving traffic. Prisma connects
 * lazily, so without this check the API can report healthy while every
 * database-backed endpoint fails. Failures are logged without secrets and
 * the process exits so the container restart policy surfaces the outage.
 */
async function waitForDatabase(): Promise<void> {
  const maxAttempts = Number(process.env.DB_READY_MAX_ATTEMPTS ?? 10);
  const delayMs = Number(process.env.DB_READY_DELAY_MS ?? 3000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      app.log.info({ attempt }, 'Database connection verified');
      return;
    } catch (error) {
      const err = error as { name?: string; code?: string };
      app.log.error(
        { attempt, maxAttempts, errorName: err.name ?? 'UnknownError', errorCode: err.code ?? null },
        'Database not ready yet'
      );
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  app.log.error(
    'Database unreachable after retries. Check DATABASE_URL and that the PostgreSQL service is running. Exiting.'
  );
  process.exit(1);
}

/**
 * Synchronize the SUPER_ADMIN bootstrap record from configured environment
 * variables so a rotated ADMIN_API_TOKEN always matches the stored hash
 * after deploy/restart. Runs only when both admin env vars are present;
 * failures never block serving traffic. Never logs secrets.
 */
async function syncEnvAdmin(): Promise<void> {
  try {
    const result = await ensureAdminBootstrap(prisma);
    if (result.status === 'synced') {
      app.log.info(
        { telegramId: result.telegramId.toString(), role: 'SUPER_ADMIN' },
        'Admin bootstrap record synchronized from environment'
      );
    } else {
      app.log.warn({ reason: result.reason }, 'Admin bootstrap synchronization skipped');
    }
  } catch (error) {
    app.log.error({ err: error }, 'Admin bootstrap synchronization failed');
  }
}

async function start(): Promise<void> {
  try {
    await waitForDatabase();
    await syncEnvAdmin();
    await app.listen({ port, host });
    if (WORKER_INTERVAL_MS > 0) {
      workerTimer = setInterval(() => void runExpirationWorker(), WORKER_INTERVAL_MS);
      workerTimer.unref();
      app.log.info({ intervalMs: WORKER_INTERVAL_MS }, 'Payment expiration worker started');
    }
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

function shutdown(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  void prisma.$disconnect();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

void start();
