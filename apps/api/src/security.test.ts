import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { ProductService } from './services/admin/product.service.js';
import crypto from 'node:crypto';

vi.mock('./infrastructure/prisma.js', () => ({
  prisma: {
    category: {
      findMany: vi.fn(),
      findUnique: vi.fn()
    },
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn()
    },
    productStock: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      createManyAndReturn: vi.fn(),
      groupBy: vi.fn()
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    order: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn()
    },
    payment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn()
    },
    paymentEvent: {
      create: vi.fn()
    },
    admin: {
      findFirst: vi.fn(),
      findUnique: vi.fn()
    },
    smmOrder: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn()
    },
    auditLog: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      create: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

vi.mock('./services/stock.service.js', () => ({
  StockService: vi.fn().mockImplementation(() => ({
    reserveStock: vi.fn().mockResolvedValue({
      success: true,
      reservedStock: [{ id: 'stock-1', productId: 'product-1', status: 'RESERVED', orderId: 'order-1', reservedAt: new Date() }]
    }),
    releaseReservation: vi.fn(),
    releaseReservationByOrderId: vi.fn(),
    markStockSold: vi.fn(),
    getReservedStockByOrderId: vi.fn(),
    getSoldStockByOrderId: vi.fn(),
    getStockWithDecryptedValue: vi.fn(),
    disableStock: vi.fn(),
    getAvailableStockInfo: vi.fn().mockResolvedValue({
      productId: 'all',
      availableCount: 10,
      reservedCount: 0,
      soldCount: 0,
      disabledCount: 0
    }),
    createStock: vi.fn(),
    createStockBatch: vi.fn(),
    getStockForFulfillment: vi.fn()
  }))
}));

const { prisma } = await import('./infrastructure/prisma.js');

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  process.env.INVENTORY_ENCRYPTION_KEY = 'test-inventory-encryption-key-0123456789abcdef';
});

const mockTelegramUser = {
  id: 123456789,
  first_name: 'John',
  last_name: 'Doe',
  username: 'johndoe',
  language_code: 'en',
  photo_url: 'https://example.com/photo.jpg'
};

const mockDbUser = {
  id: 'user-1',
  telegramId: BigInt(123456789),
  username: 'johndoe',
  firstName: 'John',
  lastName: 'Doe',
  photoUrl: 'https://example.com/photo.jpg',
  languageCode: 'en',
  status: 'ACTIVE'
};

function generateInitData(botToken: string, user: typeof mockTelegramUser): string {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(user));
  params.set('auth_date', authDate);
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function makeAuthHeaders() {
  return {
    'x-telegram-init-data': generateInitData(process.env.TELEGRAM_BOT_TOKEN!, mockTelegramUser)
  };
}

const ADMIN_TEST_TOKEN = 'admin-token-for-tests';

function makeAdminHeaders() {
  return { authorization: `Bearer ${ADMIN_TEST_TOKEN}` };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function makeActiveAdminRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'admin-1',
    telegramId: BigInt(1),
    username: 'admin',
    firstName: 'Admin',
    lastName: null,
    status: 'ACTIVE',
    roles: [
      {
        role: {
          key: 'SUPER_ADMIN',
          permissions: [
            { permission: { key: 'products:read' } },
            { permission: { key: 'stock:read' } },
            { permission: { key: 'audit:read' } }
          ]
        }
      }
    ],
    ...overrides
  };
}

const internalProduct = {
  id: 'product-1',
  categoryId: 'category-1',
  name: 'Gemini 18 Month',
  slug: 'gemini-18-month',
  description: null,
  imageUrl: null,
  type: 'DIGITAL_LINK',
  deliveryType: 'DIGITAL_LINK',
  price: { toString: () => '2.60', mul: (q: number) => ({ toString: () => (2.6 * q).toFixed(2) }) },
  currency: 'USD',
  costPrice: { toString: () => '1.30' },
  markup: { toString: () => '1.30' },
  minimumQuantity: 1,
  maximumQuantity: 1,
  hideWhenOutOfStock: false,
  status: 'ACTIVE',
  isActive: true,
  isFeatured: false,
  isPopular: false,
  sortOrder: 0,
  instructions: null,
  keywords: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  category: { id: 'category-1', name: 'Digital Accounts', slug: 'digital-accounts' },
  stock: [
    { id: 'stock-1', productId: 'product-1', deliveryValue: 'PRIVATE-LICENSE-VALUE-1', deliveryType: 'DIGITAL_LINK', status: 'AVAILABLE' }
  ]
};

