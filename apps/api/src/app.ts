import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { appName, customerIdFromTelegramId, normalizeBannerImageUrl, normalizeSupportedLanguage } from '@jr/shared';
import type { ProductStatus, OrderStatus, PaymentStatus, DeliveryType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { PaymentProvider as PrismaPaymentProvider, UserStatus, SupportTicketStatus, SmmProviderStatus, SmmServiceStatus, TopUpProviderStatus, TopUpProviderServiceStatus, SecurityEventSeverity } from '@prisma/client';
import { prisma } from './infrastructure/prisma.js';
import { authenticateTelegramUser } from './middleware/auth.js';
import { authenticateAdmin, requireAdmin } from './middleware/admin-auth.js';
import { StockService } from './services/stock.service.js';
import { FulfillmentService } from './services/fulfillment.service.js';
import { CustomerWalletService } from './services/wallet.service.js';
import { CustomerStatsService } from './services/customer-stats.service.js';
import { CustomerTicketService } from './services/ticket.service.js';
import { SupportAvailabilityService } from './services/support-hours.service.js';
import { SecurityService } from './services/security.service.js';
import { PaymentService, DefaultPaymentProviderFactory } from './services/payment/index.js';
import { TelegramNotificationService } from './services/notifications/telegram-notification.service.js';
import { ProductService, CategoryService, OrderService, DashboardService, AuditService, AdminUserService, AdminWalletService, AdminTicketService, AdminSettingsService, AdminPaymentService, AdminTopUpService, type CreateProductInput, type UpdateProductInput, type CreateCategoryInput, type UpdateCategoryInput } from './services/admin/index.js';
import { SmmService, DefaultSmmProviderFactory } from './services/smm/index.js';
import { SmmAdminService } from './services/smm/smm-admin.service.js';
import { TopUpService } from './services/topup/index.js';
import { MediaService } from './services/media.service.js';
import { decryptInventoryValue } from './utils/encryption.js';
import { effectiveProductPrice, evaluateCoupon, type PricingCoupon } from './services/pricing.service.js';

const CUSTOMER_FORBIDDEN_FIELDS = [
  'costPrice',
  'markup',
  'stock',
  'stockCount',
  'variants',
  'smmServices',
  'provider',
  'providerId',
  'providerServiceId',
  'providerOfferId',
  'providerCost',
  'gameObj'
] as const;

function sanitizeProductForCustomer<T extends Record<string, unknown>>(product: T): Omit<T, (typeof CUSTOMER_FORBIDDEN_FIELDS)[number]> {
  const sanitized = { ...product };
  for (const field of CUSTOMER_FORBIDDEN_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

interface CustomerTopUpGameConfig {
  requirePlayerId: boolean;
  requireServerId: boolean;
  playerIdValidation: 'NUMERIC' | 'TEXT';
  serverIdValidation: 'NUMERIC' | 'TEXT';
  verificationEnabled: boolean;
  customerNote: string | null;
  customFields: Array<{ key: string; label: string; required: boolean; placeholder?: string }>;
}

// Returns the customer input configuration for a game. When no config row
// exists, fall back to the legacy default: player ID is required only when
// the game's packages are provider-linked.
async function getTopUpGameConfigForCustomer(db: typeof prisma, gameId: string): Promise<CustomerTopUpGameConfig | null> {
  const config = await db.topUpGameConfig.findUnique({ where: { gameId } });
  if (!config) return null;

  return {
    requirePlayerId: config.requirePlayerId,
    requireServerId: config.requireServerId,
    playerIdValidation: config.playerIdValidation as 'NUMERIC' | 'TEXT',
    serverIdValidation: config.serverIdValidation as 'NUMERIC' | 'TEXT',
    verificationEnabled: config.verificationEnabled,
    customerNote: config.customerNote,
    customFields: Array.isArray(config.customFields) ? (config.customFields as CustomerTopUpGameConfig['customFields']) : []
  };
}

function sanitizeTopUpPackageForCustomer(packageRow: {
  id: string;
  gameId: string;
  name: string;
  diamondAmount: number;
  content: string | null;
  price: Prisma.Decimal;
  currency: string;
  providerId: string | null;
  isActive: boolean;
  sortOrder: number;
  icon: string | null;
  imageUrl: string | null;
  customerNote: string | null;
  noteColor: string;
  createdAt: Date;
  updatedAt: Date;
  game?: { name: string } | null;
}) {
  return {
    id: packageRow.id,
    gameId: packageRow.gameId,
    game: packageRow.game?.name ?? '',
    name: packageRow.name,
    diamondAmount: packageRow.diamondAmount,
    content: packageRow.content,
    price: packageRow.price.toString(),
    currency: packageRow.currency,
    isActive: packageRow.isActive,
    sortOrder: packageRow.sortOrder,
    icon: packageRow.icon,
    imageUrl: packageRow.imageUrl,
    customerNote: packageRow.customerNote,
    noteColor: packageRow.noteColor,
    requiresPlayerId: packageRow.providerId !== null,
    createdAt: packageRow.createdAt,
    updatedAt: packageRow.updatedAt
  };
}

function serializeCustomerOrder(order: {
  id: string;
  orderNumber: number;
  status: string;
  currency: string;
  subtotal: { toString(): string };
  discount: { toString(): string };
  total: { toString(): string };
  expiresAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    productId: string | null;
    productNameSnapshot: string;
    unitPriceSnapshot: { toString(): string };
    quantitySnapshot: number;
    totalSnapshot: { toString(): string };
    currencySnapshot: string;
    deliveryTypeSnapshot: string;
    target: string | null;
    serverId?: string | null;
    fulfillment?: {
      status: string;
      deliveredAt?: Date | null;
    } | null;
    deliveryValue?: string | null;
    deliveryValues?: string[];
    manualDelivery?: {
      title: string;
      content: string;
      deliveredAt: string;
    } | null;
  }>;
}) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    subtotal: order.subtotal.toString(),
    discount: order.discount.toString(),
    total: order.total.toString(),
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      unitPriceSnapshot: item.unitPriceSnapshot.toString(),
      quantitySnapshot: item.quantitySnapshot,
      totalSnapshot: item.totalSnapshot.toString(),
      currencySnapshot: item.currencySnapshot,
      deliveryTypeSnapshot: item.deliveryTypeSnapshot,
      target: item.target,
      serverId: item.serverId ?? null,
      fulfillment: item.fulfillment
        ? {
            status: item.fulfillment.status,
            deliveredAt: item.fulfillment.deliveredAt ?? null
          }
        : null,
      deliveryValue: item.deliveryValue ?? null,
      deliveryValues: item.deliveryValues ?? [],
      manualDelivery: item.manualDelivery ?? null
    }))
  };
}

