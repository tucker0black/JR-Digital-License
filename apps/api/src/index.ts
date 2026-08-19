import { buildApp } from './app.js';
import { prisma } from './infrastructure/prisma.js';

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

async function start(): Promise<void> {
  try {
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