describe('Security: no internal data leaked to customers', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('product list never returns costPrice, markup, or stock delivery values', async () => {
    prisma.product.findMany.mockResolvedValue([internalProduct]);
    prisma.product.count.mockResolvedValue(1);

    const response = await app.inject({ method: 'GET', url: '/api/products' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.products).toHaveLength(1);
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('costPrice');
    expect(bodyStr).not.toContain('markup');
    expect(bodyStr).not.toContain('PRIVATE-LICENSE-VALUE-1');
  });

  it('product detail never returns stock delivery values or internal pricing', async () => {
    prisma.product.findUnique.mockResolvedValue(internalProduct);

    const response = await app.inject({ method: 'GET', url: '/api/products/gemini-18-month' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.product).toBeDefined();
    expect(body.product.availableStock).toBe(1);
    expect(body.product.isOutOfStock).toBe(false);
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('costPrice');
    expect(bodyStr).not.toContain('markup');
    expect(bodyStr).not.toContain('PRIVATE-LICENSE-VALUE-1');
    expect(bodyStr).not.toContain('deliveryValue');
  });

  it('category products never include internal pricing fields', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 'category-1',
      name: 'Digital Accounts',
      slug: 'digital-accounts',
      description: null,
      icon: null,
      imageUrl: null,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      products: [internalProduct]
    });

    const response = await app.inject({ method: 'GET', url: '/api/categories/digital-accounts' });

    expect(response.statusCode).toBe(200);
    const bodyStr = JSON.stringify(response.json());
    expect(bodyStr).not.toContain('costPrice');
    expect(bodyStr).not.toContain('markup');
    expect(bodyStr).not.toContain('PRIVATE-LICENSE-VALUE-1');
  });

  it('customer order detail requests only safe product fields', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 1,
      userId: 'user-1',
      status: 'DRAFT',
      currency: 'USD',
      subtotal: { toString: () => '2.60' },
      discount: { toString: () => '0' },
      total: { toString: () => '2.60' },
      idempotencyKey: null,
      expiresAt: null,
      paidAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 'item-1',
          orderId: 'order-1',
          productId: 'product-1',
          variantId: null,
          productNameSnapshot: 'Gemini 18 Month',
          unitPriceSnapshot: { toString: () => '2.60' },
          quantitySnapshot: 1,
          totalSnapshot: { toString: () => '2.60' },
          currencySnapshot: 'USD',
          deliveryTypeSnapshot: 'DIGITAL_LINK',
          providerServiceIdSnapshot: null,
          target: null,
          createdAt: new Date(),
          product: {
            id: 'product-1',
            name: 'Gemini 18 Month',
            slug: 'gemini-18-month',
            imageUrl: null,
            price: { toString: () => '2.60' }
          }
        }
      ]
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/order-1',
      headers: makeAuthHeaders()
    });

    expect(response.statusCode).toBe(200);
    const bodyStr = JSON.stringify(response.json());
    expect(bodyStr).not.toContain('costPrice');
    expect(bodyStr).not.toContain('markup');
    expect(bodyStr).not.toContain('PRIVATE-LICENSE-VALUE-1');

    const orderBody = response.json();
    for (const item of orderBody.order.items) {
      expect(item.deliveryValue).toBeNull();
      expect(item.fulfillment).toBeNull();
    }

    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          items: expect.objectContaining({
            include: expect.objectContaining({
              product: {
                select: { id: true, name: true, slug: true, imageUrl: true, price: true }
              }
            })
          })
        })
      })
    );
  });
});