export function buildApp() {
  // trustProxy is enabled so request.ip honors the X-Forwarded-For header set
  // by the Next.js reverse proxy in front of the API. The API only ever uses
  // the server-derived IP; client-supplied headers are never trusted directly.
  const app = Fastify({ logger: true, trustProxy: true });
  const stockService = new StockService(prisma);
  const smmService = new SmmService(prisma, new DefaultSmmProviderFactory());
  const topUpService = new TopUpService(prisma);
  const fulfillmentService = new FulfillmentService(prisma, stockService, smmService, topUpService);
  const walletService = new CustomerWalletService(prisma);
  const customerStatsService = new CustomerStatsService(prisma);
  const supportAvailabilityService = new SupportAvailabilityService();
  const customerTicketService = new CustomerTicketService(prisma, supportAvailabilityService);
  const securityService = new SecurityService(prisma);
  const notificationService = new TelegramNotificationService(undefined, undefined, prisma);
  const paymentService = new PaymentService(
    prisma,
    new DefaultPaymentProviderFactory(),
    walletService,
    notificationService
  );
  const productService = new ProductService(prisma);
  const categoryService = new CategoryService(prisma);
  const orderService = new OrderService(prisma, walletService);
  const dashboardService = new DashboardService(prisma);
  const auditService = new AuditService(prisma);
  const smmAdminService = new SmmAdminService(prisma);
  const adminUserService = new AdminUserService(prisma);
  const adminWalletService = new AdminWalletService(prisma);
  const adminTicketService = new AdminTicketService(prisma);
  const adminSettingsService = new AdminSettingsService(prisma);
  const adminPaymentService = new AdminPaymentService(prisma);
  const adminTopUpService = new AdminTopUpService(prisma);
  const mediaService = new MediaService(prisma);

  async function notifyCustomerDelivery(orderId: string): Promise<void> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: { select: { telegramId: true } },
          items: true
        }
      });
      if (!order || order.status !== 'COMPLETED') return;
      await notificationService.sendOrderDeliveredMessage({
        chatId: order.user.telegramId.toString(),
        orderNumber: order.orderNumber,
        items: order.items.map((item) => ({
          productName: item.productNameSnapshot,
          quantity: item.quantitySnapshot
        })),
        total: order.total.toString(),
        currency: order.currency
      });
    } catch (error) {
      console.error('Failed to send delivery notification.', error);
    }
  }

  async function fulfillOrderAndNotify(orderId: string): Promise<Awaited<ReturnType<typeof fulfillmentService.fulfillOrder>>> {
    const result = await fulfillmentService.fulfillOrder(orderId);
    if (result.success) {
      const completedOrder = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true }
      });
      if (completedOrder?.status === 'COMPLETED') {
        void notifyCustomerDelivery(orderId);
      }
    }

    if (result.success) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: { select: { isHandDelivery: true } } } },
          user: { select: { username: true, firstName: true } }
        }
      });
      if (order && order.items.some((item) => item.product?.isHandDelivery) && order.status !== 'COMPLETED') {
        void notificationService.sendHandDeliveryOrderNotification({
          orderNumber: order.orderNumber,
          items: order.items.map((item) => ({
            productName: item.productNameSnapshot,
            quantity: item.quantitySnapshot
          })),
          total: order.total.toString(),
          currency: order.currency,
          customerUsername: order.user.username,
          customerFirstName: order.user.firstName
        });
      }
    }

    return result;
  }

  void app.register(cors, {
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, false);
        return;
      }
      const allowed = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

      let isAllowed = allowed.includes(origin);

      const miniAppUrl = process.env.MINIAPP_URL?.trim();
      if (!isAllowed && miniAppUrl) {
        try {
          if (new URL(miniAppUrl).origin === origin) {
            isAllowed = true;
          }
        } catch {
          // ignore malformed MINIAPP_URL
        }
      }

      if (!isAllowed && process.env.NODE_ENV !== 'production') {
        try {
          const { protocol, hostname } = new URL(origin);
          const isLocalHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
          if ((protocol === 'http:' || protocol === 'https:') && isLocalHost) {
            isAllowed = true;
          }
        } catch {
          // ignore malformed origin
        }
      }

      callback(null, isAllowed);
    }
  });
  void app.register(helmet);
  void app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  });

  app.addHook('onRequest', async (request) => {
    const contentType = request.headers['content-type'];
    if (!contentType || !contentType.toLowerCase().includes('application/json')) {
      return;
    }
    const contentLength = request.headers['content-length'];
    if (contentLength === undefined || contentLength === '0') {
      delete request.headers['content-type'];
    }
  });

  app.get('/health', async () => ({
    status: 'ok' as const,
    service: 'api',
    application: appName,
    timestamp: new Date().toISOString()
  }));

  // Connectivity-only diagnostic for deployments. Reports reachability and,
  // on failure, only the Prisma error class/code (never connection details).
  app.get('/api/health/database', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' as const, database: 'reachable' as const };
    } catch (error) {
      const err = error as { name?: string; code?: string };
      request.log.warn({ code: err.code }, 'Database health check failed');
      return reply.status(503).send({
        status: 'error' as const,
        database: 'unreachable' as const,
        errorName: err.name ?? 'UnknownError',
        errorCode: err.code ?? null
      });
    }
  });

  // ==================== INTERNAL BOT API ====================
  const isBotSecretValid = (request: { headers: Record<string, string | string[] | undefined> }): boolean => {
    const secret = process.env.BOT_SECRET;
    if (!secret) {
      return false;
    }
    const provided = request.headers['x-bot-secret'];
    return typeof provided === 'string' && provided.length > 0 && provided === secret;
  };

  app.get('/api/internal/bot/:telegramId/balance', async (request, reply) => {
    if (!isBotSecretValid(request)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { telegramId } = request.params as { telegramId: string };
    if (!/^\d+$/.test(telegramId)) {
      return reply.status(400).send({ error: 'Invalid telegram id' });
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) }
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const result = await walletService.getWallet(user.id);
    return result.wallet;
  });

  app.get('/api/internal/bot/:telegramId/orders', async (request, reply) => {
    if (!isBotSecretValid(request)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { telegramId } = request.params as { telegramId: string };
    if (!/^\d+$/.test(telegramId)) {
      return reply.status(400).send({ error: 'Invalid telegram id' });
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) }
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        orderNumber: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true
      }
    });

    return {
      orders: orders.map(order => ({
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total.toString(),
        currency: order.currency,
        createdAt: order.createdAt
      }))
    };
  });

  // Customer-chosen UI language for the Telegram bot ('km' | 'en').
  app.get('/api/internal/bot/:telegramId/language', async (request, reply) => {
    if (!isBotSecretValid(request)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { telegramId } = request.params as { telegramId: string };
    if (!/^\d+$/.test(telegramId)) {
      return reply.status(400).send({ error: 'Invalid telegram id' });
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      select: { language: true }
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return { language: user.language ?? null };
  });

  app.post('/api/internal/bot/:telegramId/language', async (request, reply) => {
    if (!isBotSecretValid(request)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { telegramId } = request.params as { telegramId: string };
    if (!/^\d+$/.test(telegramId)) {
      return reply.status(400).send({ error: 'Invalid telegram id' });
    }

    const body = (request.body ?? {}) as {
      language?: unknown;
      firstName?: unknown;
      lastName?: unknown;
      username?: unknown;
      languageCode?: unknown;
    };

    const language = normalizeSupportedLanguage(body.language);
    if (!language) {
      return reply.status(400).send({ error: 'Invalid language' });
    }

    const asText = (value: unknown): string | null =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

    // Upsert keyed on the unique Telegram ID: an existing customer account is
    // updated in place, a bot-only customer gets their single account row.
    // Duplicate accounts are impossible because telegramId is unique.
    const user = await prisma.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: { language },
      create: {
        telegramId: BigInt(telegramId),
        username: asText(body.username),
        firstName: asText(body.firstName) ?? 'Telegram User',
        lastName: asText(body.lastName),
        photoUrl: null,
        languageCode: normalizeSupportedLanguage(body.languageCode),
        language,
        status: 'ACTIVE',
        lastSeenAt: new Date()
      }
    });

    return { language: user.language ?? language };
  });

  const DEV_AUTH_ENABLED =
    process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_ENABLED === 'true';

  if (DEV_AUTH_ENABLED) {
    app.post('/api/dev/auth', {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request) => {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return { error: 'Bot token not configured' };
      }

      const body = (request.body ?? {}) as {
        telegramId?: number;
        username?: string;
        firstName?: string;
        lastName?: string;
      };

      const telegramId = Number(body.telegramId) || Number(process.env.DEV_AUTH_TELEGRAM_ID) || Number(process.env.ADMIN_TELEGRAM_ID) || 999000001;
      const firstName = body.firstName || 'Dev';
      const lastName = body.lastName || 'User';
      const username = body.username || 'dev_user';
      const authDate = Math.floor(Date.now() / 1000);

      const userPayload = JSON.stringify({
        id: telegramId,
        first_name: firstName,
        last_name: lastName,
        username,
        language_code: 'en'
      });

      const params = new URLSearchParams({
        auth_date: String(authDate),
        user: userPayload,
        dev: '1'
      });

      const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
      const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

      params.set('hash', hash);

      return {
        initData: params.toString(),
        user: { id: telegramId, firstName, lastName, username }
      };
    });
  }

  app.get('/api/me', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { dbUser, created } = await authenticateTelegramUser(request, reply);

    const [wallet, stats] = await Promise.all([
      walletService.getWallet(dbUser.id),
      customerStatsService.getStats(dbUser.id)
    ]);

    const displayName = [dbUser.firstName, dbUser.lastName].filter(Boolean).join(' ') || dbUser.firstName;

    return {
      user: {
        id: dbUser.id,
        telegramId: dbUser.telegramId.toString(),
        customerId: customerIdFromTelegramId(dbUser.telegramId),
        username: dbUser.username,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        displayName,
        photoUrl: dbUser.photoUrl,
        languageCode: dbUser.languageCode,
        status: dbUser.status,
        accountStatus: created ? 'NEW' : 'EXISTING',
        createdAt: dbUser.createdAt,
        lastSeenAt: dbUser.lastSeenAt,
        totalItemsPurchased: stats.totalItemsPurchased,
        totalOrders: stats.totalOrders,
        totalDeposited: stats.totalDeposited
      },
      wallet: wallet.wallet
    };
  });

  app.get('/api/me/home', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { dbUser, created } = await authenticateTelegramUser(request, reply);

    const [balance, stats] = await Promise.all([
      walletService.getWalletBalance(dbUser.id),
      customerStatsService.getStats(dbUser.id)
    ]);

    return {
      user: {
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        username: dbUser.username,
        photoUrl: dbUser.photoUrl,
        accountStatus: created ? 'NEW' : 'EXISTING' as const,
        totalItemsPurchased: stats.totalItemsPurchased,
        totalOrders: stats.totalOrders,
        totalDeposited: stats.totalDeposited
      },
      wallet: balance
    };
  });

  app.get('/api/support/availability', async () => {
    return supportAvailabilityService.getAvailability();
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const err = error as { statusCode?: number; name?: string; message?: string };
    const statusCode = err.statusCode && err.statusCode >= 400 && err.statusCode < 500
      ? err.statusCode
      : 500;
    if (statusCode >= 500) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred'
      });
    }
    return reply.status(statusCode).send({
      statusCode,
      error: err.name || 'Error',
      message: err.message || 'Request failed'
    });
  });

  app.get('/api/categories', async () => {
    const categories = await prisma.category.findMany({
      where: {
        isActive: true,
        isArchived: false
      },
      orderBy: { sortOrder: 'asc' }
    });

    return { categories };
  });

  app.get('/api/topup/games', async () => {
    const games = await prisma.topUpGame.findMany({
      where: {
        isActive: true,
        OR: [
          { providerId: null },
          { provider: { is: { status: 'ACTIVE' } } }
        ]
      },
      select: { id: true, name: true, imageUrl: true },
      orderBy: { sortOrder: 'asc' }
    });

    return { games: games.map((g) => ({ id: g.id, name: g.name, imageUrl: g.imageUrl })) };
  });

  app.get('/api/topup/packages', async (request) => {
    const { gameId } = request.query as { gameId?: string };

    const where: Record<string, unknown> = {
      isActive: true,
      // Disabled games, providers, and provider services are never customer-visible.
      game: { isActive: true },
      OR: [
        { providerId: null },
        {
          AND: [
            { provider: { is: { status: 'ACTIVE' } } },
            { providerServiceId: { not: null } },
            { providerService: { is: { status: 'ACTIVE' } } }
          ]
        }
      ]
    };
    if (gameId) where.gameId = gameId;

    const packages = await prisma.topUpPackage.findMany({
      where,
      include: {
        game: { select: { id: true, name: true, imageUrl: true, providerId: true, providerServiceId: true } },
        provider: { select: { id: true, name: true, status: true } },
        providerService: { select: { id: true, status: true } }
      },
      orderBy: [{ game: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }]
    });

    return {
      packages: packages.map((p) => ({
        ...sanitizeTopUpPackageForCustomer(p),
        gameImageUrl: p.game?.imageUrl ?? null
      })),
      config: gameId
        ? await getTopUpGameConfigForCustomer(prisma, gameId)
        : null
    };
  });

  // Generic provider-driven account verification metadata for one package.
  // Tells the Mini App whether the resolved category supports validation and
  // which dynamic fields it requires — straight from provider metadata.
  app.get('/api/topup/verification-info', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    await authenticateTelegramUser(request, reply);
    const { packageId } = request.query as { packageId?: string };

    if (!packageId || typeof packageId !== 'string' || packageId.length > 64) {
      return reply.status(400).send({ error: 'Invalid package ID' });
    }

    const { TopUpVerificationService } = await import('./services/topup/verification.service.js');
    const service = new TopUpVerificationService(prisma);

      try {
        const info = await service.getVerificationInfo(packageId);
        // Provider/category identifiers are server-side implementation details.
        // The Mini App only needs the capability and field contract.
        return {
          applicable: info.applicable,
          verificationAvailable: info.verificationAvailable,
          availabilityKnown: info.availabilityKnown,
          fields: info.fields,
          allowUnverifiedPurchase: info.allowUnverifiedPurchase
        };
      } catch {
        return reply.status(200).send({
          applicable: true,
          verificationAvailable: false,
          availabilityKnown: false,
          fields: [],
          allowUnverifiedPurchase: false
        });
      }
  });

  // Generic account verification endpoint (any game, any provider that
  // implements validation). The backend resolves package → provider service →
  // external category; the frontend NEVER supplies a category id.
  app.post('/api/verify-player', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const body = (request.body ?? {}) as {
      packageId?: string;
      fields?: Record<string, unknown>;
    };

    if (!body.packageId || typeof body.packageId !== 'string' || body.packageId.length > 64) {
      return reply.status(400).send({ error: 'Invalid package ID' });
    }

    if (body.fields === undefined || typeof body.fields !== 'object' || body.fields === null) {
      return reply.status(400).send({ error: 'Account fields are required' });
    }

    // Cap field payload size before any provider interaction.
    for (const [key, value] of Object.entries(body.fields)) {
      if (typeof key !== 'string' || key.length > 64 || !/^[a-z0-9_]+$/i.test(key)) {
        return reply.status(400).send({ error: 'Invalid account field' });
      }
      if (typeof value !== 'string' || value.length > 100) {
        return reply.status(400).send({ error: 'Invalid account field value' });
      }
    }

    const { TopUpVerificationService } = await import('./services/topup/verification.service.js');
    const service = new TopUpVerificationService(prisma);
    const result = await service.verifyPlayer(dbUser.id, body.packageId, body.fields);

    // Safe result contract only — never raw provider errors.
    return reply.status(200).send({
      valid: result.valid ?? null,
      verified: result.verified ?? false,
      playerName: result.playerName ?? null,
      region: (result as { region?: string }).region ?? null,
      verificationToken: result.verificationToken ?? null,
      expiresAt: result.expiresAt ?? null,
      verificationAvailable: result.verificationAvailable ?? true,
      allowUnverifiedPurchase: result.allowUnverifiedPurchase ?? false,
      reason: result.reason ?? null,
      error: result.error ?? null
    });
  });

  app.post('/api/topup/orders', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const body = (request.body ?? {}) as {
      packageId?: string;
      target?: string;
      serverId?: string;
      customFields?: Record<string, string>;
      idempotencyKey?: string;
    };

    if (!body.packageId || typeof body.packageId !== 'string' || body.packageId.length > 64) {
      return reply.status(400).send({ error: 'Invalid package ID' });
    }

    if (body.target !== undefined && (typeof body.target !== 'string' || body.target.length > 500)) {
      return reply.status(400).send({ error: 'Invalid player ID' });
    }

    if (body.serverId !== undefined && (typeof body.serverId !== 'string' || body.serverId.length > 100)) {
      return reply.status(400).send({ error: 'Invalid server ID' });
    }

    if (body.customFields !== undefined && (typeof body.customFields !== 'object' || body.customFields === null)) {
      return reply.status(400).send({ error: 'Invalid custom fields' });
    }

    if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length > 128)) {
      return reply.status(400).send({ error: 'Invalid idempotency key' });
    }

    const result = await topUpService.createCustomerTopUpOrder(dbUser.id, {
      packageId: body.packageId,
      target: body.target,
      serverId: body.serverId,
      customFields: body.customFields,
      idempotencyKey: body.idempotencyKey
    });

    if (!result.success) {
      if (result.conflict) {
        return reply.status(409).send({ error: result.error });
      }
      return reply.status(400).send({ error: result.error });
    }

    return reply.status(201).send({ order: result.order });
  });

  // Account verification endpoint for Top-Up
  app.post('/api/topup/verify-account', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    await authenticateTelegramUser(request, reply);

    const body = (request.body ?? {}) as {
      gameId?: string;
      packageId?: string;
      target?: string;
      serverId?: string;
    };

    if (!body.gameId || typeof body.gameId !== 'string' || body.gameId.length > 64) {
      return reply.status(400).send({ error: 'Invalid game ID' });
    }

    if (!body.target || typeof body.target !== 'string' || body.target.length > 500) {
      return reply.status(400).send({ error: 'Player ID is required' });
    }

    if (body.serverId !== undefined && (typeof body.serverId !== 'string' || body.serverId.length > 100)) {
      return reply.status(400).send({ error: 'Invalid server ID' });
    }

    // Get game config to check verification settings
    const gameConfig = await prisma.topUpGameConfig.findUnique({
      where: { gameId: body.gameId },
      include: {
        verificationProvider: true,
        verificationService: true
      }
    });

    if (!gameConfig) {
      return reply.status(400).send({ error: 'Account verification is not available for this game.' });
    }

    if (!gameConfig.verificationEnabled) {
      return reply.status(400).send({ error: 'Account verification is not available for this game.' });
    }

    if (!gameConfig.verificationProviderId || !gameConfig.verificationProvider) {
      return reply.status(400).send({ error: 'Account verification is not available for this game.' });
    }

    if (gameConfig.verificationProvider.status !== 'ACTIVE') {
      return reply.status(503).send({ error: 'Account verification is temporarily unavailable. Please try again later.' });
    }

    if (!gameConfig.verificationServiceId || !gameConfig.verificationService) {
      return reply.status(400).send({ error: 'Account verification is not available for this game.' });
    }

    if (gameConfig.verificationService.status !== 'ACTIVE') {
      return reply.status(503).send({ error: 'Account verification is temporarily unavailable. Please try again later.' });
    }

    // Validate player ID format if numeric validation is required
    if (gameConfig.playerIdValidation === 'NUMERIC' && !/^\d+$/.test(body.target)) {
      return reply.status(400).send({ error: 'Player ID must contain numbers only' });
    }

    // Validate server ID format if numeric validation is required
    if (gameConfig.requireServerId) {
      if (!body.serverId || body.serverId.trim().length === 0) {
        return reply.status(400).send({ error: 'Server ID is required for this game' });
      }
      if (gameConfig.serverIdValidation === 'NUMERIC' && !/^\d+$/.test(body.serverId)) {
        return reply.status(400).send({ error: 'Server ID must contain numbers only' });
      }
    }

    let apiKey: string;
    try {
      apiKey = decryptInventoryValue(gameConfig.verificationProvider.encryptedApiKey);
    } catch {
      return reply.status(503).send({ error: 'Account verification is temporarily unavailable. Please try again later.' });
    }

    const { createTopUpProvider } = await import('./services/topup/provider-factory.js');
    const providerInstance = await createTopUpProvider({
      name: gameConfig.verificationProvider.name,
      apiUrl: gameConfig.verificationProvider.apiUrl,
      apiKey
    });

    if (!providerInstance.isAvailable()) {
      return reply.status(503).send({ error: 'Account verification is temporarily unavailable. Please try again later.' });
    }

    let verifyResult;
    try {
      verifyResult = await providerInstance.verifyAccount({
        serviceId: gameConfig.verificationService.providerServiceId,
        target: body.target.trim(),
        serverId: body.serverId?.trim()
      });
    } catch (error) {
      request.log.warn({ err: error }, 'Legacy account verification request failed');
      return reply.status(503).send({ error: 'Account verification is temporarily unavailable. Please try again later.' });
    }

    if (!verifyResult.success) {
      return reply.status(400).send({ error: 'Player ID not found. Please check your account details and try again.' });
    }

    return {
      success: true,
      accountName: verifyResult.accountName,
      verifiedAt: new Date().toISOString(),
      target: body.target.trim(),
      serverId: body.serverId?.trim() ?? null
    };
  });

  app.get('/api/categories/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const category = await prisma.category.findUnique({
      where: { slug },
      include: {
        products: {
          where: {
            isActive: true,
            status: 'ACTIVE'
          },
          orderBy: { sortOrder: 'asc' },
          include: {
            stock: { where: { status: 'AVAILABLE' }, select: { id: true } }
          }
        }
      }
    });

    if (!category || !category.isActive || category.isArchived) {
      return reply.status(404).send({ error: 'Category not found' });
    }

    return {
      category: {
        ...category,
        products: category.products.map((product) => ({
          ...sanitizeProductForCustomer(product),
          isOutOfStock: product.type === 'SMM_API' ? false : product.stock.length === 0,
          availableStock: product.stock.length
        }))
      }
    };
  });

  app.get('/api/products', async (request) => {
    const { search, category, page = '1', pageSize = '20', featured, popular, deliveryType, inStock, sort } = request.query as {
      search?: string;
      category?: string;
      page?: string;
      pageSize?: string;
      featured?: string;
      popular?: string;
      deliveryType?: string;
      inStock?: string;
      sort?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSizeNum = Math.min(50, Math.max(1, parseInt(pageSize, 10)));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {
      isActive: true,
      status: 'ACTIVE'
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { keywords: { hasSome: search.split(' ') } }
      ];
    }

    if (category) {
      where.category = { slug: category };
    }

    if (featured === 'true') {
      where.isFeatured = true;
    }

    if (popular === 'true') {
      where.isPopular = true;
    }

    if (deliveryType) {
      where.deliveryType = deliveryType;
    }

    if (inStock === 'true') {
      where.isHandDelivery = false;
      where.type = { not: 'SMM_API' };
      where.stock = { some: { status: 'AVAILABLE' } };
    }

    let orderBy: Record<string, string>[] = [{ sortOrder: 'asc' }, { createdAt: 'desc' }];
    if (sort === 'price_asc') {
      orderBy = [{ price: 'asc' }];
    } else if (sort === 'price_desc') {
      orderBy = [{ price: 'desc' }];
    } else if (sort === 'name') {
      orderBy = [{ name: 'asc' }];
    } else if (sort === 'newest') {
      orderBy = [{ createdAt: 'desc' }];
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: pageSizeNum,
        include: {
          category: true,
          stock: { where: { status: 'AVAILABLE' }, select: { id: true } }
        }
      }),
      prisma.product.count({ where })
    ]);

    return {
      products: products.map((product) => ({
        ...sanitizeProductForCustomer(product),
        isOutOfStock: product.isHandDelivery ? false : (product.type === 'SMM_API' ? false : product.stock.length === 0),
        availableStock: product.stock.length
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  });

  app.get('/api/products/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        category: true,
        variants: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' }
        },
        stock: {
          where: { status: 'AVAILABLE' }
        }
      }
    });

    if (!product || !product.isActive || product.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Product not found' });
    }

    const availableStock = product.stock.length;

    let services: unknown[] = [];
    if (product.type === 'SMM_API') {
        services = await prisma.smmService.findMany({
          where: { productId: product.id, status: 'ACTIVE' },
          select: {
            id: true,
            name: true,
            minimumQuantity: true,
            maximumQuantity: true
        },
        orderBy: { name: 'asc' }
      });
    }

    return {
      product: {
        ...sanitizeProductForCustomer(product),
        availableStock,
        isOutOfStock: product.isHandDelivery ? false : (product.type === 'SMM_API' ? services.length === 0 : availableStock === 0),
        services
      }
    };
  });

  app.post('/api/orders', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const body = (request.body ?? {}) as {
      productId: string;
      quantity: number;
      target?: string;
      serviceId?: string;
      /** @deprecated Older clients sent the external provider service ID. */
      providerServiceId?: string;
      idempotencyKey?: string;
      couponCode?: string;
    };

    if (!body.productId || typeof body.productId !== 'string' || body.productId.length > 64) {
      return reply.status(400).send({ error: 'Invalid product ID' });
    }

    if (!Number.isInteger(body.quantity) || body.quantity < 1) {
      return reply.status(400).send({ error: 'Invalid quantity' });
    }

    if (body.target !== undefined && (typeof body.target !== 'string' || body.target.length > 500)) {
      return reply.status(400).send({ error: 'Invalid target' });
    }

    if (body.providerServiceId !== undefined && (typeof body.providerServiceId !== 'string' || body.providerServiceId.length > 64)) {
      return reply.status(400).send({ error: 'Invalid provider service ID' });
    }

    if (body.serviceId !== undefined && (typeof body.serviceId !== 'string' || body.serviceId.length > 64)) {
      return reply.status(400).send({ error: 'Invalid service ID' });
    }

    if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length > 128)) {
      return reply.status(400).send({ error: 'Invalid idempotency key' });
    }

    if (body.idempotencyKey !== undefined && body.idempotencyKey.trim().length === 0) {
      return reply.status(400).send({ error: 'Invalid idempotency key' });
    }

    const idempotencyKey = body.idempotencyKey?.trim() ||
      `legacy_${crypto.createHash('sha256').update(JSON.stringify({
        userId: dbUser.id,
        productId: body.productId,
        quantity: body.quantity,
        target: body.target?.trim() ?? null,
        serviceId: body.serviceId ?? body.providerServiceId ?? null,
        couponCode: body.couponCode?.trim().toUpperCase() ?? null,
        bucket: Math.floor(Date.now() / 30_000)
      })).digest('hex').slice(0, 80)}`;

    if (body.idempotencyKey) {
      const existingOrder = await prisma.order.findUnique({
        where: { idempotencyKey },
        include: { items: true }
      });
      if (existingOrder) {
        const existingItem = existingOrder.items[0];
        const sameRequest = existingOrder.userId === dbUser.id &&
          existingItem?.productId === body.productId &&
          existingItem.quantitySnapshot === body.quantity &&
          (existingItem.target ?? null) === (body.target?.trim() ?? null);
        if (sameRequest) {
          return reply.status(200).send({ order: serializeCustomerOrder(existingOrder) });
        }
        return reply.status(409).send({ error: 'This idempotency key is already in use' });
      }
    }

    const product = await prisma.product.findUnique({
      where: { id: body.productId },
      include: {
        stock: { where: { status: 'AVAILABLE' } },
        variants: { where: { isActive: true } },
        category: { select: { isActive: true, isArchived: true } },
        flashDeal: {
          where: {
            isActive: true,
            OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }],
            AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }]
          },
          select: { salePrice: true }
        }
      }
    });

    if (
      !product ||
      !product.isActive ||
      product.status !== 'ACTIVE' ||
      (product.category && (!product.category.isActive || product.category.isArchived))
    ) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    const availableStock = Array.isArray(product.stock) ? product.stock.length : Number.POSITIVE_INFINITY;
    const isSmmProduct = product.type === 'SMM_API';
    const isHandDelivery = product.isHandDelivery === true;

    let smmServiceId: string | null = null;
    let selectedSmmService: {
      id: string;
      providerId: string;
      providerServiceId: string;
      providerCost: Prisma.Decimal | null;
      minimumQuantity: number;
      maximumQuantity: number;
    } | null = null;
    if (isSmmProduct) {
      const requestedServiceId = body.serviceId ?? body.providerServiceId;
      if (!requestedServiceId) {
        return reply.status(400).send({ error: 'serviceId is required for SMM products' });
      }
      if (!body.target) {
        return reply.status(400).send({ error: 'target is required for SMM products' });
      }
      const service = await prisma.smmService.findFirst({
        where: {
          productId: product.id,
          OR: [
            { id: requestedServiceId },
            { providerServiceId: requestedServiceId }
          ],
          status: 'ACTIVE'
        },
        select: {
          id: true,
          providerId: true,
          providerServiceId: true,
          providerCost: true,
          minimumQuantity: true,
          maximumQuantity: true
        }
      });
      if (!service) {
        return reply.status(404).send({ error: 'SMM service not found for this product' });
      }
      if (body.quantity < service.minimumQuantity || body.quantity > service.maximumQuantity) {
        return reply.status(400).send({
          error: `Quantity must be between ${service.minimumQuantity} and ${service.maximumQuantity}`
        });
      }
      selectedSmmService = service;
      smmServiceId = service.providerServiceId;
    }

    const effectiveMaximumQuantity = isHandDelivery
      ? (product.maximumQuantity ?? 9999)
      : Math.min(
          product.maximumQuantity ?? availableStock,
          availableStock
        );

    if (!isSmmProduct && (body.quantity < product.minimumQuantity || body.quantity > effectiveMaximumQuantity)) {
      return reply.status(400).send({
        error: `Quantity must be between ${product.minimumQuantity} and ${effectiveMaximumQuantity}`
      });
    }

    if (!isHandDelivery && product.hideWhenOutOfStock && product.stock.length === 0) {
      return reply.status(400).send({ error: 'Product is out of stock' });
    }

    const unitPrice = effectiveProductPrice(product.price, product.flashDeal?.salePrice);
    const subtotal = unitPrice.mul(body.quantity);
    let discount = new Prisma.Decimal(0);
    let coupon: PricingCoupon | null = null;

    // Apply coupon if provided
    if (body.couponCode) {
      const foundCoupon = await prisma.coupon.findUnique({
        where: { code: body.couponCode.toUpperCase() }
      });

      if (!foundCoupon) {
        return reply.status(400).send({ error: 'Invalid coupon code' });
      }

      const evaluation = evaluateCoupon(foundCoupon, subtotal, product.id, product.categoryId);
      if (!evaluation.valid) {
        return reply.status(400).send({ error: evaluation.error });
      }

      if (foundCoupon.perUserLimit !== null) {
        const userUsageCount = await prisma.couponUsage.count({
          where: { couponId: foundCoupon.id, userId: dbUser.id }
        });
        if (userUsageCount >= foundCoupon.perUserLimit) {
          return reply.status(400).send({ error: 'You have reached the usage limit for this coupon' });
        }
      }

      discount = evaluation.discount;
      // Keep the validated row so usage is claimed in the order transaction.
      coupon = foundCoupon;
    }

    const total = subtotal.sub(discount);

    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        const newOrder = await tx.order.create({
          data: {
            userId: dbUser.id,
            status: 'DRAFT',
            currency: product.currency,
            subtotal,
            discount,
            total,
            idempotencyKey,
            items: {
              create: {
                productId: product.id,
                productNameSnapshot: product.name,
                unitPriceSnapshot: unitPrice,
                quantitySnapshot: body.quantity,
                totalSnapshot: total,
                currencySnapshot: product.currency,
                deliveryTypeSnapshot: product.deliveryType,
                providerServiceIdSnapshot: smmServiceId,
                providerIdSnapshot: selectedSmmService?.providerId ?? null,
                providerServiceExternalIdSnapshot: selectedSmmService?.providerServiceId ?? null,
                providerCostSnapshot: selectedSmmService?.providerCost ?? null,
                target: body.target?.trim() ?? null
              }
            }
          },
          include: {
            items: true
          }
        });

        if (!isSmmProduct && !isHandDelivery) {
          const reservationResult = await stockService.reserveStock(
            product.id,
            body.quantity,
            newOrder.id,
            undefined,
            tx
          );

          if (!reservationResult.success) {
            throw new Error(reservationResult.error || 'Failed to reserve stock');
          }
        }

        if (coupon && discount.greaterThan(0)) {
          const couponClient = tx as Prisma.TransactionClient & {
            coupon: {
              updateMany: (args: unknown) => Promise<{ count: number }>;
            };
            couponUsage: {
              count: (args: unknown) => Promise<number>;
              create: (args: unknown) => Promise<unknown>;
            };
          };

          const claimed = await couponClient.coupon.updateMany({
            where: {
              id: coupon.id,
              isActive: true,
              OR: [
                { usageLimit: null },
                { usageCount: { lt: coupon.usageLimit ?? 0 } }
              ]
            },
            data: { usageCount: { increment: 1 } }
          });
          if (claimed.count !== 1) {
            throw new Error('Coupon usage limit reached');
          }

          const currentUserUsage = await couponClient.couponUsage.count({
            where: { couponId: coupon.id, userId: dbUser.id }
          });
          if (coupon.perUserLimit !== null && currentUserUsage >= coupon.perUserLimit) {
            throw new Error('You have reached the usage limit for this coupon');
          }

          await couponClient.couponUsage.create({
            data: {
              couponId: coupon.id,
              userId: dbUser.id,
              orderId: newOrder.id,
              amount: discount
            }
          });
        }

        return newOrder;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingOrder = await prisma.order.findUnique({
          where: { idempotencyKey },
          include: { items: true }
        });
        if (existingOrder?.userId === dbUser.id) {
          return reply.status(200).send({ order: serializeCustomerOrder(existingOrder) });
        }
        return reply.status(409).send({ error: 'This idempotency key is already in use' });
      }
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to create order'
      });
    }

    // The order response is an explicit customer DTO; never return Prisma's
    // provider snapshots, idempotency key, or mutable product relation.
    return reply.status(201).send({ order: serializeCustomerOrder(order) });
  });

  app.get('/api/orders', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const { page = '1', pageSize = '20' } = request.query as {
      page?: string;
      pageSize?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSizeNum = Math.min(50, Math.max(1, parseInt(pageSize, 10)));
    const skip = (pageNum - 1) * pageSizeNum;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId: dbUser.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSizeNum,
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, slug: true, imageUrl: true, price: true }
              }
            }
          }
        }
      }),
      prisma.order.count({ where: { userId: dbUser.id } })
    ]);

    return {
      orders: orders.map((order) => serializeCustomerOrder(order)),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  });

  app.get('/api/orders/:id', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const { id } = request.params as { id: string };

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, slug: true, imageUrl: true, price: true }
            },
            fulfillment: true
          }
        }
      }
    });

    if (!order || order.userId !== dbUser.id) {
      if (order) {
        await securityService.record({
          eventType: 'UNAUTHORIZED_ORDER_ACCESS',
          ip: request.ip,
          userId: dbUser.id,
          metadata: { orderId: order.id, orderNumber: order.orderNumber }
        });
      }
      return reply.status(404).send({ error: 'Order not found' });
    }

    const deliveredStock = (await prisma.productStock.findMany({
      where: {
        orderId: order.id,
        status: { in: ['SOLD', 'RESERVED'] }
      },
      select: { id: true, productId: true, status: true },
      orderBy: { createdAt: 'asc' }
    })) ?? [];

    const manualDeliveries = (await prisma.manualDelivery.findMany({
      where: { orderId: order.id },
      select: {
        orderItemId: true,
        title: true,
        content: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    }));

    const manualDeliveriesByItem = new Map<string, { title: string; content: string; deliveredAt: string }>();
    for (const md of manualDeliveries) {
      manualDeliveriesByItem.set(md.orderItemId, {
        title: md.title,
        content: md.content,
        deliveredAt: md.createdAt.toISOString()
      });
    }

    const deliveryValuesByProduct = new Map<string, string[]>();
    if (deliveredStock.length > 0) {
      const decryptedStocks = await Promise.all(
        deliveredStock.map(async (stock) => {
          const decrypted = await stockService.getStockWithDecryptedValue(stock.id);
          return { stock, decrypted };
        })
      );
      for (const { stock, decrypted } of decryptedStocks) {
        if (!decrypted?.deliveryValue) continue;
        const values = deliveryValuesByProduct.get(stock.productId) ?? [];
        values.push(decrypted.deliveryValue);
        deliveryValuesByProduct.set(stock.productId, values);
      }
    }

    return {
      order: serializeCustomerOrder({
        ...order,
        items: order.items.map(item => {
          const productValues = item.productId
            ? (deliveryValuesByProduct.get(item.productId) ?? [])
            : [];
          const deliveryValues = productValues.splice(0, item.quantitySnapshot);
          const manualDelivery = item.id ? manualDeliveriesByItem.get(item.id) : undefined;

          return {
            ...item,
            fulfillment: item.fulfillment
              ? { status: item.fulfillment.status, deliveredAt: item.fulfillment.deliveredAt }
              : null,
            deliveryValues:
              item.productId && item.fulfillment?.status === 'DELIVERED'
                ? deliveryValues
                : [],
            deliveryValue: item.productId && item.fulfillment?.status === 'DELIVERED'
              ? (deliveryValues[0] ?? null)
              : null,
            manualDelivery: manualDelivery ?? null
          };
        }),
      })
    };
  });

  app.post('/api/payments', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const body = (request.body ?? {}) as {
      orderId: string;
      provider: string;
      idempotencyKey?: string;
    };

    if (!body.orderId || typeof body.orderId !== 'string' || body.orderId.length > 64) {
      return reply.status(400).send({ error: 'orderId is required' });
    }

    if (!body.provider || typeof body.provider !== 'string') {
      return reply.status(400).send({ error: 'provider is required' });
    }

    if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length > 128)) {
      return reply.status(400).send({ error: 'Invalid idempotency key' });
    }

    // Customer-created payment sessions must use a real server-verified rail.
    // Wallet payments have their own endpoint; MANUAL is retained only for
    // historical records and is not an accepted customer payment method.
    const validProviders = ['KHQR', 'BAKONG'];
    if (!validProviders.includes(body.provider)) {
      return reply.status(400).send({ error: 'Invalid payment provider' });
    }

    let result;
    try {
      result = await paymentService.createPayment(
        dbUser.id,
        body.orderId,
        body.provider as PrismaPaymentProvider,
        body.idempotencyKey
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        await securityService.record({
          eventType: 'PAYMENT_REPLAY',
          ip: request.ip,
          userId: dbUser.id,
          metadata: { orderId: body.orderId, provider: body.provider }
        });
      }
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to create payment'
      });
    }

    if (!result.success) {
      request.log.warn({ orderId: body.orderId, provider: body.provider, error: result.error }, 'Payment creation failed');
      return reply.status(400).send({ error: result.error });
    }

    return reply.status(201).send({ payment: result.payment, resumed: result.resumed ?? false });
  });

  app.get('/api/payments/:id', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const { id } = request.params as { id: string };

    let result = await paymentService.getPaymentStatus(id, dbUser.id);
    let verificationError: string | undefined;

    if (!result.success) {
      if (result.error === 'Payment not found') {
        const existing = await prisma.payment.findUnique({
          where: { id },
          select: { userId: true, provider: true, reference: true }
        });
        if (existing && existing.userId !== dbUser.id) {
          await securityService.record({
            eventType: 'UNAUTHORIZED_PAYMENT_ACCESS',
            ip: request.ip,
            userId: dbUser.id,
            metadata: { paymentId: id, provider: existing.provider, reference: existing.reference }
          });
        }
      }
      return reply.status(404).send({ error: result.error || 'Payment not found' });
    }

    if (result.payment?.status === 'PENDING' && !result.isExpired) {
      const verification = await paymentService.verifyPayment(id);
      verificationError = verification.error;
      result = await paymentService.getPaymentStatus(id, dbUser.id);
    }

    if (result.payment?.status === 'SUCCEEDED') {
      const paymentRow = await prisma.payment.findUnique({
        where: { id },
        select: { orderId: true }
      });
      if (paymentRow?.orderId) {
        const order = await prisma.order.findUnique({
          where: { id: paymentRow.orderId },
          select: { status: true }
        });
        if (order && order.status !== 'COMPLETED') {
          const fulfillment = await fulfillOrderAndNotify(paymentRow.orderId);
          if (!fulfillment.success && fulfillment.errors.length > 0) {
            request.log.warn({ orderId: paymentRow.orderId, errors: fulfillment.errors }, 'Fulfillment incomplete after payment success');
          }
        }
      }
    }

    return { payment: result.payment, isExpired: result.isExpired, verificationError };
  });

  app.post('/api/payments/:id/expire', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const { id } = request.params as { id: string };

    // Server-side cancellation: the backend re-checks the authoritative
    // payment state before cancelling, so a cancel that races a real payment
    // never strands money or leaves a confusing unpaid state.
    let result;
    try {
      result = await paymentService.cancelPayment(id, dbUser.id);
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to cancel payment'
      });
    }

    if (!result.success) {
      if (result.error === 'Payment not found') {
        return reply.status(404).send({ error: 'Payment not found' });
      }
      return reply.status(400).send({ error: result.error });
    }

    if (result.paid && result.status === 'SUCCEEDED') {
      const paymentRow = await prisma.payment.findUnique({
        where: { id },
        select: { orderId: true }
      });
      if (paymentRow?.orderId) {
        const order = await prisma.order.findUnique({
          where: { id: paymentRow.orderId },
          select: { status: true }
        });
        if (order && order.status !== 'COMPLETED') {
          const fulfillment = await fulfillOrderAndNotify(paymentRow.orderId);
          if (!fulfillment.success && fulfillment.errors.length > 0) {
            request.log.warn({ orderId: paymentRow.orderId, errors: fulfillment.errors }, 'Fulfillment incomplete after cancel raced a paid payment');
          }
        }
      }
    }

    return {
      success: true,
      status: result.status,
      paid: result.paid ?? false,
      cancelled: result.cancelled ?? false,
      alreadyTerminal: result.alreadyTerminal ?? false
    };
  });

  // ==================== WALLET ====================
  app.get('/api/wallet', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const result = await walletService.getWallet(dbUser.id);
    return result;
  });

  app.post('/api/wallet/deposits', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const body = (request.body ?? {}) as {
      amount?: string | number;
      currency?: string;
      idempotencyKey?: string;
    };

    if (body.amount === undefined || body.amount === null || body.amount === '') {
      return reply.status(400).send({ error: 'amount is required' });
    }

    if (typeof body.amount !== 'string' && typeof body.amount !== 'number') {
      return reply.status(400).send({ error: 'amount must be a number' });
    }

    if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length > 128)) {
      return reply.status(400).send({ error: 'Invalid idempotency key' });
    }

    const currency = body.currency ?? 'USD';
    if (typeof currency !== 'string' || currency.length > 3) {
      return reply.status(400).send({ error: 'Invalid currency' });
    }

    const result = await paymentService.createDepositPayment(
      dbUser.id,
      body.amount,
      currency.toUpperCase(),
      body.idempotencyKey
    );

    if (!result.success) {
      request.log.warn({ amount: body.amount, currency, error: result.error, conflict: result.conflict }, 'Deposit payment creation failed');
      if (result.conflict) {
        await securityService.record({
          eventType: 'PAYMENT_REPLAY',
          ip: request.ip,
          userId: dbUser.id,
          metadata: { walletDeposit: true, amount: String(body.amount), currency }
        });
        return reply.status(409).send({
          error: result.error,
          conflict: true,
          activePayment: result.activePayment
        });
      }
      return reply.status(400).send({ error: result.error });
    }

    return reply.status(201).send({ payment: result.payment, resumed: result.resumed ?? false });
  });

  app.post('/api/orders/:id/pay-with-wallet', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const { id } = request.params as { id: string };
    const body = request.body as { idempotencyKey?: string };

    if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length > 128)) {
      return reply.status(400).send({ error: 'Invalid idempotency key' });
    }

    const result = await walletService.payOrderWithWallet(dbUser.id, id, body.idempotencyKey);

    if (!result.success) {
      return reply.status(400).send({ error: result.error });
    }

    if (result.order) {
      const fulfillment = await fulfillOrderAndNotify(result.order.id);
      if (!fulfillment.success && fulfillment.errors.length > 0) {
        request.log.warn({ orderId: result.order.id, errors: fulfillment.errors }, 'Fulfillment incomplete after wallet payment');
      }
    }

    return { order: result.order, payment: result.payment };
  });

  // ==================== SUPPORT TICKETS ====================
  app.get('/api/tickets/unread-count', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    return customerTicketService.getUnreadCount(dbUser.id);
  });

  app.get('/api/tickets', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const { page = '1', pageSize = '20' } = request.query as {
      page?: string;
      pageSize?: string;
    };

    const result = await customerTicketService.getTickets(
      dbUser.id,
      parseInt(page, 10),
      parseInt(pageSize, 10)
    );

    return result;
  });

  app.post('/api/tickets', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const body = request.body as {
      subject?: string;
      body?: string;
      orderId?: string;
    };

    const subject = body.subject?.trim();
    if (!subject || subject.length > 200) {
      return reply.status(400).send({ error: 'Subject is required (max 200 characters)' });
    }

    const message = body.body?.trim();
    if (!message || message.length > 4000) {
      return reply.status(400).send({ error: 'Message is required (max 4000 characters)' });
    }

    const orderId = body.orderId && body.orderId.length <= 64 ? body.orderId : undefined;

    try {
      const ticket = await customerTicketService.createTicket(dbUser.id, subject, message, orderId);
      return reply.status(201).send({ ticket });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create ticket' });
    }
  });

  app.get('/api/tickets/:id', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const { id } = request.params as { id: string };

    const ticket = await customerTicketService.getTicketById(id, dbUser.id);

    if (!ticket) {
      return reply.status(404).send({ error: 'Ticket not found' });
    }

    return { ticket };
  });

  app.post('/api/tickets/:id/messages', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const { id } = request.params as { id: string };
    const body = request.body as { body?: string };

    const message = body.body?.trim();
    if (!message || message.length > 4000) {
      return reply.status(400).send({ error: 'Message is required (max 4000 characters)' });
    }

    try {
      const result = await customerTicketService.replyToTicket(id, dbUser.id, message);
      return reply.status(201).send({ message: result });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to send message' });
    }
  });

  app.post('/api/admin/payments/expire', {
    preHandler: requireAdmin({ requiredPermissions: ['payments:manage'] })
  }, async (request, reply) => {
    await authenticateAdmin(request, reply);

    const body = request.body as { maxAgeMinutes?: number };
    const maxAgeMinutes = body.maxAgeMinutes ?? 15;

    const { PaymentExpirationService } = await import('./services/payment/payment-expiration.service.js');
    const expirationService = new PaymentExpirationService(prisma);

    const result = await expirationService.expireOldPayments(maxAgeMinutes);

    return { success: true, ...result };
  });

  app.get('/api/admin/stock', {
    preHandler: requireAdmin({ requiredPermissions: ['stock:read'] })
  }, async (request, reply) => {
    await authenticateAdmin(request, reply);

    const { productId, status, page = '1', pageSize = '50' } = request.query as {
      productId?: string;
      status?: string;
      page?: string;
      pageSize?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10)));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};
    if (productId) where.productId = productId;
    if (status) where.status = status;

    const [stock, total] = await Promise.all([
      prisma.productStock.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSizeNum,
        include: {
          product: { select: { id: true, name: true, slug: true } },
          variant: { select: { id: true, name: true } },
          order: { select: { id: true, orderNumber: true, userId: true } }
        }
      }),
      prisma.productStock.count({ where })
    ]);

    return {
      stock: stock.map(s => ({
        ...s,
        deliveryValue: undefined
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  });

  app.post('/api/admin/stock', {
    preHandler: requireAdmin({ requiredPermissions: ['stock:manage'] })
  }, async (request, reply) => {
    await authenticateAdmin(request, reply);

    const body = request.body as {
      productId: string;
      variantId?: string;
      deliveryType: string;
      values: string[];
    };

    if (!body.productId || !body.deliveryType || !body.values || !Array.isArray(body.values) || body.values.length === 0) {
      return reply.status(400).send({ error: 'productId, deliveryType, and values array are required' });
    }

    const product = await prisma.product.findUnique({
      where: { id: body.productId }
    });

    if (!product) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    if (body.variantId) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: body.variantId }
      });
      if (!variant || variant.productId !== body.productId) {
        return reply.status(404).send({ error: 'Variant not found' });
      }
    }

    try {
      const createdStock = await stockService.createStockBatch(
        body.productId,
        body.variantId,
        body.deliveryType,
        body.values
      );

      return reply.status(201).send({
        stock: createdStock.map(s => ({ ...s, deliveryValue: undefined })),
        count: createdStock.length
      });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to add stock' });
    }
  });

  app.post('/api/admin/stock/:id/disable', {
    preHandler: requireAdmin({ requiredPermissions: ['stock:manage'] })
  }, async (request, reply) => {
    await authenticateAdmin(request, reply);

    const { id } = request.params as { id: string };

    const stock = await prisma.productStock.findUnique({ where: { id } });
    if (!stock) {
      return reply.status(404).send({ error: 'Stock not found' });
    }

    if (stock.status === 'SOLD') {
      return reply.status(400).send({ error: 'Cannot disable sold stock' });
    }

    const disabled = await stockService.disableStock([id]);

    return { success: disabled > 0, disabledCount: disabled };
  });

  app.post('/api/admin/stock/expire', {
    preHandler: requireAdmin({ requiredPermissions: ['stock:manage'] })
  }, async (request, reply) => {
    await authenticateAdmin(request, reply);

    const body = request.body as { maxAgeMinutes?: number };
    const maxAgeMinutes = body.maxAgeMinutes ?? 15;

    const { ReservationExpirationService } = await import('./services/reservation-expiration.service.js');
    const expirationService = new ReservationExpirationService(prisma);

    const result = await expirationService.expireOldReservations(maxAgeMinutes);

    return { success: true, ...result };
  });

  // ==================== ADMIN AUTH CHECK ====================
  // Lightweight endpoint used by the admin layout to verify the token is
  // valid.  The layout calls this on mount and on every navigation to guard
  // the admin area.  It must be as fast as possible – no heavy aggregations.
  app.get('/api/admin/auth/check', {
    preHandler: requireAdmin(),
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (_request, _reply) => {
    return { ok: true };
  });

  // ==================== ADMIN DASHBOARD ====================
  app.get('/api/admin/dashboard', {
    preHandler: requireAdmin(),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (_request, _reply) => {
    const stats = await dashboardService.getDashboardStats();
    return stats;
  });

  app.get('/api/admin/dashboard/activity', {
    preHandler: requireAdmin()
  }, async (request, _reply) => {
    const { limit = '20' } = request.query as { limit?: string };
    const activity = await dashboardService.getRecentActivity(parseInt(limit, 10));
    return activity;
  });

  // ==================== ADMIN PRODUCTS ====================
  app.get('/api/admin/products', {
    preHandler: requireAdmin({ requiredPermissions: ['products:read'] }),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, _reply) => {
    const { search, categoryId, status, isActive, isFeatured, isPopular, page, pageSize, sortBy, sortOrder } = request.query as {
      search?: string;
      categoryId?: string;
      status?: ProductStatus;
      isActive?: string;
      isFeatured?: string;
      isPopular?: string;
      page?: string;
      pageSize?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    };

    const result = await productService.getProducts({
      search,
      categoryId,
      status,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      isFeatured: isFeatured === 'true' ? true : isFeatured === 'false' ? false : undefined,
      isPopular: isPopular === 'true' ? true : isPopular === 'false' ? false : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      sortBy,
      sortOrder
    });

    return result;
  });

  app.get('/api/admin/products/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['products:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await productService.getProductById(id);

    if (!product) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    return product;
  });

  app.get('/api/admin/products/slug/:slug', {
    preHandler: requireAdmin({ requiredPermissions: ['products:read'] })
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const product = await productService.getProductBySlug(slug);

    if (!product) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    return product;
  });

  app.post('/api/admin/products', {
    preHandler: requireAdmin({ requiredPermissions: ['products:create'] })
  }, async (request, _reply) => {
    const admin = await authenticateAdmin(request, _reply);
    const body = request.body as CreateProductInput;

    try {
      const product = await productService.createProduct(body, admin.id);
      return _reply.status(201).send({ product });
    } catch (error) {
      return _reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create product' });
    }
  });

  app.put('/api/admin/products/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['products:update'] })
  }, async (request, _reply) => {
    const admin = await authenticateAdmin(request, _reply);
    const { id } = request.params as { id: string };
    const body = request.body as UpdateProductInput;

    try {
      const product = await productService.updateProduct(id, body, admin.id);
      return { product };
    } catch (error) {
      return _reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update product' });
    }
  });

  app.delete('/api/admin/products/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['products:delete'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      await productService.deleteProduct(id, admin.id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete product';
      if (message === 'Product not found') {
        return reply.status(404).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  });

  app.post('/api/admin/products/:id/activate', {
    preHandler: requireAdmin({ requiredPermissions: ['products:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const product = await productService.activateProduct(id, admin.id);
      return { product };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to activate product' });
    }
  });

  app.post('/api/admin/products/:id/deactivate', {
    preHandler: requireAdmin({ requiredPermissions: ['products:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const product = await productService.deactivateProduct(id, admin.id);
      return { product };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to deactivate product' });
    }
  });

  app.post('/api/admin/products/:id/stock', {
    preHandler: requireAdmin({ requiredPermissions: ['stock:manage'] })
  }, async (request, _reply) => {
    const admin = await authenticateAdmin(request, _reply);
    const { id } = request.params as { id: string };
    const body = request.body as { deliveryType: DeliveryType; values: string[] };

    if (!body.deliveryType || !body.values || !Array.isArray(body.values) || body.values.length === 0) {
      return _reply.status(400).send({ error: 'deliveryType and values array are required' });
    }

    try {
      await productService.addStock(id, body.deliveryType, body.values, admin.id);
      return { success: true, count: body.values.length };
    } catch (error) {
      return _reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to add stock' });
    }
  });

  app.post('/api/admin/products/:id/duplicate', {
    preHandler: requireAdmin({ requiredPermissions: ['products:create'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const product = await productService.duplicateProduct(id, admin.id);
      return reply.status(201).send({ product });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to duplicate product' });
    }
  });

  app.post('/api/admin/products/bulk', {
    preHandler: requireAdmin({ requiredPermissions: ['products:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      ids: string[];
      action: 'ACTIVATE' | 'DEACTIVATE' | 'ARCHIVE' | 'CHANGE_CATEGORY';
      categoryId?: string;
    };

    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 100) {
      return reply.status(400).send({ error: 'Select between 1 and 100 products' });
    }

    if (!body.action || !['ACTIVATE', 'DEACTIVATE', 'ARCHIVE', 'CHANGE_CATEGORY'].includes(body.action)) {
      return reply.status(400).send({ error: 'Invalid bulk action' });
    }

    if (body.action === 'CHANGE_CATEGORY' && !body.categoryId) {
      return reply.status(400).send({ error: 'categoryId is required for CHANGE_CATEGORY' });
    }

    try {
      const result = await productService.bulkUpdateProducts(
        body.ids,
        body.action,
        body.categoryId,
        admin.id
      );
      return { success: result.success, updatedCount: result.updatedCount };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update products' });
    }
  });

  // ==================== ADMIN CATEGORIES ====================
  app.get('/api/admin/categories', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:read'] })
  }, async (request, _reply) => {
    const { search, isActive, isArchived, page, pageSize, sortBy, sortOrder } = request.query as {
      search?: string;
      isActive?: string;
      isArchived?: string;
      page?: string;
      pageSize?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    };

    const result = await categoryService.getCategories({
      search,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      isArchived: isArchived === 'true' ? true : isArchived === 'false' ? false : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      sortBy,
      sortOrder
    });

    return result;
  });

  app.get('/api/admin/categories/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const category = await categoryService.getCategoryById(id);

    if (!category) {
      return reply.status(404).send({ error: 'Category not found' });
    }

    return category;
  });

  app.get('/api/admin/categories/slug/:slug', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:read'] })
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const category = await categoryService.getCategoryBySlug(slug);

    if (!category) {
      return reply.status(404).send({ error: 'Category not found' });
    }

    return category;
  });

  app.post('/api/admin/categories', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:create'] })
  }, async (request, _reply) => {
    const admin = await authenticateAdmin(request, _reply);
    const body = request.body as CreateCategoryInput;

    try {
      const category = await categoryService.createCategory(body, admin.id);
      return _reply.status(201).send({ category });
    } catch (error) {
      return _reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create category' });
    }
  });

  app.put('/api/admin/categories/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, _reply) => {
    const admin = await authenticateAdmin(request, _reply);
    const { id } = request.params as { id: string };
    const body = request.body as UpdateCategoryInput;

    try {
      const category = await categoryService.updateCategory(id, body, admin.id);
      return { category };
    } catch (error) {
      return _reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update category' });
    }
  });

  app.delete('/api/admin/categories/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:delete'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      await categoryService.deleteCategory(id, admin.id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete category';
      if (message === 'Category not found') {
        return reply.status(404).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  });

  app.post('/api/admin/categories/:id/activate', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const category = await categoryService.activateCategory(id, admin.id);
      return { category };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to activate category' });
    }
  });

  app.post('/api/admin/categories/:id/deactivate', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const category = await categoryService.deactivateCategory(id, admin.id);
      return { category };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to deactivate category' });
    }
  });

  app.post('/api/admin/categories/:id/archive', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const category = await categoryService.archiveCategory(id, admin.id);
      return { category };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to archive category' });
    }
  });

  app.post('/api/admin/categories/reorder', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as { id: string; sortOrder: number }[];

    if (!Array.isArray(body)) {
      return reply.status(400).send({ error: 'Expected array of category orders' });
    }

    try {
      await categoryService.reorderCategories(body, admin.id);
      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to reorder categories' });
    }
  });

  // ==================== ADMIN BANNERS ====================
  app.get('/api/admin/banners', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:read'] })
  }, async (request, _reply) => {
    const { search, isActive, targetType, page, pageSize } = request.query as {
      search?: string;
      isActive?: string;
      targetType?: string;
      page?: string;
      pageSize?: string;
    };

    const where: Record<string, unknown> = {};
    if (isActive === 'true') where.isActive = true;
    else if (isActive === 'false') where.isActive = false;
    if (targetType) where.targetType = targetType;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { subtitle: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const size = pageSize ? Math.min(100, Math.max(1, parseInt(pageSize, 10))) : 20;

    const [banners, total] = await Promise.all([
      prisma.banner.findMany({
        where,
        include: {
          targetCategory: { select: { id: true, name: true, slug: true } },
          targetProduct: { select: { id: true, name: true, slug: true } }
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (pageNum - 1) * size,
        take: size
      }),
      prisma.banner.count({ where })
    ]);

    return { banners, total, page: pageNum, pageSize: size };
  });

  app.get('/api/admin/banners/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const banner = await prisma.banner.findUnique({
      where: { id },
      include: {
        targetCategory: { select: { id: true, name: true, slug: true } },
        targetProduct: { select: { id: true, name: true, slug: true } }
      }
    });
    if (!banner) return reply.status(404).send({ error: 'Banner not found' });
    return banner;
  });

  app.post('/api/admin/banners', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:create'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      title: string;
      subtitle?: string;
      imageUrl?: string;
      buttonText?: string;
      buttonDestination?: string;
      targetType?: string;
      targetCategoryId?: string;
      targetProductId?: string;
      targetPage?: string;
      isActive?: boolean;
      sortOrder?: number;
      startsAt?: string;
      endsAt?: string;
    };

    try {
      const banner = await prisma.banner.create({
        data: {
          title: body.title,
          subtitle: body.subtitle ?? null,
          imageUrl: normalizeBannerImageUrl(body.imageUrl ?? null),
          buttonText: body.buttonText ?? null,
          buttonDestination: body.buttonDestination ?? null,
          targetType: (body.targetType as 'HOME' | 'CATEGORY' | 'PRODUCT' | 'PROMOTION' | 'PAGE') ?? 'HOME',
          targetCategoryId: body.targetCategoryId ?? null,
          targetProductId: body.targetProductId ?? null,
          targetPage: body.targetPage ?? null,
          isActive: body.isActive ?? true,
          sortOrder: body.sortOrder ?? 0,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          endsAt: body.endsAt ? new Date(body.endsAt) : null
        },
        include: {
          targetCategory: { select: { id: true, name: true, slug: true } },
          targetProduct: { select: { id: true, name: true, slug: true } }
        }
      });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'Banner',
          entityId: banner.id,
          action: 'BANNER_CREATED',
          newValue: {
            title: banner.title,
            targetType: banner.targetType,
            isActive: banner.isActive,
            sortOrder: banner.sortOrder
          }
        }
      });

      return reply.status(201).send({ banner });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create banner' });
    }
  });

  app.put('/api/admin/banners/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const existing = await prisma.banner.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Banner not found' });

    const data: Record<string, unknown> = {};
    const allowedFields = ['title', 'subtitle', 'imageUrl', 'buttonText', 'buttonDestination', 'targetType', 'targetCategoryId', 'targetProductId', 'targetPage', 'isActive', 'sortOrder', 'startsAt', 'endsAt'];
    for (const field of allowedFields) {
      if (field in body) {
        if (field === 'startsAt' || field === 'endsAt') {
          data[field] = body[field] ? new Date(body[field] as string) : null;
        } else if (field === 'imageUrl') {
          // Recognized Google Drive sharing links are stored as direct-view URLs.
          data[field] = normalizeBannerImageUrl(body[field] as string | null);
        } else {
          data[field] = body[field];
        }
      }
    }

    try {
      const banner = await prisma.banner.update({
        where: { id },
        data,
        include: {
          targetCategory: { select: { id: true, name: true, slug: true } },
          targetProduct: { select: { id: true, name: true, slug: true } }
        }
      });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'Banner',
          entityId: banner.id,
          action: 'BANNER_UPDATED',
          oldValue: {
            title: existing.title,
            targetType: existing.targetType,
            isActive: existing.isActive
          },
          newValue: {
            title: banner.title,
            targetType: banner.targetType,
            isActive: banner.isActive,
            sortOrder: banner.sortOrder
          }
        }
      });

      return { banner };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update banner' });
    }
  });

  app.delete('/api/admin/banners/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:delete'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    const existing = await prisma.banner.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Banner not found' });

    try {
      await prisma.banner.delete({ where: { id } });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'Banner',
          entityId: id,
          action: 'BANNER_DELETED',
          oldValue: {
            title: existing.title,
            targetType: existing.targetType,
            isActive: existing.isActive
          }
        }
      });

      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete banner' });
    }
  });

  app.post('/api/admin/banners/:id/activate', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const banner = await prisma.banner.update({
        where: { id },
        data: { isActive: true },
        include: {
          targetCategory: { select: { id: true, name: true, slug: true } },
          targetProduct: { select: { id: true, name: true, slug: true } }
        }
      });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'Banner',
          entityId: id,
          action: 'BANNER_ACTIVATED'
        }
      });

      return { banner };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to activate banner' });
    }
  });

  app.post('/api/admin/banners/:id/deactivate', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const banner = await prisma.banner.update({
        where: { id },
        data: { isActive: false },
        include: {
          targetCategory: { select: { id: true, name: true, slug: true } },
          targetProduct: { select: { id: true, name: true, slug: true } }
        }
      });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'Banner',
          entityId: id,
          action: 'BANNER_DEACTIVATED'
        }
      });

      return { banner };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to deactivate banner' });
    }
  });

  app.post('/api/admin/banners/reorder', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as { id: string; sortOrder: number }[];

    if (!Array.isArray(body)) {
      return reply.status(400).send({ error: 'Expected array of banner orders' });
    }

    try {
      await prisma.$transaction(
        body.map((item) =>
          prisma.banner.update({
            where: { id: item.id },
            data: { sortOrder: item.sortOrder }
          })
        )
      );

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'Banner',
          action: 'BANNERS_REORDERED',
          newValue: { count: body.length }
        }
      });

      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to reorder banners' });
    }
  });

  // ==================== OWNED MEDIA (permanent uploads) ====================
  // Admin-uploaded images are stored as PERMANENT application-owned assets
  // and served at /api/media/:filename. The stored URL on games/banners/etc.
  // is this stable relative path: it never expires, is never rewritten, and
  // can only be removed via the explicit DELETE endpoint below. No read
  // operation here ever mutates a record; no worker ever touches these files.

  app.post('/api/admin/media', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:create'] }),
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    bodyLimit: 8 * 1024 * 1024
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as { dataBase64?: unknown };

    if (typeof body?.dataBase64 !== 'string') {
      return reply.status(400).send({ error: 'Image data is required' });
    }

    try {
      const asset = await mediaService.saveFromBase64({ dataBase64: body.dataBase64, adminId: admin.id });
      return reply.status(201).send({ asset });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to store image' });
    }
  });

  // Public READ-ONLY media serving. Strict filename shape + registry lookup;
  // immutable caching is safe because filenames are unique UUIDs that are
  // never overwritten in place.
  app.get('/api/media/:filename', {
    config: { rateLimit: { max: 300, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const resolved = await mediaService.resolveForServe(filename);
    if (!resolved) {
      return reply.status(404).send({ error: 'Image not found' });
    }
    const stream = createReadStream(resolved.absolutePath);
    return reply
      .status(200)
      .header('Content-Type', resolved.mimeType)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(stream);
  });

  app.get('/api/admin/media', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:read'] })
  }, async (request, reply) => {
    await authenticateAdmin(request, reply);
    const query = request.query as { page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 50) || 50));
    const [assets, total] = await Promise.all([
      mediaService.listAssets({ page, pageSize }),
      mediaService.countAssets()
    ]);
    return { assets, total, page, pageSize };
  });

  // The ONLY way an uploaded asset file is ever removed: an explicit admin
  // delete of the registry row. Refused while any record still references it.
  app.delete('/api/admin/media/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:delete'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    const result = await mediaService.deleteById(id);
    if (result.outcome === 'NOT_FOUND') {
      return reply.status(404).send({ error: 'Media asset not found' });
    }
    if (result.outcome === 'REFERENCED') {
      return reply.status(409).send({
        error: `This image is still in use by: ${result.references?.join(', ')}. Replace or remove it there first.`,
        references: result.references
      });
    }

    await prisma.auditLog.create({
      data: {
        adminId: admin.id,
        entityType: 'MediaAsset',
        entityId: id,
        action: 'MEDIA_ASSET_DELETED'
      }
    });

    return { success: true };
  });

  // Customer-facing banners endpoint
  app.get('/api/banners', { preHandler: authenticateTelegramUser }, async (request, _reply) => {
    const { targetType, categoryId } = request.query as {
      targetType?: string;
      categoryId?: string;
    };

    const now = new Date();
    // Customer visibility contract (computed from the schedule — never
    // enforced by mutating the row):
    //   isActive === true AND (startsAt is null OR now >= startsAt)
    //              AND (endsAt is null OR now < endsAt)
    // At/after endAt the banner simply stops being served; the record, its
    // imageUrl and any uploaded asset all remain for the admin.
    const where: Record<string, unknown> = {
      isActive: true,
      OR: [
        { startsAt: null },
        { startsAt: { lte: now } }
      ],
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }
      ]
    };

    if (targetType) where.targetType = targetType;
    if (categoryId) {
      // Targeting narrows via AND so the startsAt schedule window above survives.
      (where.AND as unknown[]).push({
        OR: [
          { targetType: 'HOME' },
          { AND: [{ targetType: 'CATEGORY' }, { targetCategoryId: categoryId }] }
        ]
      });
    }

    const banners = await prisma.banner.findMany({
      where,
      select: {
        id: true,
        title: true,
        subtitle: true,
        imageUrl: true,
        buttonText: true,
        buttonDestination: true,
        targetType: true,
        targetCategoryId: true,
        targetProductId: true,
        targetPage: true
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 20
    });

    // Serve direct-view URLs even for banners stored before normalization.
    return {
      banners: banners.map((banner) => ({
        ...banner,
        imageUrl: normalizeBannerImageUrl(banner.imageUrl)
      }))
    };
  });

  // ==================== ADMIN FLASH DEALS ====================
  app.get('/api/admin/flash-deals', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:read'] })
  }, async (request, _reply) => {
    const { search, isActive, page, pageSize } = request.query as {
      search?: string;
      isActive?: string;
      page?: string;
      pageSize?: string;
    };

    const where: Record<string, unknown> = {};
    if (isActive === 'true') where.isActive = true;
    else if (isActive === 'false') where.isActive = false;
    if (search) {
      where.product = { name: { contains: search, mode: 'insensitive' } };
    }

    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const size = pageSize ? Math.min(100, Math.max(1, parseInt(pageSize, 10))) : 20;

    const [deals, total] = await Promise.all([
      prisma.flashDeal.findMany({
        where,
        include: {
          product: {
            select: {
              id: true, name: true, slug: true, price: true, currency: true,
              imageUrl: true, deliveryType: true, status: true,
              category: { select: { id: true, name: true, slug: true } }
            }
          }
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (pageNum - 1) * size,
        take: size
      }),
      prisma.flashDeal.count({ where })
    ]);

    return { deals, total, page: pageNum, pageSize: size };
  });

  app.get('/api/admin/flash-deals/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deal = await prisma.flashDeal.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            id: true, name: true, slug: true, price: true, currency: true,
            imageUrl: true, deliveryType: true, status: true,
            category: { select: { id: true, name: true, slug: true } }
          }
        }
      }
    });
    if (!deal) return reply.status(404).send({ error: 'Flash deal not found' });
    return deal;
  });

  app.post('/api/admin/flash-deals', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:create'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      productId: string;
      discountType: string;
      discountValue: number | string;
      isActive?: boolean;
      sortOrder?: number;
      startsAt?: string;
      endsAt?: string;
    };

    try {
      const product = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!product) return reply.status(400).send({ error: 'Product not found' });

      const discountValue = Number(body.discountValue);
      if (discountValue <= 0) return reply.status(400).send({ error: 'Discount value must be positive' });

      let salePrice: number;
      const originalPrice = Number(product.price);

      if (body.discountType === 'PERCENTAGE') {
        if (discountValue > 100) return reply.status(400).send({ error: 'Percentage cannot exceed 100%' });
        salePrice = originalPrice * (1 - discountValue / 100);
      } else {
        if (discountValue >= originalPrice) return reply.status(400).send({ error: 'Fixed discount cannot exceed or equal product price' });
        salePrice = originalPrice - discountValue;
      }

      salePrice = Math.round(salePrice * 100) / 100;

      if (body.startsAt && body.endsAt && new Date(body.startsAt) >= new Date(body.endsAt)) {
        return reply.status(400).send({ error: 'End date must be after start date' });
      }

      const deal = await prisma.flashDeal.create({
        data: {
          productId: body.productId,
          discountType: body.discountType as 'PERCENTAGE' | 'FIXED',
          discountValue,
          salePrice,
          isActive: body.isActive ?? true,
          sortOrder: body.sortOrder ?? 0,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          endsAt: body.endsAt ? new Date(body.endsAt) : null
        },
        include: {
          product: {
            select: {
              id: true, name: true, slug: true, price: true, currency: true,
              imageUrl: true, deliveryType: true, status: true,
              category: { select: { id: true, name: true, slug: true } }
            }
          }
        }
      });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'FlashDeal',
          entityId: deal.id,
          action: 'FLASH_DEAL_CREATED',
          newValue: { productId: body.productId, discountType: body.discountType, discountValue, salePrice }
        }
      });

      return reply.status(201).send({ deal });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        return reply.status(400).send({ error: 'A flash deal already exists for this product' });
      }
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create flash deal' });
    }
  });

  app.put('/api/admin/flash-deals/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const existing = await prisma.flashDeal.findUnique({ where: { id }, include: { product: true } });
    if (!existing) return reply.status(404).send({ error: 'Flash deal not found' });

    const data: Record<string, unknown> = {};
    if (body.discountType) data.discountType = body.discountType;
    if (body.discountValue !== undefined) data.discountValue = Number(body.discountValue);
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.startsAt !== undefined) data.startsAt = body.startsAt ? new Date(body.startsAt as string) : null;
    if (body.endsAt !== undefined) data.endsAt = body.endsAt ? new Date(body.endsAt as string) : null;

    if (data.startsAt && data.endsAt && new Date(data.startsAt as Date) >= new Date(data.endsAt as Date)) {
      return reply.status(400).send({ error: 'End date must be after start date' });
    }

    const discountType = (data.discountType as string) || existing.discountType;
    const discountValue = data.discountValue !== undefined ? Number(data.discountValue) : Number(existing.discountValue);
    const originalPrice = Number(existing.product.price);

    if (discountValue <= 0) return reply.status(400).send({ error: 'Discount value must be positive' });
    if (discountType === 'PERCENTAGE' && discountValue > 100) {
      return reply.status(400).send({ error: 'Percentage cannot exceed 100%' });
    }
    if (discountType === 'FIXED' && discountValue >= originalPrice) {
      return reply.status(400).send({ error: 'Fixed discount cannot exceed or equal product price' });
    }

    let salePrice: number;
    if (discountType === 'PERCENTAGE') {
      salePrice = originalPrice * (1 - discountValue / 100);
    } else {
      salePrice = originalPrice - discountValue;
    }
    data.salePrice = Math.round(salePrice * 100) / 100;

    try {
      const deal = await prisma.flashDeal.update({
        where: { id },
        data,
        include: {
          product: {
            select: {
              id: true, name: true, slug: true, price: true, currency: true,
              imageUrl: true, deliveryType: true, status: true,
              category: { select: { id: true, name: true, slug: true } }
            }
          }
        }
      });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'FlashDeal',
          entityId: id,
          action: 'FLASH_DEAL_UPDATED',
          oldValue: { discountType: existing.discountType, discountValue: Number(existing.discountValue), salePrice: Number(existing.salePrice) },
          newValue: { discountType: deal.discountType, discountValue: Number(deal.discountValue), salePrice: Number(deal.salePrice) }
        }
      });

      return { deal };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update flash deal' });
    }
  });

  app.delete('/api/admin/flash-deals/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:delete'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    const existing = await prisma.flashDeal.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Flash deal not found' });

    try {
      await prisma.flashDeal.delete({ where: { id } });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'FlashDeal',
          entityId: id,
          action: 'FLASH_DEAL_DELETED',
          oldValue: { productId: existing.productId, discountType: existing.discountType }
        }
      });

      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete flash deal' });
    }
  });

  app.post('/api/admin/flash-deals/:id/activate', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const deal = await prisma.flashDeal.update({
        where: { id },
        data: { isActive: true },
        include: {
          product: {
            select: {
              id: true, name: true, slug: true, price: true, currency: true,
              imageUrl: true, deliveryType: true, status: true,
              category: { select: { id: true, name: true, slug: true } }
            }
          }
        }
      });

      await prisma.auditLog.create({
        data: { adminId: admin.id, entityType: 'FlashDeal', entityId: id, action: 'FLASH_DEAL_ACTIVATED' }
      });

      return { deal };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to activate flash deal' });
    }
  });

  app.post('/api/admin/flash-deals/:id/deactivate', {
    preHandler: requireAdmin({ requiredPermissions: ['categories:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const deal = await prisma.flashDeal.update({
        where: { id },
        data: { isActive: false },
        include: {
          product: {
            select: {
              id: true, name: true, slug: true, price: true, currency: true,
              imageUrl: true, deliveryType: true, status: true,
              category: { select: { id: true, name: true, slug: true } }
            }
          }
        }
      });

      await prisma.auditLog.create({
        data: { adminId: admin.id, entityType: 'FlashDeal', entityId: id, action: 'FLASH_DEAL_DEACTIVATED' }
      });

      return { deal };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to deactivate flash deal' });
    }
  });

  // Customer-facing flash deals
  app.get('/api/flash-deals', { preHandler: authenticateTelegramUser }, async (_request, _reply) => {
    const now = new Date();
    const deals = await prisma.flashDeal.findMany({
      where: {
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          { product: { isActive: true, status: 'ACTIVE' } }
        ]
      },
      include: {
        product: {
          select: {
            id: true, name: true, slug: true, price: true, currency: true,
            imageUrl: true, deliveryType: true, status: true, isActive: true, hideWhenOutOfStock: true
          }
        }
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 20
    });

    const activeDeals = deals.filter(d => d.product && d.product.status === 'ACTIVE');
    return { deals: activeDeals };
  });

  // Customer-facing flash deal for a single product
  app.get('/api/products/:slug/flash-deal', { preHandler: authenticateTelegramUser }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const now = new Date();

    const product = await prisma.product.findUnique({ where: { slug } });
    if (!product) return reply.status(404).send({ error: 'Product not found' });

    const deal = await prisma.flashDeal.findUnique({
      where: { productId: product.id },
      include: {
        product: {
          select: {
             id: true, name: true, slug: true, price: true, currency: true,
             imageUrl: true, deliveryType: true, status: true, isActive: true, hideWhenOutOfStock: true
          }
        }
      }
    });

    if (!deal || !deal.isActive || !deal.product.isActive || deal.product.status !== 'ACTIVE') return { deal: null };
    if (deal.startsAt && deal.startsAt > now) return { deal: null };
    if (deal.endsAt && deal.endsAt < now) return { deal: null };

    return { deal };
  });

  // ==================== FAVORITES ====================
  app.get('/api/favorites', async (request, _reply) => {
    // authenticateTelegramUser returns the user (it does not populate request.user)
    const { dbUser } = await authenticateTelegramUser(request, _reply);
    const { page, pageSize } = request.query as { page?: string; pageSize?: string };

    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const size = pageSize ? Math.min(100, Math.max(1, parseInt(pageSize, 10))) : 20;

    const [favorites, total] = await Promise.all([
      prisma.favorite.findMany({
        where: { userId: dbUser.id },
        include: {
          product: {
            select: {
              id: true, name: true, slug: true, price: true, currency: true,
              imageUrl: true, deliveryType: true, status: true, isActive: true,
              category: { select: { id: true, name: true, slug: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size
      }),
      prisma.favorite.count({ where: { userId: dbUser.id } })
    ]);

    return { favorites, total, page: pageNum, pageSize: size };
  });

  app.post('/api/favorites/:productId', async (request, reply) => {
    const { dbUser } = await authenticateTelegramUser(request, reply);
    const { productId } = request.params as { productId: string };

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return reply.status(404).send({ error: 'Product not found' });

    try {
      const favorite = await prisma.favorite.create({
        data: { userId: dbUser.id, productId }
      });
      return reply.status(201).send({ favorite });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        return reply.status(409).send({ error: 'Already favorited' });
      }
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to add favorite' });
    }
  });

  app.delete('/api/favorites/:productId', async (request, reply) => {
    const { dbUser } = await authenticateTelegramUser(request, reply);
    const { productId } = request.params as { productId: string };

    try {
      await prisma.favorite.deleteMany({
        where: { userId: dbUser.id, productId }
      });
      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to remove favorite' });
    }
  });

  app.get('/api/favorites/check/:productId', async (request, _reply) => {
    const { dbUser } = await authenticateTelegramUser(request, _reply);
    const { productId } = request.params as { productId: string };

    const favorite = await prisma.favorite.findUnique({
      where: { userId_productId: { userId: dbUser.id, productId } }
    });

    return { isFavorited: !!favorite };
  });

  // ==================== ADMIN ORDERS ====================
  app.get('/api/admin/orders', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:read'] })
  }, async (request, _reply) => {
    const { search, userId, status, paymentStatus, deliveryType, dateFrom, dateTo, page, pageSize, sortBy, sortOrder } = request.query as {
      search?: string;
      userId?: string;
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
      deliveryType?: 'all' | 'automatic' | 'hand_delivery' | 'waiting_delivery' | 'delivered';
      dateFrom?: string;
      dateTo?: string;
      page?: string;
      pageSize?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    };

    const result = await orderService.getOrders({
      search,
      userId,
      status,
      paymentStatus,
      deliveryType,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      sortBy,
      sortOrder
    });

    return result;
  });

  app.get('/api/admin/orders/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await orderService.getOrderById(id);

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }

    return order;
  });

  app.get('/api/admin/orders/number/:orderNumber', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:read'] })
  }, async (request, reply) => {
    const { orderNumber } = request.params as { orderNumber: string };
    const order = await orderService.getOrderByNumber(parseInt(orderNumber, 10));

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }

    return order;
  });

  app.get('/api/admin/orders/stats', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:read'] })
  }, async (_request, _reply) => {
    const stats = await orderService.getOrderStats();
    return stats;
  });

  app.get('/api/admin/orders/hand-delivery-count', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:read'] })
  }, async (_request, _reply) => {
    const count = await orderService.getPendingHandDeliveryCount();
    return { count };
  });

  app.post('/api/admin/orders/:id/cancel', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:update'] })
  }, async (request, _reply) => {
    const admin = await authenticateAdmin(request, _reply);
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };

    try {
      await orderService.cancelOrder(id, admin.id, body.reason);
      return { success: true };
    } catch (error) {
      return _reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to cancel order' });
    }
  });

  app.post('/api/admin/orders/:id/refund', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:update'] })
  }, async (request, _reply) => {
    const admin = await authenticateAdmin(request, _reply);
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string; amount?: string | number };

    try {
      const refund = await orderService.refundOrder(id, admin.id, body.reason, body.amount);
      return { success: true, refund };
    } catch (error) {
      return _reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to refund order' });
    }
  });

  app.post('/api/admin/orders/:id/fulfill', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:update'] })
  }, async (request, _reply) => {
    await authenticateAdmin(request, _reply);
    const { id } = request.params as { id: string };

    try {
      const result = await fulfillOrderAndNotify(id);
      return result;
    } catch (error) {
      return _reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to retry fulfillment' });
    }
  });

  app.post('/api/admin/orders/:id/manual-deliver', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      orderItemId?: string;
      title?: string;
      content?: string;
    };

    if (!body.orderItemId || typeof body.orderItemId !== 'string') {
      return reply.status(400).send({ error: 'orderItemId is required' });
    }
    if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0 || body.title.length > 255) {
      return reply.status(400).send({ error: 'title is required (max 255 characters)' });
    }
    if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0 || body.content.length > 10000) {
      return reply.status(400).send({ error: 'content is required (max 10000 characters)' });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, isHandDelivery: true } }
          }
        }
      }
    });

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }
    if (order.status !== 'PAID' && order.status !== 'COMPLETED' && order.status !== 'FULFILLING') {
      return reply.status(400).send({ error: 'Order must be paid before delivery' });
    }

    const orderItem = order.items.find(item => item.id === body.orderItemId);
    if (!orderItem) {
      return reply.status(404).send({ error: 'Order item not found' });
    }

    if (!orderItem.product?.isHandDelivery) {
      return reply.status(400).send({ error: 'This product does not support manual delivery' });
    }

    const existingDelivery = await prisma.manualDelivery.findUnique({
      where: { orderItemId: body.orderItemId }
    });
    if (existingDelivery) {
      return reply.status(409).send({ error: 'This order item already has a delivery' });
    }

    const manualDelivery = await prisma.$transaction(async (tx) => {
      const delivery = await tx.manualDelivery.create({
        data: {
          orderItemId: body.orderItemId!,
          orderId: id,
          productId: orderItem.productId!,
          title: body.title!.trim(),
          content: body.content!.trim(),
          deliveredBy: admin.id
        }
      });

      await tx.fulfillmentRecord.upsert({
        where: { orderItemId: body.orderItemId! },
        create: {
          orderItemId: body.orderItemId!,
          status: 'DELIVERED',
          deliveryRef: `manual-${delivery.id}`,
          deliveredAt: new Date(),
          attemptCount: 1
        },
        update: {
          status: 'DELIVERED',
          deliveryRef: `manual-${delivery.id}`,
          deliveredAt: new Date()
        }
      });

      const allItems = order.items;
      const allDelivered = await Promise.all(
        allItems.map(async (item) => {
          const fulfillment = await tx.fulfillmentRecord.findUnique({
            where: { orderItemId: item.id }
          });
          return fulfillment?.status === 'DELIVERED';
        })
      );

      if (allDelivered.every(Boolean) && allItems.length > 0) {
        await tx.order.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: new Date() }
        });
      } else if (order.status === 'PAID') {
        await tx.order.update({
          where: { id },
          data: { status: 'FULFILLING' }
        });
      }

      await tx.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'ManualDelivery',
          entityId: delivery.id,
          action: 'CREATE',
          newValue: {
            orderId: id,
            orderItemId: body.orderItemId,
            title: body.title,
            productId: orderItem.productId
          }
        }
      });

      return delivery;
    });

    const updatedOrder = await prisma.order.findUnique({
      where: { id },
      select: { status: true, orderNumber: true, total: true, currency: true, user: { select: { telegramId: true } } }
    });
    if (updatedOrder?.status === 'COMPLETED' && updatedOrder.user) {
      void notificationService.sendHandDeliveryCompletedNotification({
        chatId: updatedOrder.user.telegramId.toString(),
        orderNumber: updatedOrder.orderNumber,
        items: [],
        total: updatedOrder.total.toString(),
        currency: updatedOrder.currency
      });
    }

    return { delivery: manualDelivery };
  });

  app.get('/api/admin/orders/:id/deliveries', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }

    const deliveries = await prisma.manualDelivery.findMany({
      where: { orderId: id },
      include: {
        orderItem: { select: { id: true, productNameSnapshot: true } },
        product: { select: { id: true, name: true, slug: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return { deliveries };
  });

  app.post('/api/admin/payments/:id/retry', {
    preHandler: requireAdmin({ requiredPermissions: ['payments:manage'] })
  }, async (request, _reply) => {
    const admin = await authenticateAdmin(request, _reply);
    const { id } = request.params as { id: string };

    try {
      await orderService.retryFailedPayment(id, admin.id);
      return { success: true };
    } catch (error) {
      return _reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to retry payment' });
    }
  });

  app.post('/api/admin/payments/:id/recheck', {
    preHandler: requireAdmin({ requiredPermissions: ['payments:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    const payment = await prisma.payment.findUnique({
      where: { id },
      select: { id: true, status: true, provider: true, orderId: true, reference: true }
    });

    if (!payment) {
      return reply.status(404).send({ error: 'Payment not found' });
    }

    if (payment.provider !== 'KHQR' && payment.provider !== 'BAKONG') {
      return reply.status(400).send({
        error: `Only KHQR/Bakong payments can be rechecked against Bakong (this payment is ${payment.provider})`
      });
    }

    if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') {
      return reply.status(400).send({
        error: `Payment is already ${payment.status.toLowerCase()}; recheck only applies to pending payments`
      });
    }

    try {
      const result = await paymentService.verifyPayment(id);

      let fulfillment: { success: boolean; errors: unknown[] } | null = null;
      if (result.status === 'SUCCEEDED' && payment.orderId) {
        const order = await prisma.order.findUnique({
          where: { id: payment.orderId },
          select: { status: true }
        });
        if (order && order.status !== 'COMPLETED') {
          fulfillment = await fulfillOrderAndNotify(payment.orderId);
          if (!fulfillment.success && fulfillment.errors.length > 0) {
            request.log.warn({ orderId: payment.orderId, errors: fulfillment.errors }, 'Fulfillment incomplete after admin payment recheck');
          }
        }
      }

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          entityType: 'Payment',
          entityId: payment.id,
          action: 'RECHECK',
          oldValue: {
            status: payment.status,
            provider: payment.provider,
            reference: payment.reference
          },
          newValue: {
            status: result.status,
            success: result.success,
            providerTransactionHash: result.providerTransactionHash ?? null,
            providerReference: result.providerReference ?? null,
            error: result.error ?? null
          }
        }
      });

      return {
        success: result.success,
        status: result.status,
        providerTransactionHash: result.providerTransactionHash ?? null,
        providerReference: result.providerReference ?? null,
        paidAt: result.paidAt ?? null,
        error: result.error ?? null,
        fulfillment
      };
    } catch (error) {
      request.log.error({ paymentId: id, error }, 'Admin payment recheck failed');
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Failed to recheck payment' });
    }
  });

  // ==================== ADMIN STOCK ====================
  app.get('/api/admin/stock/summary', {
    preHandler: requireAdmin({ requiredPermissions: ['stock:read'] })
  }, async (_request, _reply) => {
    const summary = await stockService.getAvailableStockInfo('all');
    return summary;
  });

  // ==================== ADMIN AUDIT ====================
  app.get('/api/admin/audit', {
    preHandler: requireAdmin({ requiredPermissions: ['audit:read'] })
  }, async (request, _reply) => {
    const { adminId, entityType, entityId, action, dateFrom, dateTo, page, pageSize } = request.query as {
      adminId?: string;
      entityType?: string;
      entityId?: string;
      action?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: string;
      pageSize?: string;
    };

    const result = await auditService.getAuditLogs({
      adminId,
      entityType,
      entityId,
      action,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined
    });

    return result;
  });

  app.get('/api/admin/audit/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['audit:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const log = await auditService.getAuditLogById(id);

    if (!log) {
      return reply.status(404).send({ error: 'Audit log not found' });
    }

    return log;
  });

  app.get('/api/admin/audit/entity/:entityType/:entityId', {
    preHandler: requireAdmin({ requiredPermissions: ['audit:read'] })
  }, async (request, _reply) => {
    const { entityType, entityId } = request.params as { entityType: string; entityId: string };
    const history = await auditService.getEntityHistory(entityType, entityId);
    return { history };
  });

  app.get('/api/admin/audit/admin/:adminId', {
    preHandler: requireAdmin({ requiredPermissions: ['audit:read'] })
  }, async (request, _reply) => {
    const { adminId } = request.params as { adminId: string };
    const { limit = '50' } = request.query as { limit?: string };

    const activity = await auditService.getAdminActivity(adminId, parseInt(limit, 10));
    return { activity };
  });

  app.get('/api/admin/audit/summary', {
    preHandler: requireAdmin({ requiredPermissions: ['audit:read'] })
  }, async (request, _reply) => {
    const { dateFrom, dateTo } = request.query as { dateFrom?: string; dateTo?: string };
    const summary = await auditService.getActionSummary(
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined
    );
    return summary;
  });

  // ==================== ADMIN USERS ====================
  app.get('/api/admin/users', {
    preHandler: requireAdmin({ requiredPermissions: ['users:read'] })
  }, async (request, _reply) => {
    const { search, status, page, pageSize } = request.query as {
      search?: string;
      status?: UserStatus;
      page?: string;
      pageSize?: string;
    };

    const result = await adminUserService.getUsers({
      search,
      status,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined
    });

    return result;
  });

  app.get('/api/admin/users/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['users:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await adminUserService.getUserById(id);

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return user;
  });

  app.post('/api/admin/users/:id/status', {
    preHandler: requireAdmin({ requiredPermissions: ['users:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as { status: UserStatus; reason?: string };

    if (!body.status || !['ACTIVE', 'SUSPENDED', 'BANNED'].includes(body.status)) {
      return reply.status(400).send({ error: 'Invalid user status' });
    }

    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 500)) {
      return reply.status(400).send({ error: 'Invalid reason' });
    }

    try {
      const user = await adminUserService.setUserStatus(id, body.status, admin.id, body.reason);
      return { user };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update user status' });
    }
  });

  // ==================== ADMIN WALLET ====================
  app.get('/api/admin/wallets', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (request, _reply) => {
    const { search, page, pageSize } = request.query as {
      search?: string;
      page?: string;
      pageSize?: string;
    };

    const result = await adminWalletService.getWallets({
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined
    });

    return result;
  });

  app.get('/api/admin/wallets/user/:userId', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const detail = await adminWalletService.getWalletDetail(userId);

    if (!detail) {
      return reply.status(404).send({ error: 'Wallet not found' });
    }

    return detail;
  });

  app.post('/api/admin/wallets/adjustments', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] }),
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      userId: string;
      type: 'ADJUSTMENT' | 'BONUS';
      amount: string | number;
      reason: string;
    };

    if (!body.userId || !body.type || !['ADJUSTMENT', 'BONUS'].includes(body.type)) {
      return reply.status(400).send({ error: 'userId and type (ADJUSTMENT|BONUS) are required' });
    }

    if (body.amount === undefined || body.amount === null || body.amount === '' || Number.isNaN(Number(body.amount))) {
      return reply.status(400).send({ error: 'A valid amount is required' });
    }

    if (!body.reason || typeof body.reason !== 'string' || body.reason.length > 500) {
      return reply.status(400).send({ error: 'A reason (max 500 chars) is required for wallet adjustments' });
    }

    try {
      const result = await adminWalletService.adjustBalance(
        body.userId,
        body.type,
        body.amount,
        body.reason,
        admin.id
      );
      return reply.status(201).send(result);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to adjust balance' });
    }
  });

  // ==================== ADMIN TICKETS ====================
  app.get('/api/admin/tickets/unread-count', {
    preHandler: requireAdmin({ requiredPermissions: ['tickets:read'] })
  }, async (_request, _reply) => {
    return adminTicketService.getUnreadCount();
  });

  app.get('/api/admin/tickets', {
    preHandler: requireAdmin({ requiredPermissions: ['tickets:read'] })
  }, async (request, _reply) => {
    const { search, status, userId, page, pageSize } = request.query as {
      search?: string;
      status?: SupportTicketStatus;
      userId?: string;
      page?: string;
      pageSize?: string;
    };

    const result = await adminTicketService.getTickets({
      search,
      status,
      userId,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined
    });

    return result;
  });

  app.get('/api/admin/tickets/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['tickets:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ticket = await adminTicketService.getTicketById(id);

    if (!ticket) {
      return reply.status(404).send({ error: 'Ticket not found' });
    }

    return ticket;
  });

  app.post('/api/admin/tickets/:id/messages', {
    preHandler: requireAdmin({ requiredPermissions: ['tickets:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as { body: string };

    if (!body.body || typeof body.body !== 'string' || body.body.length > 4000) {
      return reply.status(400).send({ error: 'A message body (max 4000 chars) is required' });
    }

    try {
      const message = await adminTicketService.replyToTicket(id, admin.id, body.body);
      return reply.status(201).send({ message });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to reply to ticket' });
    }
  });

  app.post('/api/admin/tickets/:id/status', {
    preHandler: requireAdmin({ requiredPermissions: ['tickets:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as { status: SupportTicketStatus };

    if (!body.status || !['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(body.status)) {
      return reply.status(400).send({ error: 'Invalid ticket status' });
    }

    try {
      const result = await adminTicketService.updateTicketStatus(id, body.status, admin.id);
      return { ticket: result };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update ticket status' });
    }
  });

  // ==================== ADMIN SETTINGS ====================
  app.get('/api/admin/settings', {
    preHandler: requireAdmin({ requiredPermissions: ['settings:read'] })
  }, async (_request, _reply) => {
    const result = await adminSettingsService.getSettings();
    return result;
  });

  app.put('/api/admin/settings/:key', {
    preHandler: requireAdmin({ requiredPermissions: ['settings:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { key } = request.params as { key: string };
    const body = request.body as { value: unknown };

    try {
      const setting = await adminSettingsService.updateSetting(key, body.value, admin.id);
      return { setting };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update setting' });
    }
  });

  // ==================== ADMIN NOTIFICATION TARGETS ====================
  app.get('/api/admin/notification-targets', {
    preHandler: requireAdmin({ requiredPermissions: ['notifications:read'] })
  }, async (_request, _reply) => {
    const result = await adminSettingsService.getNotificationTargets();
    return result;
  });

  app.post('/api/admin/notification-targets', {
    preHandler: requireAdmin({ requiredPermissions: ['notifications:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      chatId: string | number;
      name: string;
      channel?: 'TELEGRAM_GROUP' | 'TELEGRAM_USER';
      eventTypes?: string[];
      isActive?: boolean;
    };

    if (body.chatId === undefined || body.chatId === null || body.chatId === '') {
      return reply.status(400).send({ error: 'chatId is required' });
    }

    if (!body.name || typeof body.name !== 'string' || body.name.length > 255) {
      return reply.status(400).send({ error: 'name is required (max 255 chars)' });
    }

    try {
      const target = await adminSettingsService.createNotificationTarget(
        {
          chatId: body.chatId,
          name: body.name,
          channel: body.channel,
          eventTypes: body.eventTypes,
          isActive: body.isActive
        },
        admin.id
      );
      return reply.status(201).send({ target });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create notification target' });
    }
  });

  app.put('/api/admin/notification-targets/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['notifications:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      channel?: 'TELEGRAM_GROUP' | 'TELEGRAM_USER';
      eventTypes?: string[];
      isActive?: boolean;
    };

    try {
      const target = await adminSettingsService.updateNotificationTarget(id, body, admin.id);
      return { target };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update notification target' });
    }
  });

  app.delete('/api/admin/notification-targets/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['notifications:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      await adminSettingsService.deleteNotificationTarget(id, admin.id);
      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete notification target' });
    }
  });

  app.post('/api/admin/notification-targets/:id/test', {
    preHandler: requireAdmin({ requiredPermissions: ['notifications:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    const target = await prisma.telegramNotificationTarget.findUnique({
      where: { id }
    });

    if (!target) {
      return reply.status(404).send({ error: 'Notification target not found' });
    }

    const result = await notificationService.sendTestMessage(target.chatId.toString());

    await prisma.auditLog.create({
      data: {
        adminId: admin.id,
        entityType: 'TelegramNotificationTarget',
        entityId: target.id,
        action: 'TEST_MESSAGE_SENT',
        newValue: {
          success: result.success,
          error: result.error,
          chatId: target.chatId.toString()
        }
      }
    });

    return { success: result.success, error: result.error };
  });

  // ==================== ADMIN SECURITY EVENTS ====================
  app.get('/api/admin/security-events', {
    preHandler: requireAdmin({ requiredPermissions: ['audit:read'] })
  }, async (request, _reply) => {
    const { eventType, severity, search, page = '1', pageSize = '50' } = request.query as {
      eventType?: string;
      severity?: SecurityEventSeverity;
      search?: string;
      page?: string;
      pageSize?: string;
    };

    const result = await securityService.getEvents({
      eventType,
      severity,
      search,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10)
    });

    return result;
  });

  // ==================== ADMIN TOP-UP PACKAGES ====================
  app.get('/api/admin/topup/packages', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (request, _reply) => {
    const { search, gameId, isActive, page = '1', pageSize = '50' } = request.query as {
      search?: string;
      gameId?: string;
      isActive?: string;
      page?: string;
      pageSize?: string;
    };

    const result = await adminTopUpService.getPackages({
      search,
      gameId,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 50
    });
    return result;
  });

  app.post('/api/admin/topup/packages', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      gameId: string;
      name: string;
      diamondAmount?: number;
      content?: string | null;
      price: string | number;
      currency?: string;
      providerCost?: string | number | null;
      providerOfferId?: string | null;
      isActive?: boolean;
      sortOrder?: number;
      icon?: string | null;
      imageUrl?: string | null;
      customerNote?: string | null;
      noteColor?: 'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'PURPLE';
    };

    if (!body.gameId || !body.name) {
      return reply.status(400).send({ error: 'gameId and name are required' });
    }

    try {
      const pkg = await adminTopUpService.createPackage(
        {
          gameId: body.gameId,
          name: body.name,
          diamondAmount: body.diamondAmount,
          content: body.content,
          price: String(body.price),
          currency: body.currency,
          providerCost: body.providerCost,
          providerOfferId: body.providerOfferId,
          isActive: body.isActive,
          sortOrder: body.sortOrder,
          icon: body.icon,
          imageUrl: body.imageUrl,
          customerNote: body.customerNote,
          noteColor: body.noteColor
        },
        admin.id
      );
      return reply.status(201).send({ pkg });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create top-up package' });
    }
  });

  app.put('/api/admin/topup/packages/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as {
      gameId?: string;
      name?: string;
      diamondAmount?: number;
      content?: string | null;
      price?: string | number;
      currency?: string;
      providerCost?: string | number | null;
      providerOfferId?: string | null;
      isActive?: boolean;
      sortOrder?: number;
      icon?: string | null;
      imageUrl?: string | null;
      customerNote?: string | null;
      noteColor?: 'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'PURPLE';
    };

    try {
      const pkg = await adminTopUpService.updatePackage(
        id,
        {
          gameId: body.gameId,
          name: body.name,
          diamondAmount: body.diamondAmount,
          content: body.content,
          price: body.price === undefined ? undefined : String(body.price),
          currency: body.currency,
          providerCost: body.providerCost,
          providerOfferId: body.providerOfferId,
          isActive: body.isActive,
          sortOrder: body.sortOrder,
          icon: body.icon,
          imageUrl: body.imageUrl,
          customerNote: body.customerNote,
          noteColor: body.noteColor
        },
        admin.id
      );
      return { pkg };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update top-up package' });
    }
  });

  app.post('/api/admin/topup/packages/:id/status', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as { isActive?: boolean };

    try {
      const pkg = await adminTopUpService.setPackageStatus(id, body.isActive !== false, admin.id);
      return {
        pkg: {
          ...pkg,
          price: pkg.price.toString()
        }
      };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update top-up package status' });
    }
  });

  app.post('/api/admin/topup/packages/:id/link-offer', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as {
      providerOfferId?: string | null;
      providerCost?: string | number | null;
    };

    try {
      const pkg = await adminTopUpService.linkPackageOffer(id, {
        providerOfferId: body.providerOfferId,
        providerCost: body.providerCost
      }, admin.id);
      return { pkg };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to link provider offer' });
    }
  });

  app.delete('/api/admin/topup/packages/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const result = await adminTopUpService.deletePackage(id, admin.id);
      return result;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete top-up package' });
    }
  });

  // ==================== ADMIN TOP-UP PROVIDERS ====================
  app.get('/api/admin/topup/providers', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (_request, _reply) => {
    return adminTopUpService.getProviders();
  });

  app.post('/api/admin/topup/providers', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      name: string;
      apiUrl: string;
      apiKey: string;
      status?: TopUpProviderStatus;
    };

    if (!body.name || !body.apiUrl || !body.apiKey) {
      return reply.status(400).send({ error: 'name, apiUrl, and apiKey are required' });
    }

    try {
      const provider = await adminTopUpService.createProvider(
        { name: body.name, apiUrl: body.apiUrl, apiKey: body.apiKey, status: body.status },
        admin.id
      );
      return reply.status(201).send({ provider });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create top-up provider' });
    }
  });

  app.put('/api/admin/topup/providers/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      apiUrl?: string;
      apiKey?: string;
      status?: TopUpProviderStatus;
    };

    try {
      const provider = await adminTopUpService.updateProvider(
        id,
        { name: body.name, apiUrl: body.apiUrl, apiKey: body.apiKey, status: body.status },
        admin.id
      );
      return { provider };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update top-up provider' });
    }
  });

  app.post('/api/admin/topup/providers/:id/status', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as { status: TopUpProviderStatus };

    if (!body.status || !['ACTIVE', 'DISABLED'].includes(body.status)) {
      return reply.status(400).send({ error: 'Invalid provider status' });
    }

    try {
      const provider = await adminTopUpService.setProviderStatus(id, body.status, admin.id);
      return { provider };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update provider status' });
    }
  });

  app.post('/api/admin/topup/providers/:id/test', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const result = await adminTopUpService.testProviderConnection(id);
      return result;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to test top-up provider' });
    }
  });

  app.delete('/api/admin/topup/providers/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const result = await adminTopUpService.deleteProvider(id, admin.id);
      return result;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete top-up provider' });
    }
  });

  // ==================== ADMIN TOP-UP PROVIDER SERVICES ====================

  app.get('/api/admin/topup/provider-services', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (request, _reply) => {
    const { providerId, search, isActive, page = '1', pageSize = '50' } = request.query as {
      providerId?: string;
      search?: string;
      isActive?: string;
      page?: string;
      pageSize?: string;
    };

    const result = await adminTopUpService.getProviderServices({
      providerId,
      search,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 50
    });
    return result;
  });

  app.post('/api/admin/topup/provider-services', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      providerId: string;
      providerServiceId: string;
      name: string;
      status?: TopUpProviderServiceStatus;
    };

    if (!body.providerId || !body.providerServiceId || !body.name) {
      return reply.status(400).send({ error: 'providerId, providerServiceId, and name are required' });
    }

    try {
      const service = await adminTopUpService.createProviderService(
        { providerId: body.providerId, providerServiceId: body.providerServiceId, name: body.name, status: body.status },
        admin.id
      );
      return reply.status(201).send({ service });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create top-up provider service' });
    }
  });

  app.put('/api/admin/topup/provider-services/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as {
      providerServiceId?: string;
      name?: string;
      status?: TopUpProviderServiceStatus;
    };

    try {
      const service = await adminTopUpService.updateProviderService(
        id,
        { providerServiceId: body.providerServiceId, name: body.name, status: body.status },
        admin.id
      );
      return { service };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update top-up provider service' });
    }
  });

  app.post('/api/admin/topup/provider-services/:id/status', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as { status: TopUpProviderServiceStatus };

    if (!body.status || !['ACTIVE', 'DISABLED'].includes(body.status)) {
      return reply.status(400).send({ error: 'Invalid provider service status' });
    }

    try {
      const service = await adminTopUpService.setProviderServiceStatus(id, body.status, admin.id);
      return { service };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update provider service status' });
    }
  });

  app.delete('/api/admin/topup/provider-services/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const result = await adminTopUpService.deleteProviderService(id, admin.id);
      return result;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete top-up provider service' });
    }
  });

  // ==================== ADMIN TOP-UP PROVIDER REMOTE CATALOG ====================

  app.get('/api/admin/topup/providers/:id/categories', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const result = await adminTopUpService.fetchRemoteCategories(id);
      return result;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to fetch remote categories' });
    }
  });

  app.get('/api/admin/topup/providers/:id/categories/:categoryId/offers', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (request, reply) => {
    const { id, categoryId } = request.params as { id: string; categoryId: string };

    try {
      const result = await adminTopUpService.fetchRemoteOffers(id, categoryId);
      return result;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to fetch remote offers' });
    }
  });

  // ==================== ADMIN TOP-UP GAMES ====================

  app.get('/api/admin/topup/games', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (request, _reply) => {
    const { search, isActive, page = '1', pageSize = '50' } = request.query as {
      search?: string;
      isActive?: string;
      page?: string;
      pageSize?: string;
    };

    const result = await adminTopUpService.getGames({
      search,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 50
    });
    return result;
  });

  app.get('/api/admin/topup/games/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await adminTopUpService.getGameById(id);
    if (!game) {
      return reply.status(404).send({ error: 'Top-up game not found' });
    }
    return { game };
  });

  app.post('/api/admin/topup/games', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      name: string;
      imageUrl?: string | null;
      providerId?: string | null;
      providerServiceId?: string;
      isActive?: boolean;
      sortOrder?: number;
    };

    if (!body.name) {
      return reply.status(400).send({ error: 'Game name is required' });
    }

    try {
      const game = await adminTopUpService.createGame(
        { name: body.name, imageUrl: body.imageUrl, providerId: body.providerId, providerServiceId: body.providerServiceId, isActive: body.isActive, sortOrder: body.sortOrder },
        admin.id
      );
      return reply.status(201).send({ game });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create top-up game' });
    }
  });

  app.put('/api/admin/topup/games/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      imageUrl?: string | null;
      providerId?: string | null;
      providerServiceId?: string;
      isActive?: boolean;
      sortOrder?: number;
    };

    try {
      const game = await adminTopUpService.updateGame(id, body, admin.id);
      return { game };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update top-up game' });
    }
  });

  app.post('/api/admin/topup/games/:id/status', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as { isActive?: boolean };

    try {
      const game = await adminTopUpService.setGameStatus(id, body.isActive !== false, admin.id);
      return { game };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update game status' });
    }
  });

  app.delete('/api/admin/topup/games/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    try {
      const result = await adminTopUpService.deleteGame(id, admin.id);
      return result;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete top-up game' });
    }
  });

  // ==================== ADMIN TOP-UP GAME INPUT CONFIGURATION ====================

  app.get('/api/admin/topup/game-configs', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async () => {
    return adminTopUpService.getGameConfigs();
  });

  // Live, provider-owned list of categories that currently support Player ID
  // validation, including their dynamic required fields. Read-only view over
  // the same cached catalog the verification service uses.
  app.get('/api/admin/topup/validation-support', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:read'] })
  }, async (request, reply) => {
    const { providerId } = request.query as { providerId?: string };

    try {
      if (providerId) {
        return await adminTopUpService.fetchValidationSupport(providerId);
      }
      // No provider specified: use the first active provider.
      const providers = await adminTopUpService.getProviders();
      const first = providers.providers.find((p) => p.status === 'ACTIVE') ?? providers.providers[0];
      if (!first) return { categories: [], providerId: null };
      return { ...(await adminTopUpService.fetchValidationSupport(first.id)), providerId: first.id };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to fetch validation support' });
    }
  });

  app.post('/api/admin/topup/game-configs', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      gameId: string;
      requirePlayerId?: boolean;
      requireServerId?: boolean;
      allowUnverifiedPurchase?: boolean;
      customerNote?: string | null;
      customFields?: Array<{ key: string; label: string; required?: boolean; placeholder?: string }> | null;
    };

    if (!body.gameId || typeof body.gameId !== 'string') {
      return reply.status(400).send({ error: 'Game ID is required' });
    }

    try {
      const config = await adminTopUpService.upsertGameConfig(
        {
          gameId: body.gameId,
          requirePlayerId: body.requirePlayerId,
          requireServerId: body.requireServerId,
          allowUnverifiedPurchase: body.allowUnverifiedPurchase,
          customerNote: body.customerNote,
          customFields: body.customFields
        },
        admin.id
      );
      return { config };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to save game input configuration' });
    }
  });

  app.delete('/api/admin/topup/game-configs/:gameId', {
    preHandler: requireAdmin({ requiredPermissions: ['wallet:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { gameId } = request.params as { gameId: string };

    try {
      const result = await adminTopUpService.deleteGameConfig(gameId, admin.id);
      return result;
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete game input configuration' });
    }
  });

  // ==================== ADMIN PAYMENTS ====================
  app.get('/api/admin/payments', {
    preHandler: requireAdmin({ requiredPermissions: ['payments:manage'] })
  }, async (request, _reply) => {
    const { provider, status, search, userId, dateFrom, dateTo, page, pageSize } = request.query as {
      provider?: PrismaPaymentProvider;
      status?: PaymentStatus;
      search?: string;
      userId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: string;
      pageSize?: string;
    };

    const result = await adminPaymentService.getPayments({
      provider,
      status,
      search,
      userId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined
    });

    return result;
  });

  app.get('/api/admin/payments/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['payments:manage'] })
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const payment = await adminPaymentService.getPaymentById(id);

    if (!payment) {
      return reply.status(404).send({ error: 'Payment not found' });
    }

    return payment;
  });

  // ==================== ADMIN ANALYTICS ====================
  app.get('/api/admin/analytics', {
    preHandler: requireAdmin()
  }, async (_request, _reply) => {
    const analytics = await dashboardService.getAnalytics();
    return analytics;
  });

  // ==================== SMM ====================
  app.get('/api/smm/services', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:read'] })
  }, async (request, _reply) => {
    const { category } = request.query as { category?: string };
    const result = await smmService.getServices({ category });
    const { provider, ...rest } = result;
    return { provider, ...rest };
  });

  app.get('/api/smm/services/:providerServiceId', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:read'] })
  }, async (request, reply) => {
    const { providerServiceId } = request.params as { providerServiceId: string };
    const result = await smmService.getService(providerServiceId);
    if (!result.service) {
      return reply.status(404).send({ error: 'Service not found' });
    }
    const { provider, ...rest } = result;
    return { provider, ...rest };
  });

  app.post('/api/smm/orders', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:create'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      orderId: string;
      serviceId: string;
      target: string;
      quantity: number;
      idempotencyKey?: string;
    };

    if (!body.orderId || !body.serviceId || !body.target || !body.quantity || body.quantity < 1) {
      return reply.status(400).send({ error: 'orderId, serviceId, target, and quantity are required' });
    }

    const result = await smmService.createSmmOrder(admin.id, body.orderId, 'SMM', body.idempotencyKey);
    if (!result.success) {
      return reply.status(400).send({ error: result.error });
    }

    return reply.status(201).send({ order: result.order });
  });

  app.get('/api/smm/orders/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:read'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const result = await smmService.getSmmOrderStatus(id, admin.id);
    if (!result.success) {
      return reply.status(404).send({ error: result.error || 'SMM order not found' });
    }
    return { order: result.order };
  });

  app.get('/api/smm/orders', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:read'] })
  }, async (request, _reply) => {
    const { page = '1', pageSize = '20', status, dateFrom, dateTo } = request.query as {
      page?: string;
      pageSize?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10)));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) createdAt.lte = new Date(dateTo);
      where.createdAt = createdAt;
    }

    const [orders, total] = await Promise.all([
      prisma.smmOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSizeNum,
        include: {
          service: {
            include: {
              provider: { select: { id: true, name: true, status: true } }
            }
          },
          provider: { select: { id: true, name: true, status: true } },
          order: { include: { user: { select: { firstName: true, lastName: true, username: true } } } }
        }
      }),
      prisma.smmOrder.count({ where })
    ]);

    return {
      orders: orders.map(o => ({
        ...o,
        amount: o.order?.total.toString() ?? '0',
        providerCost: o.service?.providerCost?.toString() ?? null
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  });

  app.post('/api/smm/orders/:id/retry', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    const smmOrder = await prisma.smmOrder.findUnique({
      where: { id },
      include: { order: true }
    });

    if (!smmOrder) {
      return reply.status(404).send({ error: 'SMM order not found' });
    }

    if (smmOrder.status !== 'FAILED' && smmOrder.status !== 'CANCELLED' && smmOrder.status !== 'REFUNDED') {
      return reply.status(400).send({ error: 'Only failed or cancelled orders can be retried' });
    }

    try {
      const provider = new (await import('./services/smm/real-provider.js')).RealSmmProvider();
      const result = await provider.getOrderStatus({ providerOrderId: smmOrder.providerOrderId ?? undefined, reference: smmOrder.id });

      if (!result.success) {
        return reply.status(400).send({ error: result.error || 'Failed to check status' });
      }

      if (result.status === 'COMPLETED' || result.status === 'PARTIAL') {
        // Already completed, update status
        await prisma.smmOrder.update({
          where: { id },
          data: { status: result.status, updatedAt: new Date() }
        });
      }

      // Retry the order - create a new SMM order
      const smmModule = await import('./services/smm/smm.service.js');
      const smmServiceInstance = new smmModule.SmmService(prisma);
      await smmServiceInstance.createSmmOrder(admin.id, smmOrder.orderId, 'SMM', `retry_${Date.now()}`);

      return { success: true, message: 'SMM order retry initiated' };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to retry SMM order' });
    }
  });

  // ==================== ADMIN SMM PROVIDERS & SERVICES ====================
  app.get('/api/admin/smm/providers', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:read'] })
  }, async (_request, _reply) => {
    const result = await smmAdminService.getProviders();
    return result;
  });

  app.post('/api/admin/smm/providers', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      name: string;
      apiUrl: string;
      apiKey: string;
      status?: SmmProviderStatus;
    };

    if (!body.name || !body.apiUrl || !body.apiKey) {
      return reply.status(400).send({ error: 'name, apiUrl, and apiKey are required' });
    }

    try {
      const provider = await smmAdminService.createProvider(
        { name: body.name, apiUrl: body.apiUrl, apiKey: body.apiKey, status: body.status },
        admin.id
      );
      return reply.status(201).send({ provider });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create SMM provider' });
    }
  });

  app.put('/api/admin/smm/providers/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      apiUrl?: string;
      apiKey?: string;
      status?: SmmProviderStatus;
    };

    try {
      const provider = await smmAdminService.updateProvider(
        id,
        {
          name: body.name,
          apiUrl: body.apiUrl,
          apiKey: body.apiKey,
          status: body.status
        },
        admin.id
      );
      return { provider };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update SMM provider' });
    }
  });

  app.post('/api/admin/smm/providers/:id/status', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as { status: SmmProviderStatus };

    if (!body.status || !['ACTIVE', 'DISABLED'].includes(body.status)) {
      return reply.status(400).send({ error: 'Invalid provider status' });
    }

    try {
      const provider = await smmAdminService.setProviderStatus(id, body.status, admin.id);
      return { provider };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update provider status' });
    }
  });

  app.get('/api/admin/smm/services', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:read'] })
  }, async (_request, _reply) => {
    const result = await smmAdminService.getServices();
    return result;
  });

  app.post('/api/admin/smm/services', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const body = request.body as {
      providerId: string;
      productId?: string | null;
      providerServiceId: string;
      name: string;
      providerCost?: string | number | null;
      minimumQuantity: number;
      maximumQuantity: number;
      status?: SmmServiceStatus;
    };

    if (!body.providerId || !body.providerServiceId || !body.name) {
      return reply.status(400).send({ error: 'providerId, providerServiceId, and name are required' });
    }

    if (!Number.isInteger(body.minimumQuantity) || body.minimumQuantity < 1 ||
        !Number.isInteger(body.maximumQuantity) || body.maximumQuantity < body.minimumQuantity) {
      return reply.status(400).send({ error: 'Invalid quantity range' });
    }

    try {
      const service = await smmAdminService.createService(
        {
          providerId: body.providerId,
          productId: body.productId,
          providerServiceId: body.providerServiceId,
          name: body.name,
          providerCost: body.providerCost,
          minimumQuantity: body.minimumQuantity,
          maximumQuantity: body.maximumQuantity,
          status: body.status
        },
        admin.id
      );
      return reply.status(201).send({ service });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create SMM service' });
    }
  });

  app.put('/api/admin/smm/services/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as {
      productId?: string | null;
      providerServiceId?: string;
      name?: string;
      providerCost?: string | number | null;
      minimumQuantity?: number;
      maximumQuantity?: number;
      status?: SmmServiceStatus;
    };

    try {
      const service = await smmAdminService.updateService(
        id,
        {
          productId: body.productId,
          providerServiceId: body.providerServiceId,
          name: body.name,
          providerCost: body.providerCost,
          minimumQuantity: body.minimumQuantity,
          maximumQuantity: body.maximumQuantity,
          status: body.status
        },
        admin.id
      );
      return { service };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update SMM service' });
    }
  });

  app.post('/api/admin/smm/services/:id/status', {
    preHandler: requireAdmin({ requiredPermissions: ['smm:manage'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as { status: SmmServiceStatus };

    if (!body.status || !['ACTIVE', 'DISABLED'].includes(body.status)) {
      return reply.status(400).send({ error: 'Invalid service status' });
    }

    try {
      const service = await smmAdminService.setServiceStatus(id, body.status, admin.id);
      return { service };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update service status' });
    }
  });

  // ─── Admin Coupon Management ───────────────────────────────────────────────

  app.get('/api/admin/coupons', {
    preHandler: requireAdmin({ requiredPermissions: ['products:read'] })
  }, async (request) => {
    const { page = '1', pageSize = '20', search, isActive } = request.query as {
      page?: string;
      pageSize?: string;
      search?: string;
      isActive?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10)));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [coupons, total] = await Promise.all([
      prisma.coupon.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSizeNum,
        include: {
          restrictedProduct: { select: { id: true, name: true, slug: true, price: true, imageUrl: true } },
          restrictedCategory: { select: { id: true, name: true, slug: true } },
          _count: { select: { usages: true } }
        }
      }),
      prisma.coupon.count({ where })
    ]);

    return {
      coupons: coupons.map((c) => ({
        ...c,
        usageCount: c._count.usages,
        _count: undefined
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  });

  app.post('/api/admin/coupons', {
    preHandler: requireAdmin({ requiredPermissions: ['products:create'] })
  }, async (request, reply) => {
    const body = request.body as {
      code: string;
      discountType: 'PERCENTAGE' | 'FIXED';
      discountValue: string | number;
      minimumOrderAmount?: string | number | null;
      maximumDiscountAmount?: string | number | null;
      startAt?: string | null;
      endAt?: string | null;
      usageLimit?: number | null;
      perUserLimit?: number | null;
      isActive?: boolean;
      restrictedProductId?: string | null;
      restrictedCategoryId?: string | null;
    };

    if (!body.code || !body.discountType || body.discountValue === undefined) {
      return reply.status(400).send({ error: 'code, discountType, and discountValue are required' });
    }

    const discountValue = parseFloat(String(body.discountValue));
    if (isNaN(discountValue) || discountValue <= 0) {
      return reply.status(400).send({ error: 'discountValue must be a positive number' });
    }

    if (body.discountType === 'PERCENTAGE' && discountValue > 100) {
      return reply.status(400).send({ error: 'Percentage discount cannot exceed 100%' });
    }

    const existingCoupon = await prisma.coupon.findUnique({ where: { code: body.code.toUpperCase() } });
    if (existingCoupon) {
      return reply.status(400).send({ error: 'Coupon code already exists' });
    }

    try {
      const coupon = await prisma.coupon.create({
        data: {
          code: body.code.toUpperCase(),
          discountType: body.discountType,
          discountValue,
          minimumOrderAmount: body.minimumOrderAmount ? parseFloat(String(body.minimumOrderAmount)) : null,
          maximumDiscountAmount: body.maximumDiscountAmount ? parseFloat(String(body.maximumDiscountAmount)) : null,
          startAt: body.startAt ? new Date(body.startAt) : null,
          endAt: body.endAt ? new Date(body.endAt) : null,
          usageLimit: body.usageLimit ?? null,
          perUserLimit: body.perUserLimit ?? 1,
          isActive: body.isActive ?? true,
          restrictedProductId: body.restrictedProductId ?? null,
          restrictedCategoryId: body.restrictedCategoryId ?? null
        },
        include: {
          restrictedProduct: { select: { id: true, name: true, slug: true, price: true, imageUrl: true } },
          restrictedCategory: { select: { id: true, name: true, slug: true } }
        }
      });

      await prisma.auditLog.create({
        data: {
          adminId: (await authenticateAdmin(request, reply)).id,
          action: 'COUPON_CREATED',
          entityType: 'COUPON',
          entityId: coupon.id,
          newValue: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue }
        }
      });

      return reply.status(201).send({ coupon });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create coupon' });
    }
  });

  app.put('/api/admin/coupons/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['products:update'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };
    const body = request.body as {
      code?: string;
      discountType?: 'PERCENTAGE' | 'FIXED';
      discountValue?: string | number;
      minimumOrderAmount?: string | number | null;
      maximumDiscountAmount?: string | number | null;
      startAt?: string | null;
      endAt?: string | null;
      usageLimit?: number | null;
      perUserLimit?: number | null;
      isActive?: boolean;
      restrictedProductId?: string | null;
      restrictedCategoryId?: string | null;
    };

    const existingCoupon = await prisma.coupon.findUnique({ where: { id } });
    if (!existingCoupon) {
      return reply.status(404).send({ error: 'Coupon not found' });
    }

    if (body.code) {
      const duplicate = await prisma.coupon.findFirst({ where: { code: body.code.toUpperCase(), id: { not: id } } });
      if (duplicate) {
        return reply.status(400).send({ error: 'Coupon code already exists' });
      }
    }

    if (body.discountType === 'PERCENTAGE' && body.discountValue !== undefined) {
      const val = parseFloat(String(body.discountValue));
      if (val > 100) {
        return reply.status(400).send({ error: 'Percentage discount cannot exceed 100%' });
      }
    }

    try {
      const coupon = await prisma.coupon.update({
        where: { id },
        data: {
          ...(body.code && { code: body.code.toUpperCase() }),
          ...(body.discountType && { discountType: body.discountType }),
          ...(body.discountValue !== undefined && { discountValue: parseFloat(String(body.discountValue)) }),
          ...(body.minimumOrderAmount !== undefined && { minimumOrderAmount: body.minimumOrderAmount ? parseFloat(String(body.minimumOrderAmount)) : null }),
          ...(body.maximumDiscountAmount !== undefined && { maximumDiscountAmount: body.maximumDiscountAmount ? parseFloat(String(body.maximumDiscountAmount)) : null }),
          ...(body.startAt !== undefined && { startAt: body.startAt ? new Date(body.startAt) : null }),
          ...(body.endAt !== undefined && { endAt: body.endAt ? new Date(body.endAt) : null }),
          ...(body.usageLimit !== undefined && { usageLimit: body.usageLimit }),
          ...(body.perUserLimit !== undefined && { perUserLimit: body.perUserLimit }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.restrictedProductId !== undefined && { restrictedProductId: body.restrictedProductId }),
          ...(body.restrictedCategoryId !== undefined && { restrictedCategoryId: body.restrictedCategoryId })
        },
        include: {
          restrictedProduct: { select: { id: true, name: true, slug: true, price: true, imageUrl: true } },
          restrictedCategory: { select: { id: true, name: true, slug: true } }
        }
      });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          action: 'COUPON_UPDATED',
          entityType: 'COUPON',
          entityId: coupon.id,
          newValue: { code: coupon.code }
        }
      });

      return { coupon };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update coupon' });
    }
  });

  app.delete('/api/admin/coupons/:id', {
    preHandler: requireAdmin({ requiredPermissions: ['products:delete'] })
  }, async (request, reply) => {
    const admin = await authenticateAdmin(request, reply);
    const { id } = request.params as { id: string };

    const existingCoupon = await prisma.coupon.findUnique({ where: { id } });
    if (!existingCoupon) {
      return reply.status(404).send({ error: 'Coupon not found' });
    }

    try {
      await prisma.coupon.delete({ where: { id } });

      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          action: 'COUPON_DELETED',
          entityType: 'COUPON',
          entityId: id,
          oldValue: { code: existingCoupon.code }
        }
      });

      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete coupon' });
    }
  });

  // ─── Customer Coupon Validation ────────────────────────────────────────────

  app.post('/api/coupons/validate', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;
    const body = request.body as { code: string; productId: string; quantity?: number };

    if (!body.code || !body.productId) {
      return reply.status(400).send({ error: 'code and productId are required' });
    }

    const coupon = await prisma.coupon.findUnique({
      where: { code: body.code.toUpperCase() },
      include: {
        restrictedProduct: { select: { id: true, name: true, price: true } },
        restrictedCategory: { select: { id: true, name: true } }
      }
    });

    if (!coupon) {
      return reply.status(200).send({ valid: false, coupon: null, discountAmount: null, error: 'Invalid coupon code' });
    }

    if (!coupon.isActive) {
      return reply.status(200).send({ valid: false, coupon: null, discountAmount: null, error: 'Coupon is disabled' });
    }

    const now = new Date();
    if (coupon.startAt && coupon.startAt > now) {
      return reply.status(200).send({ valid: false, coupon: null, discountAmount: null, error: 'Coupon is not yet active' });
    }

    if (coupon.endAt && coupon.endAt < now) {
      return reply.status(200).send({ valid: false, coupon: null, discountAmount: null, error: 'Coupon has expired' });
    }

    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return reply.status(200).send({ valid: false, coupon: null, discountAmount: null, error: 'Coupon usage limit reached' });
    }

    if (coupon.perUserLimit) {
      const userUsageCount = await prisma.couponUsage.count({
        where: { couponId: coupon.id, userId: dbUser.id }
      });
      if (userUsageCount >= coupon.perUserLimit) {
        return reply.status(200).send({ valid: false, coupon: null, discountAmount: null, error: 'You have reached the usage limit for this coupon' });
      }
    }

    const product = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!product) {
      return reply.status(200).send({ valid: false, coupon: null, discountAmount: null, error: 'Product not found' });
    }

    if (coupon.restrictedProductId && coupon.restrictedProductId !== product.id) {
      return reply.status(200).send({ valid: false, coupon: null, discountAmount: null, error: 'Coupon is not valid for this product' });
    }

    if (coupon.restrictedCategoryId && coupon.restrictedCategoryId !== product.categoryId) {
      return reply.status(200).send({ valid: false, coupon: null, discountAmount: null, error: 'Coupon is not valid for this product category' });
    }

    const quantity = body.quantity ?? 1;
    const unitPrice = product.price;
    const subtotal = unitPrice.mul(quantity);

    if (coupon.minimumOrderAmount && subtotal.lessThan(coupon.minimumOrderAmount)) {
      return reply.status(200).send({
        valid: false,
        coupon: null,
        discountAmount: null,
        error: `Minimum order amount is ${coupon.minimumOrderAmount.toString()} ${product.currency}`
      });
    }

    let discountAmount: number;
    if (coupon.discountType === 'PERCENTAGE') {
      discountAmount = parseFloat(subtotal.mul(coupon.discountValue).div(100).toString());
    } else {
      discountAmount = parseFloat(coupon.discountValue.toString());
    }

    if (coupon.maximumDiscountAmount && discountAmount > parseFloat(coupon.maximumDiscountAmount.toString())) {
      discountAmount = parseFloat(coupon.maximumDiscountAmount.toString());
    }

    discountAmount = Math.min(discountAmount, parseFloat(subtotal.toString()));

    return {
      valid: true,
      coupon: {
        ...coupon,
        usageCount: coupon.usageCount
      },
      discountAmount: discountAmount.toFixed(2),
      error: null
    };
  });

  // ─── Customer Notifications ────────────────────────────────────────────────

  app.get('/api/notifications/unread-count', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const unreadCount = await prisma.customerNotification.count({
      where: { userId: dbUser.id, isRead: false }
    });

    return { unreadCount };
  });

  app.get('/api/customer-notifications', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    const { page = '1', pageSize = '20', unreadOnly } = request.query as {
      page?: string;
      pageSize?: string;
      unreadOnly?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSizeNum = Math.min(50, Math.max(1, parseInt(pageSize, 10)));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = { userId: dbUser.id };
    if (unreadOnly === 'true') {
      where.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.customerNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSizeNum
      }),
      prisma.customerNotification.count({ where }),
      prisma.customerNotification.count({ where: { userId: dbUser.id, isRead: false } })
    ]);

    return {
      notifications,
      total,
      unreadCount,
      page: pageNum,
      pageSize: pageSizeNum
    };
  });

  app.post('/api/customer-notifications/:id/read', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;
    const { id } = request.params as { id: string };

    const notification = await prisma.customerNotification.findUnique({ where: { id } });
    if (!notification || notification.userId !== dbUser.id) {
      return reply.status(404).send({ error: 'Notification not found' });
    }

    if (!notification.isRead) {
      await prisma.customerNotification.update({
        where: { id },
        data: { isRead: true }
      });
    }

    return { success: true };
  });

  app.post('/api/customer-notifications/read-all', async (request, reply) => {
    const auth = await authenticateTelegramUser(request, reply);
    const { dbUser } = auth;

    await prisma.customerNotification.updateMany({
      where: { userId: dbUser.id, isRead: false },
      data: { isRead: true }
    });

    return { success: true };
  });

  return app;
}
