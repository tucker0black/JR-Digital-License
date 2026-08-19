import crypto from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { appName } from '@jr/shared';
import type { ProductStatus, OrderStatus, PaymentStatus, DeliveryType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { PaymentProvider as PrismaPaymentProvider, UserStatus, SupportTicketStatus, SmmProviderStatus, SmmServiceStatus } from '@prisma/client';
import { prisma } from './infrastructure/prisma.js';
import { authenticateTelegramUser } from './middleware/auth.js';
import { authenticateAdmin, requireAdmin } from './middleware/admin-auth.js';
import { StockService } from './services/stock.service.js';
import { FulfillmentService } from './services/fulfillment.service.js';
import { CustomerWalletService } from './services/wallet.service.js';
import { CustomerStatsService } from './services/customer-stats.service.js';
import { CustomerTicketService } from './services/ticket.service.js';
import { PaymentService, DefaultPaymentProviderFactory } from './services/payment/index.js';
import { TelegramNotificationService } from './services/notifications/telegram-notification.service.js';
import { ProductService, CategoryService, OrderService, DashboardService, AuditService, AdminUserService, AdminWalletService, AdminTicketService, AdminSettingsService, AdminPaymentService, type CreateProductInput, type UpdateProductInput, type CreateCategoryInput, type UpdateCategoryInput } from './services/admin/index.js';
import { SmmService, DefaultSmmProviderFactory } from './services/smm/index.js';
import { SmmAdminService } from './services/smm/smm-admin.service.js';

const CUSTOMER_FORBIDDEN_FIELDS = ['costPrice', 'markup', 'stock', 'stockCount'] as const;

function sanitizeProductForCustomer<T extends Record<string, unknown>>(product: T): Omit<T, (typeof CUSTOMER_FORBIDDEN_FIELDS)[number]> {
  const sanitized = { ...product };
  for (const field of CUSTOMER_FORBIDDEN_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

export function buildApp() {
  const app = Fastify({ logger: true });
  const stockService = new StockService(prisma);
  const fulfillmentService = new FulfillmentService(prisma, stockService);
  const walletService = new CustomerWalletService(prisma);
  const customerStatsService = new CustomerStatsService(prisma);
  const customerTicketService = new CustomerTicketService(prisma);
  const notificationService = new TelegramNotificationService();
  const paymentService = new PaymentService(
    prisma,
    new DefaultPaymentProviderFactory(),
    walletService,
    notificationService
  );
  const productService = new ProductService(prisma);
  const categoryService = new CategoryService(prisma);
  const orderService = new OrderService(prisma);
  const dashboardService = new DashboardService(prisma);
  const auditService = new AuditService(prisma);
  const smmService = new SmmService(prisma, new DefaultSmmProviderFactory());
  const smmAdminService = new SmmAdminService(prisma);
  const adminUserService = new AdminUserService(prisma);
  const adminWalletService = new AdminWalletService(prisma);
  const adminTicketService = new AdminTicketService(prisma);
  const adminSettingsService = new AdminSettingsService(prisma);
  const adminPaymentService = new AdminPaymentService(prisma);

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
          isOutOfStock: product.stock.length === 0,
          availableStock: product.stock.length
        }))
      }
    };
  });

  app.get('/api/products', async (request) => {
    const { search, category, page = '1', pageSize = '20', featured, popular } = request.query as {
      search?: string;
      category?: string;
      page?: string;
      pageSize?: string;
      featured?: string;
      popular?: string;
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

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
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
        isOutOfStock: product.stock.length === 0,
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
    const isOutOfStock = availableStock === 0;

    return {
      product: {
        ...sanitizeProductForCustomer(product),
        availableStock,
        isOutOfStock
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
      idempotencyKey?: string;
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

    if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length > 128)) {
      return reply.status(400).send({ error: 'Invalid idempotency key' });
    }

    if (body.idempotencyKey) {
      const existingOrder = await prisma.order.findUnique({
        where: { idempotencyKey: body.idempotencyKey }
      });
      if (existingOrder) {
        return reply.status(409).send({ error: 'Order with this idempotency key already exists' });
      }
    }

    const product = await prisma.product.findUnique({
      where: { id: body.productId },
      include: {
        stock: { where: { status: 'AVAILABLE' } },
        variants: { where: { isActive: true } }
      }
    });

    if (!product || !product.isActive || product.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Product not found' });
    }

    const availableStock = Array.isArray(product.stock) ? product.stock.length : Number.POSITIVE_INFINITY;
    const effectiveMaximumQuantity = Math.min(
      product.maximumQuantity ?? availableStock,
      availableStock
    );

    if (body.quantity < product.minimumQuantity || body.quantity > effectiveMaximumQuantity) {
      return reply.status(400).send({
        error: `Quantity must be between ${product.minimumQuantity} and ${effectiveMaximumQuantity}`
      });
    }

    if (product.hideWhenOutOfStock && product.stock.length === 0) {
      return reply.status(400).send({ error: 'Product is out of stock' });
    }

    const unitPrice = product.price;
    const subtotal = unitPrice.mul(body.quantity);
    const total = subtotal;

    const isSmmProduct = product.type === 'SMM_API';

    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        const newOrder = await tx.order.create({
          data: {
            userId: dbUser.id,
            status: 'DRAFT',
            currency: product.currency,
            subtotal,
            discount: 0,
            total,
            idempotencyKey: body.idempotencyKey ?? null,
            items: {
              create: {
                productId: product.id,
                productNameSnapshot: product.name,
                unitPriceSnapshot: unitPrice,
                quantitySnapshot: body.quantity,
                totalSnapshot: total,
                currencySnapshot: product.currency,
                deliveryTypeSnapshot: product.deliveryType,
                target: body.target ?? null
              }
            }
          },
          include: {
            items: true
          }
        });

        if (!isSmmProduct) {
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

        return newOrder;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to create order'
      });
    }

    return reply.status(201).send({ order });
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
      orders,
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

    const deliveryValuesByProduct = new Map<string, string[]>();
    for (const stock of deliveredStock) {
      const decrypted = await stockService.getStockWithDecryptedValue(stock.id);
      if (!decrypted?.deliveryValue) continue;
      const values = deliveryValuesByProduct.get(stock.productId) ?? [];
      values.push(decrypted.deliveryValue);
      deliveryValuesByProduct.set(stock.productId, values);
    }

    return {
      order: {
        ...order,
        items: order.items.map(item => {
          const productValues = item.productId
            ? (deliveryValuesByProduct.get(item.productId) ?? [])
            : [];
          const deliveryValues = productValues.splice(0, item.quantitySnapshot);

          return {
            ...item,
            unitPriceSnapshot: item.unitPriceSnapshot.toString(),
            totalSnapshot: item.totalSnapshot.toString(),
            fulfillment: item.fulfillment
              ? {
                  id: item.fulfillment.id,
                  status: item.fulfillment.status,
                  deliveryRef: item.fulfillment.deliveryRef,
                  deliveredAt: item.fulfillment.deliveredAt,
                  failureReason: item.fulfillment.failureReason
                }
              : null,
            deliveryValues:
              item.productId && item.fulfillment?.status === 'DELIVERED'
                ? deliveryValues
                : [],
            deliveryValue: item.productId && item.fulfillment?.status === 'DELIVERED'
              ? (deliveryValues[0] ?? null)
              : null
          };
        }),
        subtotal: order.subtotal.toString(),
        discount: order.discount.toString(),
        total: order.total.toString()
      }
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

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { order: true }
    });

    if (!payment || payment.userId !== dbUser.id) {
      return reply.status(404).send({ error: 'Payment not found' });
    }

    if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') {
      return reply.status(400).send({ error: 'Payment cannot be expired' });
    }

    await paymentService.expirePayment(id);

    return { success: true };
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

  // ==================== ADMIN ORDERS ====================
  app.get('/api/admin/orders', {
    preHandler: requireAdmin({ requiredPermissions: ['orders:read'] })
  }, async (request, _reply) => {
    const { search, userId, status, paymentStatus, dateFrom, dateTo, page, pageSize, sortBy, sortOrder } = request.query as {
      search?: string;
      userId?: string;
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
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
    const body = request.body as { reason?: string };

    try {
      await orderService.refundOrder(id, admin.id, body.reason);
      return { success: true };
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

    const result = await smmService.createSmmOrder(admin.id, body.orderId, body.serviceId, body.idempotencyKey);
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

  return app;
}