describe('Security: admin endpoints require authorization', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('rejects admin dashboard access without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/dashboard' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects admin access with an invalid token', async () => {
    prisma.admin.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      headers: { authorization: 'Bearer wrong-token' }
    });
    expect(response.statusCode).toBe(403);
  });

  it('resolves the exact admin bound to the presented token', async () => {
    const token = 'token-for-admin-jim';
    prisma.admin.findUnique.mockResolvedValue(
      makeActiveAdminRow({ id: 'admin-jim', telegramId: BigInt(42), username: 'jim' })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/stock/summary',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.admin.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.admin.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { authTokenHash: hashToken(token) }
      })
    );
  });

  it('never looks up admins by a shared secret or the first active row', async () => {
    const token = 'another-admin-token';
    prisma.admin.findUnique.mockResolvedValue(
      makeActiveAdminRow({ id: 'admin-second', telegramId: BigInt(7) })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/stock/summary',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const query = (prisma.admin.findUnique.mock.calls[0][0] as { where: { authTokenHash: string } }).where;
    expect(query.authTokenHash).toBe(hashToken(token));
    expect(query.authTokenHash).not.toBe(token);
    expect(query.authTokenHash).not.toBe('admin-token-for-tests');
    expect(prisma.admin.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a token that belongs to no admin', async () => {
    prisma.admin.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/stock/summary',
      headers: makeAdminHeaders()
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects the token of a disabled admin', async () => {
    prisma.admin.findUnique.mockResolvedValue(
      makeActiveAdminRow({ id: 'admin-disabled', status: 'DISABLED' })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/stock/summary',
      headers: makeAdminHeaders()
    });

    expect(response.statusCode).toBe(403);
  });

  it('attributes each token to its own admin for permission checks', async () => {
    const supportToken = 'support-token';
    prisma.admin.findUnique.mockImplementation((args: { where: { authTokenHash: string } }) => {
      if (args.where.authTokenHash === hashToken(supportToken)) {
        return Promise.resolve({
          id: 'admin-support',
          telegramId: BigInt(2),
          username: 'support',
          firstName: 'Support',
          lastName: null,
          status: 'ACTIVE',
          roles: [{ role: { key: 'SUPPORT', permissions: [] } }]
        });
      }
      return Promise.resolve(makeActiveAdminRow({ id: 'admin-owner', telegramId: BigInt(1) }));
    });

    const denied = await app.inject({
      method: 'GET',
      url: '/api/admin/stock/summary',
      headers: { authorization: `Bearer ${supportToken}` }
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/admin/stock/summary',
      headers: makeAdminHeaders()
    });
    expect(allowed.statusCode).toBe(200);
    expect(prisma.admin.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authTokenHash: hashToken(ADMIN_TEST_TOKEN) } })
    );
  });

  it('rejects admin stock read without authorization', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/stock' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects admin stock write without authorization', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/stock',
      payload: { productId: 'product-1', deliveryType: 'DIGITAL_CODE', values: ['abc'] }
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects admin stock expire without authorization', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/stock/expire' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects admin payment expire without authorization', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/payments/expire' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects admin product list without required permission', async () => {
    prisma.admin.findUnique.mockResolvedValue({
      id: 'admin-1',
      telegramId: BigInt(1),
      username: 'support',
      firstName: 'Support',
      lastName: null,
      status: 'ACTIVE',
      roles: [{ role: { key: 'SUPPORT', permissions: [] } }]
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/products',
      headers: makeAdminHeaders()
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects admin audit access without authorization', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/audit' });
    expect(response.statusCode).toBe(401);
  });

  it('never echoes the admin token in authorized responses', async () => {
    prisma.admin.findUnique.mockResolvedValue(
      makeActiveAdminRow({
        id: 'admin-1',
        roles: [
          {
            role: {
              key: 'SUPER_ADMIN',
              permissions: [{ permission: { key: 'stock:read' } }]
            }
          }
        ]
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/stock/summary',
      headers: makeAdminHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(ADMIN_TEST_TOKEN);
    expect(response.body).not.toContain('Bearer');
  });
});

describe('Security: customer isolation', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('prevents a customer from viewing another customers order', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 1,
      userId: 'other-user',
      status: 'DRAFT',
      currency: 'USD',
      subtotal: { toString: () => '2.60' },
      discount: { toString: () => '0' },
      total: { toString: () => '2.60' },
      createdAt: new Date(),
      updatedAt: new Date(),
      items: []
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/order-1',
      headers: makeAuthHeaders()
    });

    expect(response.statusCode).toBe(404);
  });

  it('prevents a customer from viewing another customers payment', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      orderId: 'order-1',
      userId: 'other-user',
      provider: 'MANUAL',
      status: 'PENDING',
      amount: { toString: () => '2.60' },
      currency: 'USD',
      reference: 'pay-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 60000),
      paidAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      order: { id: 'order-1' }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/payments/payment-1',
      headers: makeAuthHeaders()
    });

    expect(response.statusCode).toBe(404);
  });

  it('prevents a customer from expiring another customers payment', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      orderId: 'order-1',
      userId: 'other-user',
      provider: 'MANUAL',
      status: 'PENDING',
      amount: { toString: () => '2.60' },
      currency: 'USD',
      reference: 'pay-1',
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
      order: { id: 'order-1' }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/payment-1/expire',
      headers: makeAuthHeaders()
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('Security: payment integrity', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('ignores client-supplied price and total when creating an order', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.order.findUnique.mockResolvedValue(null);
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      name: 'Gemini 18 Month',
      slug: 'gemini-18-month',
      isActive: true,
      status: 'ACTIVE',
      price: { toString: () => '2.60', mul: (q: number) => ({ toString: () => (2.6 * q).toFixed(2) }) },
      currency: 'USD',
      minimumQuantity: 1,
      maximumQuantity: 5,
      hideWhenOutOfStock: false,
      deliveryType: 'DIGITAL_LINK',
      stock: [{ id: 'stock-1', status: 'AVAILABLE' }],
      variants: []
    });

    const txMock = {
      order: {
        create: vi.fn().mockResolvedValue({
          id: 'order-1',
          orderNumber: 1,
          userId: 'user-1',
          status: 'DRAFT',
          currency: 'USD',
          subtotal: { toString: () => '2.60' },
          discount: { toString: () => '0' },
          total: { toString: () => '2.60' },
          items: []
        })
      },
      productStock: {}
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(txMock)
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: makeAuthHeaders(),
      payload: {
        productId: 'product-1',
        quantity: 1,
        price: '0.01',
        total: '0.01'
      }
    });

    expect(response.statusCode).toBe(201);
    const createdData = txMock.order.create.mock.calls[0][0].data;
    expect(createdData.total.toString()).toBe('2.60');
    expect(createdData.subtotal.toString()).toBe('2.60');
    expect(createdData.total.toString()).not.toBe('0.01');
  });

  it('rejects fractional quantities', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: makeAuthHeaders(),
      payload: { productId: 'product-1', quantity: 1.5 }
    });

    expect(response.statusCode).toBe(400);
  });

  it('has no route that lets the client set payment status', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);

    const updateAttempt = await app.inject({
      method: 'POST',
      url: '/api/payments/payment-1/status',
      headers: makeAuthHeaders(),
      payload: { status: 'SUCCEEDED' }
    });
    expect(updateAttempt.statusCode).toBe(404);

    const directUpdate = await app.inject({
      method: 'PATCH',
      url: '/api/payments/payment-1',
      headers: makeAuthHeaders(),
      payload: { status: 'SUCCEEDED' }
    });
    expect(directUpdate.statusCode).toBe(404);
  });
});

describe('Security: error responses do not leak internals', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns a generic message when the database fails', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('database credentials exposed in error'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders',
      headers: makeAuthHeaders()
    });

    expect(response.statusCode).toBe(500);
    const bodyStr = JSON.stringify(response.json());
    expect(bodyStr).not.toContain('database credentials exposed in error');
    expect(bodyStr).not.toContain('credentials');
  });

  it('returns a generic message for internal failures on order detail', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('Internal failure with connection string detail'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/order-1',
      headers: makeAuthHeaders()
    });

    expect(response.statusCode).toBe(500);
    const bodyStr = JSON.stringify(response.json());
    expect(bodyStr).not.toContain('connection string');
  });
});

describe('Security: inventory encryption at rest', () => {
  it('admin stock upload encrypts delivery values before storage', async () => {
    const secretValue = 'license-key-plaintext-12345';
    const txMock = {
      productStock: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) }
    };

    const mockPrisma = {
      product: { findUnique: vi.fn().mockResolvedValue({ id: 'product-1', name: 'Test Product' }) },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback(txMock)
      )
    };

    const service = new ProductService(mockPrisma as never);
    await service.addStock('product-1', 'DIGITAL_CODE' as never, [secretValue], 'admin-1');

    expect(txMock.productStock.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            productId: 'product-1',
            status: 'AVAILABLE'
          })
        ])
      })
    );
    const storedValue = (txMock.productStock.createMany.mock.calls[0][0] as { data: { deliveryValue: string }[] }).data[0].deliveryValue;
    expect(storedValue).not.toBe(secretValue);
    expect(storedValue).not.toContain(secretValue);
    expect(storedValue.length).toBeGreaterThan(0);
  });
});