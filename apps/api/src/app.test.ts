import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { hashAdminToken } from './middleware/admin-auth.js';

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
      createManyAndReturn: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn()
    },
    productVariant: {
      count: vi.fn()
    },
    license: {
      count: vi.fn()
    },
    smmService: {
      count: vi.fn()
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    supportTicket: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    supportMessage: {
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn()
    },
    telegramNotificationTarget: {
      findMany: vi.fn().mockResolvedValue([])
    },
    securityEvent: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'security-event-1' })
    },
    order: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    orderItem: {
      findUnique: vi.fn(),
      count: vi.fn()
    },
    fulfillmentRecord: {
      upsert: vi.fn()
    },
    payment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn()
    },
    admin: {
      findFirst: vi.fn(),
      findUnique: vi.fn()
    },
    coupon: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    couponUsage: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn()
    },
    manualDelivery: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn()
    },
    banner: {
      findMany: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

const stockServiceMock = vi.hoisted(() => ({
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
  getAvailableStockInfo: vi.fn(),
  createStock: vi.fn(),
  createStockBatch: vi.fn(),
  getStockForFulfillment: vi.fn(),
  getOrderStock: vi.fn().mockResolvedValue([]),
}));

vi.mock('./services/stock.service.js', () => ({
  StockService: vi.fn().mockImplementation(() => stockServiceMock)
}));

const { prisma } = await import('./infrastructure/prisma.js');

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  // Keep support working hours deterministic (always open) during tests.
  process.env.SUPPORT_OPEN_TIME = '00:00';
  process.env.SUPPORT_CLOSE_TIME = '23:59';
  process.env.SUPPORT_TIMEZONE_OFFSET_MINUTES = '0';
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

let authHeaders: { 'x-telegram-init-data': string };

beforeEach(() => {
  authHeaders = {
    'x-telegram-init-data': generateInitData(process.env.TELEGRAM_BOT_TOKEN!, mockTelegramUser)
  };
});

describe('GET /health', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the API health contract', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'api',
      application: 'JR Digital license'
    });
  });
});

describe('CORS preflight', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('allows PUT and DELETE methods for the admin dashboard', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/admin/products/test-id',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type,authorization'
      }
    });

    expect(response.statusCode).toBe(204);
    const allowedMethods = response.headers['access-control-allow-methods'];
    expect(allowedMethods).toContain('PUT');
    expect(allowedMethods).toContain('DELETE');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});

describe('GET /api/categories', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns active categories ordered by sortOrder', async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: '1', name: 'Digital Accounts', slug: 'digital-accounts', description: null, icon: null, imageUrl: null, isActive: true, isArchived: false, sortOrder: 1, createdAt: new Date(), updatedAt: new Date() },
      { id: '2', name: 'Gift Cards', slug: 'gift-cards', description: null, icon: null, imageUrl: null, isActive: true, isArchived: false, sortOrder: 2, createdAt: new Date(), updatedAt: new Date() }
    ]);

    const response = await app.inject({ method: 'GET', url: '/api/categories' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      categories: [
        { slug: 'digital-accounts' },
        { slug: 'gift-cards' }
      ]
    });
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { isActive: true, isArchived: false },
      orderBy: { sortOrder: 'asc' }
    });
  });
});

describe('GET /api/categories/:slug', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns category with products when found', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: '1',
      name: 'Digital Accounts',
      slug: 'digital-accounts',
      description: 'Digital accounts',
      icon: 'account',
      imageUrl: null,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      products: [
        { id: 'p1', name: 'Product 1', slug: 'product-1', isActive: true, status: 'ACTIVE', sortOrder: 1, stock: [] }
      ]
    });

    const response = await app.inject({ method: 'GET', url: '/api/categories/digital-accounts' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      category: { slug: 'digital-accounts', name: 'Digital Accounts' }
    });
  });

  it('returns 404 for inactive category', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: '1',
      name: 'Digital Accounts',
      slug: 'digital-accounts',
      isActive: false,
      isArchived: false,
      products: []
    });

    const response = await app.inject({ method: 'GET', url: '/api/categories/digital-accounts' });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for non-existent category', async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    const response = await app.inject({ method: 'GET', url: '/api/categories/non-existent' });

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/products', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns paginated products with default pagination', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'Product 1', slug: 'product-1', isActive: true, status: 'ACTIVE', price: '10.00', currency: 'USD', category: { id: 'c1', name: 'Cat', slug: 'cat' }, stock: [] }
    ]);
    prisma.product.count.mockResolvedValue(1);

    const response = await app.inject({ method: 'GET', url: '/api/products' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      products: [{ slug: 'product-1' }],
      total: 1,
      page: 1,
      pageSize: 20
    });
  });

  it('filters by search query', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);

    await app.inject({ method: 'GET', url: '/api/products?search=gemini' });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: expect.any(Object) }),
            expect.objectContaining({ description: expect.any(Object) }),
            expect.objectContaining({ keywords: expect.any(Object) })
          ])
        })
      })
    );
  });

  it('filters by category slug', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);

    await app.inject({ method: 'GET', url: '/api/products?category=digital-accounts' });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: { slug: 'digital-accounts' }
        })
      })
    );
  });

  it('filters by featured', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);

    await app.inject({ method: 'GET', url: '/api/products?featured=true' });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isFeatured: true })
      })
    );
  });

  it('filters by popular', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);

    await app.inject({ method: 'GET', url: '/api/products?popular=true' });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPopular: true })
      })
    );
  });

  it('respects pagination limits', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);

    await app.inject({ method: 'GET', url: '/api/products?page=2&pageSize=10' });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });
});

describe('GET /api/products/:slug', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns product with category, variants, and stock', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      name: 'Product 1',
      slug: 'product-1',
      isActive: true,
      status: 'ACTIVE',
      price: '10.00',
      currency: 'USD',
      category: { id: 'c1', name: 'Cat', slug: 'cat' },
      variants: [],
      stock: [{ id: 's1', status: 'AVAILABLE' }]
    });

    const response = await app.inject({ method: 'GET', url: '/api/products/product-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      product: { slug: 'product-1', availableStock: 1, isOutOfStock: false }
    });
  });

  it('returns 404 for inactive product', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      name: 'Product 1',
      slug: 'product-1',
      isActive: false,
      status: 'ACTIVE'
    });

    const response = await app.inject({ method: 'GET', url: '/api/products/product-1' });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for non-existent product', async () => {
    prisma.product.findUnique.mockResolvedValue(null);

    const response = await app.inject({ method: 'GET', url: '/api/products/non-existent' });

    expect(response.statusCode).toBe(404);
  });

  it('marks product as out of stock when no available stock', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      name: 'Product 1',
      slug: 'product-1',
      isActive: true,
      status: 'ACTIVE',
      stock: []
    });

    const response = await app.inject({ method: 'GET', url: '/api/products/product-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      product: { isOutOfStock: true, availableStock: 0 }
    });
  });
});

describe('POST /api/orders', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      body: { productId: 'product-1', quantity: 1 }
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 400 for invalid quantity', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      name: 'Test Product',
      isActive: true,
      status: 'ACTIVE',
      minimumQuantity: 1,
      maximumQuantity: 5
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity: 10 }
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for non-existent product', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'non-existent', quantity: 1 }
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 400 for inactive product', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      name: 'Test Product',
      isActive: false,
      status: 'DISABLED'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity: 1 }
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 409 for duplicate idempotency key', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      name: 'Test Product',
      isActive: true,
      status: 'ACTIVE',
      price: { toString: () => '10.00', mul: (q: number) => ({ toString: () => (10 * q).toFixed(2) }) },
      currency: 'USD',
      minimumQuantity: 1,
      maximumQuantity: 10,
      hideWhenOutOfStock: false,
      deliveryType: 'DIGITAL_LINK',
      stock: [{ id: 'stock-1', status: 'AVAILABLE' }]
    });
    prisma.order.findUnique.mockResolvedValue({
      id: 'existing-order',
      idempotencyKey: 'idem-1',
      userId: 'someone-else',
      items: [{ productId: 'product-1', quantitySnapshot: 1, target: null }]
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity: 1, idempotencyKey: 'idem-1' }
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('POST /api/orders (server-side totals)', () => {
  let app: ReturnType<typeof buildApp>;
  let txOrderCreate: ReturnType<typeof vi.fn>;

  const makeProduct = (price: string, stockCount = 5) => ({
    id: 'product-1',
    name: 'Game Account',
    isActive: true,
    status: 'ACTIVE',
    type: 'DIGITAL_TEXT',
    price: new Prisma.Decimal(price),
    currency: 'USD',
    minimumQuantity: 1,
    maximumQuantity: 10,
    hideWhenOutOfStock: false,
    deliveryType: 'DIGITAL_TEXT',
    stock: Array.from({ length: stockCount }, (_, i) => ({ id: `stock-${i}`, status: 'AVAILABLE' })),
    variants: []
  });

  beforeEach(() => {
    app = buildApp();
    txOrderCreate = vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => ({
      ...args.data,
      id: 'order-created',
      orderNumber: 59,
      status: 'DRAFT',
      expiresAt: null,
      paidAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: []
    }));
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ order: { create: txOrderCreate } })
    );
  });

  afterEach(async () => {
    prisma.$transaction.mockReset();
    vi.clearAllMocks();
    await app.close();
  });

  it.each([
    ['1.00', 1, '1.00'],
    ['1.50', 2, '3.00'],
    ['2.75', 2, '5.50'],
    ['3.00', 2, '6.00'],
    ['1.50', 3, '4.50'],
    ['5.00', 4, '20.00'],
    ['10.00', 1, '10.00'],
    ['18.00', 2, '36.00']
  ])('calculates %s × %i = %s without floating point corruption', async (price, quantity, expected) => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue(makeProduct(price));

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity }
    });

    expect(response.statusCode).toBe(201);
    const createdData = txOrderCreate.mock.calls[0][0].data;
    expect(createdData.subtotal.toFixed(2)).toBe(expected);
    expect(createdData.total.toFixed(2)).toBe(expected);
    expect(createdData.items.create.unitPriceSnapshot.toFixed(2)).toBe(price);
    expect(createdData.items.create.quantitySnapshot).toBe(quantity);
  });

  it('ignores a client-supplied total and always uses the server calculation', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue(makeProduct('3.00'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity: 2, total: '0.01', subtotal: '0.01', amount: '0.01' }
    });

    expect(response.statusCode).toBe(201);
    const createdData = txOrderCreate.mock.calls[0][0].data;
    expect(createdData.subtotal.toFixed(2)).toBe('6.00');
    expect(createdData.total.toFixed(2)).toBe('6.00');
  });

  it('rejects the order when stock is insufficient and creates no order', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue(makeProduct('3.00', 1));

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity: 2 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Quantity must be between 1 and 1');
  });

  it('uses available stock as the maximum when product maximum is null', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue({
      ...makeProduct('3.00', 3),
      maximumQuantity: null
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity: 3 }
    });

    expect(response.statusCode).toBe(201);
    expect(txOrderCreate.mock.calls[0][0].data.items.create.quantitySnapshot).toBe(3);
  });

  it('rejects a null-maximum order above available stock', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue({
      ...makeProduct('3.00', 3),
      maximumQuantity: null
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity: 4 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('between 1 and 3');
    expect(txOrderCreate).not.toHaveBeenCalled();
  });

  it('rejects quantity below minimum', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue({
      ...makeProduct('3.00'),
      minimumQuantity: 5,
      maximumQuantity: 10
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity: 1 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Quantity must be between');
    expect(txOrderCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/coupons/validate (numerical discount)', () => {
  let app: ReturnType<typeof buildApp>;

  const makeProduct = (price: string) => ({
    id: 'product-1',
    name: 'Game Account',
    categoryId: 'category-1',
    isActive: true,
    status: 'ACTIVE',
    type: 'DIGITAL_TEXT',
    price: new Prisma.Decimal(price),
    currency: 'USD',
    minimumQuantity: 1,
    maximumQuantity: null,
    hideWhenOutOfStock: false,
    deliveryType: 'DIGITAL_TEXT',
    stock: Array.from({ length: 5 }, (_, i) => ({ id: `stock-${i}`, status: 'AVAILABLE' })),
    variants: []
  });

  const makeCoupon = (overrides: Record<string, unknown> = {}) => ({
    id: 'coupon-1',
    code: 'BESTJR',
    discountType: 'PERCENTAGE',
    discountValue: new Prisma.Decimal('5'),
    minimumOrderAmount: null,
    maximumDiscountAmount: null,
    startAt: null,
    endAt: null,
    usageLimit: null,
    perUserLimit: 1,
    isActive: true,
    restrictedProductId: null,
    restrictedCategoryId: null,
    usageCount: 0,
    restrictedProduct: null,
    restrictedCategory: null,
    ...overrides
  });

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it.each([
    // [price, quantity, couponValue, expectedDiscount]
    ['10.00', 1, '5', '0.50'],
    ['2.60', 2, '5', '0.26'],
    ['10.00', 3, '5', '1.50'],
    ['7.77', 4, '15', '4.66']
  ])('%s × %i with %s%% coupon discounts exactly %s', async (price, quantity, value, expected) => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ discountValue: new Prisma.Decimal(value) }));
    prisma.product.findUnique.mockResolvedValue(makeProduct(price));
    prisma.couponUsage.count.mockResolvedValue(0);

    const response = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: 'BESTJR', productId: 'product-1', quantity }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(true);
    expect(body.discountAmount).toBe(expected);
  });

  it('applies a fixed-amount coupon without percentage conversion', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.coupon.findUnique.mockResolvedValue(
      makeCoupon({ discountType: 'FIXED', discountValue: new Prisma.Decimal('1.25') })
    );
    prisma.product.findUnique.mockResolvedValue(makeProduct('10.00'));
    prisma.couponUsage.count.mockResolvedValue(0);

    const response = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: 'BESTJR', productId: 'product-1', quantity: 2 }
    });

    expect(response.json().discountAmount).toBe('1.25');
  });

  it('caps the discount at maximumDiscountAmount', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.coupon.findUnique.mockResolvedValue(
      makeCoupon({ discountValue: new Prisma.Decimal('50'), maximumDiscountAmount: new Prisma.Decimal('2.00') })
    );
    prisma.product.findUnique.mockResolvedValue(makeProduct('10.00'));
    prisma.couponUsage.count.mockResolvedValue(0);

    const response = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: 'BESTJR', productId: 'product-1', quantity: 1 }
    });

    expect(response.json().discountAmount).toBe('2.00');
  });

  it('rejects a subtotal below minimumOrderAmount', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ minimumOrderAmount: new Prisma.Decimal('20.00') }));
    prisma.product.findUnique.mockResolvedValue(makeProduct('10.00'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: 'BESTJR', productId: 'product-1', quantity: 1 }
    });

    const body = response.json();
    expect(body.valid).toBe(false);
    expect(body.discountAmount).toBeNull();
  });

  it('rejects expired and disabled coupons', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue(makeProduct('10.00'));

    prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ isActive: false }));
    const disabled = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: 'BESTJR', productId: 'product-1' }
    });
    expect(disabled.json().valid).toBe(false);

    prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ endAt: new Date(Date.now() - 86_400_000) }));
    const expired = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: 'BESTJR', productId: 'product-1' }
    });
    expect(expired.json().error).toContain('expired');
  });

  it('enforces the per-user usage limit', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.coupon.findUnique.mockResolvedValue(makeCoupon());
    prisma.couponUsage.count.mockResolvedValue(1);

    const response = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: 'BESTJR', productId: 'product-1' }
    });

    expect(response.json().valid).toBe(false);
  });

  it('rejects coupons restricted to a different product or category', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue(makeProduct('10.00'));
    prisma.couponUsage.count.mockResolvedValue(0);

    prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ restrictedProductId: 'other-product' }));
    const wrongProduct = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: 'BESTJR', productId: 'product-1' }
    });
    expect(wrongProduct.json().valid).toBe(false);

    prisma.coupon.findUnique.mockResolvedValue(makeCoupon({ restrictedCategoryId: 'other-category' }));
    const wrongCategory = await app.inject({
      method: 'POST',
      url: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: 'BESTJR', productId: 'product-1' }
    });
    expect(wrongCategory.json().valid).toBe(false);
  });

  it('applies the coupon server-side to the order total at creation time', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.product.findUnique.mockResolvedValue(makeProduct('10.00'));
    prisma.coupon.findUnique.mockResolvedValue(makeCoupon());
    prisma.couponUsage.count.mockResolvedValue(0);

    let createdData: Record<string, unknown> | undefined;
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        order: {
          create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            createdData = args.data;
            return {
              ...args.data,
              id: 'order-coupon',
              orderNumber: 60,
              status: 'DRAFT',
              expiresAt: null,
              paidAt: null,
              completedAt: null,
              cancelledAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              items: []
            };
          })
        },
        coupon: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        couponUsage: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}) }
      })
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeaders,
      body: { productId: 'product-1', quantity: 2, couponCode: 'BESTJR' }
    });

    expect(response.statusCode).toBe(201);
    // 5% of $20.00 subtotal = $1.00 discount, total $19.00.
    expect((createdData?.discount as Prisma.Decimal).toFixed(2)).toBe('1.00');
    expect((createdData?.total as Prisma.Decimal).toFixed(2)).toBe('19.00');
    expect((createdData?.subtotal as Prisma.Decimal).toFixed(2)).toBe('20.00');
  });
});

describe('GET /api/orders/:id (delivery values)', () => {
  let app: ReturnType<typeof buildApp>;

  const makeOrderWithDeliveredItems = () => ({
    id: 'order-1',
    orderNumber: 42,
    userId: 'user-1',
    status: 'COMPLETED',
    currency: 'USD',
    subtotal: '6.00',
    discount: 0,
    total: '6.00',
    idempotencyKey: null,
    expiresAt: null,
    paidAt: new Date(),
    completedAt: new Date(),
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        id: 'item-1',
        orderId: 'order-1',
        productId: 'product-1',
        variantId: null,
        productNameSnapshot: 'Game Account',
        unitPriceSnapshot: '3.00',
        quantitySnapshot: 2,
        totalSnapshot: '6.00',
        currencySnapshot: 'USD',
        deliveryTypeSnapshot: 'DIGITAL_TEXT',
        providerServiceIdSnapshot: null,
        target: null,
        createdAt: new Date(),
        product: { id: 'product-1', name: 'Game Account', slug: 'game-account' },
        fulfillment: { id: 'f-1', status: 'DELIVERED', deliveryRef: 'fulfillment-abc', deliveredAt: new Date(), failureReason: null }
      }
    ]
  });

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns all delivered stock items for a multi-quantity purchase', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.order.findUnique.mockResolvedValue(makeOrderWithDeliveredItems());
    prisma.productStock.findMany.mockResolvedValue([
      { id: 'stock-1', productId: 'product-1', status: 'SOLD' },
      { id: 'stock-2', productId: 'product-1', status: 'SOLD' }
    ]);
    prisma.manualDelivery.findMany.mockResolvedValue([]);
    stockServiceMock.getStockWithDecryptedValue.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        deliveryValue: id === 'stock-1' ? 'acct1@example.com|pass1' : 'acct2@example.com|pass2',
        deliveryType: 'DIGITAL_TEXT'
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/order-1',
      headers: authHeaders
    });

    expect(response.statusCode).toBe(200);
    const item = response.json().order.items[0];
    expect(item.deliveryValues).toEqual(['acct1@example.com|pass1', 'acct2@example.com|pass2']);
    expect(item.deliveryValue).toBe('acct1@example.com|pass1');
  });

  it('returns no delivery values when fulfillment is not delivered', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    const order = makeOrderWithDeliveredItems();
    order.items[0].fulfillment = { id: 'f-1', status: 'PENDING', deliveryRef: null, deliveredAt: null, failureReason: null };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.productStock.findMany.mockResolvedValue([
      { id: 'stock-1', productId: 'product-1', status: 'RESERVED' }
    ]);
    prisma.manualDelivery.findMany.mockResolvedValue([]);
    stockServiceMock.getStockWithDecryptedValue.mockResolvedValue({
      id: 'stock-1',
      deliveryValue: 'acct1@example.com|pass1',
      deliveryType: 'DIGITAL_TEXT'
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/order-1',
      headers: authHeaders
    });

    expect(response.statusCode).toBe(200);
    const item = response.json().order.items[0];
    expect(item.deliveryValues).toEqual([]);
    expect(item.deliveryValue).toBeNull();
  });
});

describe('POST /api/admin/orders/:id/fulfill (delivery notification)', () => {
  let app: ReturnType<typeof buildApp>;
  let fetchMock: ReturnType<typeof vi.fn>;

  const makeActiveAdminRow = () => ({
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
          permissions: [{ permission: { key: 'orders:update' } }]
        }
      }
    ]
  });

  const mockOrderFulfillFlow = () => {
    prisma.admin.findUnique.mockResolvedValue(makeActiveAdminRow());
    prisma.order.findUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        orderNumber: 42,
        userId: 'user-1',
        status: 'PAID',
        currency: 'USD',
        subtotal: '6.00',
        discount: 0,
        total: '6.00',
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [{ id: 'item-1', orderId: 'order-1', productId: 'product-1', quantitySnapshot: 2, productNameSnapshot: 'Game Account', totalSnapshot: '6.00', unitPriceSnapshot: '3.00', currencySnapshot: 'USD', fulfillment: null }]
      })
      .mockResolvedValueOnce({ status: 'COMPLETED' })
      .mockResolvedValueOnce({
        id: 'order-1',
        orderNumber: 42,
        status: 'COMPLETED',
        total: '6.00',
        currency: 'USD',
        user: { telegramId: BigInt(123456789) },
        items: [{ productNameSnapshot: 'Game Account', quantitySnapshot: 2 }]
      });
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 'item-1',
      quantitySnapshot: 2,
      order: { id: 'order-1', status: 'PAID' },
      fulfillment: null
    });
    stockServiceMock.getOrderStock.mockResolvedValue([
      { id: 'stock-1' },
      { id: 'stock-2' }
    ]);
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        productStock: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
        fulfillmentRecord: { upsert: vi.fn().mockResolvedValue({ id: 'f-1', status: 'DELIVERED', deliveredAt: new Date() }) }
      })
    );
    prisma.order.update.mockResolvedValue({ id: 'order-1', status: 'COMPLETED' });
  };

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    prisma.$transaction.mockReset();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    await app.close();
  });

  it('fulfills the order and sends a private Telegram delivery message', async () => {
    mockOrderFulfillFlow();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/order-1/fulfill',
      headers: { authorization: 'Bearer admin-test-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, fulfilledItems: 1, errors: [] });
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('api.telegram.org');
    const payload = JSON.parse(init.body);
    expect(payload.chat_id).toBe('123456789');
    expect(payload.text).toContain('#42');
    expect(payload.text).toContain('Game Account');
    expect(payload.text).not.toContain('pass1');
    expect(payload.text).not.toContain('pass2');
  });

  it('keeps the order fulfilled when the Telegram notification fails', async () => {
    mockOrderFulfillFlow();
    fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orders/order-1/fulfill',
      headers: { authorization: 'Bearer admin-test-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, fulfilledItems: 1, errors: [] });
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});

describe('GET /api/orders', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns user orders with pagination', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        orderNumber: 1,
        userId: 'user-1',
        status: 'DRAFT',
        currency: 'USD',
        subtotal: '10.00',
        discount: 0,
        total: '10.00',
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
            productNameSnapshot: 'Test Product',
            unitPriceSnapshot: '10.00',
            quantitySnapshot: 1,
            totalSnapshot: '10.00',
            currencySnapshot: 'USD',
            deliveryTypeSnapshot: 'DIGITAL_LINK',
            providerServiceIdSnapshot: null,
            target: null,
            createdAt: new Date(),
            product: { id: 'product-1', name: 'Test Product', slug: 'test-product' }
          }
        ]
      }
    ]);
    prisma.order.count.mockResolvedValue(1);

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders',
      headers: authHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      orders: [{ orderNumber: 1 }],
      total: 1,
      page: 1,
      pageSize: 20
    });
  });

  it('returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/orders'
    });

    expect(response.statusCode).toBe(401);
  });

  it('only returns orders for authenticated user', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);

    await app.inject({
      method: 'GET',
      url: '/api/orders',
      headers: authHeaders
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' }
      })
    );
  });
});

describe('GET /api/orders/:id', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns order detail for owner', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 1,
      userId: 'user-1',
      status: 'DRAFT',
      currency: 'USD',
      subtotal: '10.00',
      discount: 0,
      total: '10.00',
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
          productNameSnapshot: 'Test Product',
          unitPriceSnapshot: '10.00',
          quantitySnapshot: 1,
          totalSnapshot: '10.00',
          currencySnapshot: 'USD',
          deliveryTypeSnapshot: 'DIGITAL_LINK',
          providerServiceIdSnapshot: null,
          target: null,
          createdAt: new Date(),
          product: { id: 'product-1', name: 'Test Product', slug: 'test-product' }
        }
      ]
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/order-1',
      headers: authHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      order: { orderNumber: 1, id: 'order-1' }
    });
  });

  it('returns 404 for non-existent order', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.order.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/non-existent',
      headers: authHeaders
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for order owned by another user', async () => {
    prisma.user.findUnique.mockResolvedValue(mockDbUser);
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 1,
      userId: 'other-user',
      status: 'DRAFT',
      currency: 'USD',
      subtotal: '10.00',
      discount: 0,
      total: '10.00',
      createdAt: new Date(),
      updatedAt: new Date(),
      items: []
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/order-1',
      headers: authHeaders
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/order-1'
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('Customer Isolation', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp();
    });

    afterEach(async () => {
      vi.clearAllMocks();
      await app.close();
    });

    it('prevents accessing another user order via direct ID', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        orderNumber: 1,
        userId: 'other-user',
        status: 'DRAFT',
        currency: 'USD',
        subtotal: '10.00',
        discount: 0,
        total: '10.00',
        idempotencyKey: null,
        expiresAt: null,
        paidAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: []
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/orders/order-1',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(404);
    });

    it('filters orders by authenticated user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      await app.inject({
        method: 'GET',
        url: '/api/orders',
        headers: authHeaders
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' }
        })
      );
    });

    it('filters payments by authenticated user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        reference: 'pay-1',
        provider: 'MANUAL',
        status: 'PENDING',
        amount: '10.00',
        currency: 'USD',
        expiresAt: new Date(),
        paidAt: null,
        createdAt: new Date(),
        userId: 'user-1'
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/payments/payment-1',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Secret Protection', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp();
    });

    afterEach(async () => {
      vi.clearAllMocks();
      await app.close();
    });

    it('does not expose secrets in API responses', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      const response = await app.inject({
        method: 'GET',
        url: '/api/orders',
        headers: authHeaders
      });

      const body = response.json();
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('SECRET');
      expect(bodyStr).not.toContain('TOKEN');
      expect(bodyStr).not.toContain('PASSWORD');
      expect(bodyStr).not.toContain('KEY');
    });

    it('does not expose admin secret in responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/dashboard'
      });
      const body = response.json();
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('ADMIN_SECRET');
    });
  });

  describe('Error Handling', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp();
    });

    afterEach(async () => {
      vi.clearAllMocks();
      await app.close();
    });

    it('does not expose stack traces in error responses', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('Database connection failed'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/orders',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error).not.toContain('Database connection failed');
    });

    it('returns generic error for internal failures', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('Internal server error'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/orders/order-1',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Support Tickets', () => {
    let app: ReturnType<typeof buildApp>;

    const CUSTOMER_TICKET_ROW = {
      id: 'ticket-1',
      number: 9,
      userId: 'user-1',
      orderId: 'order-1',
      subject: 'Payment problem',
      status: 'OPEN',
      createdAt: new Date('2026-08-18T10:00:00Z'),
      updatedAt: new Date('2026-08-18T10:00:00Z')
    };

    beforeEach(() => {
      app = buildApp();
      prisma.user.findUnique.mockResolvedValue({ ...mockDbUser });
      prisma.supportMessage.create.mockResolvedValue({
        id: 'msg-1',
        ticketId: 'ticket-1',
        sender: 'USER',
        body: 'Need help',
        createdAt: new Date()
      });
      prisma.supportMessage.count.mockResolvedValue(0);
      prisma.supportTicket.findUnique.mockResolvedValue({
        ...CUSTOMER_TICKET_ROW,
        order: { id: 'order-1', orderNumber: 11 },
        messages: [
          {
            id: 'msg-1',
            ticketId: 'ticket-1',
            userId: 'user-1',
            adminId: null,
            sender: 'USER',
            body: 'Need help',
            createdAt: new Date('2026-08-18T10:00:00Z'),
            admin: null
          }
        ]
      });
    });

    afterEach(async () => {
      prisma.$transaction.mockReset();
      vi.clearAllMocks();
      await app.close();
    });

    it('creates a ticket bound to the verified Telegram identity, ignoring client-supplied identity fields', async () => {
      prisma.supportTicket.create.mockResolvedValue({ ...CUSTOMER_TICKET_ROW });
      prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({
          order: { findFirst: vi.fn().mockResolvedValue({ id: 'order-1', userId: 'user-1' }) },
          supportTicket: prisma.supportTicket,
          supportMessage: prisma.supportMessage
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/tickets',
        headers: authHeaders,
        payload: {
          subject: 'Payment problem',
          body: 'Need help',
          orderId: 'order-1',
          telegramId: 999000099,
          userId: 'spoofed-user',
          initData: 'spoofed'
        }
      });

      expect(response.statusCode).toBe(201);
      const createCall = vi.mocked(prisma.supportTicket.create).mock.calls[0][0] as {
        data: { userId: string };
      };
      expect(createCall.data.userId).toBe('user-1');
      expect(createCall.data.userId).not.toBe('spoofed-user');
      const welcomeCreates = prisma.supportMessage.create.mock.calls.filter(
        (call) => (call[0] as { data?: { sender?: string } }).data?.sender === 'SYSTEM'
      );
      expect(welcomeCreates).toHaveLength(1);
      expect((welcomeCreates[0][0] as { data: { body: string } }).data.body).toContain('Ticket: #9');
    });

    it('rejects ticket creation without valid Telegram init data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/tickets',
        payload: { subject: 'Payment problem', body: 'Need help' }
      });

      expect(response.statusCode).toBe(401);
      expect(prisma.supportTicket.create).not.toHaveBeenCalled();
    });

    it('keeps the admin reply visible in the customer conversation', async () => {
      prisma.supportTicket.create.mockResolvedValue({ ...CUSTOMER_TICKET_ROW });
      prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({
          order: { findFirst: vi.fn().mockResolvedValue({ id: 'order-1', userId: 'user-1' }) },
          supportTicket: prisma.supportTicket,
          supportMessage: prisma.supportMessage,
          auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) }
        })
      );

      await app.inject({
        method: 'POST',
        url: '/api/tickets',
        headers: authHeaders,
        payload: { subject: 'Payment problem', body: 'Need help', orderId: 'order-1' }
      });

      prisma.supportTicket.findUnique.mockResolvedValue({
        ...CUSTOMER_TICKET_ROW,
        status: 'IN_PROGRESS',
        order: { id: 'order-1', orderNumber: 11 },
        messages: [
          {
            id: 'msg-1',
            ticketId: 'ticket-1',
            userId: 'user-1',
            adminId: null,
            sender: 'USER',
            body: 'Need help',
            createdAt: new Date('2026-08-18T10:00:00Z'),
            admin: null
          },
          {
            id: 'msg-2',
            ticketId: 'ticket-1',
            userId: null,
            adminId: 'admin-1',
            sender: 'ADMIN',
            body: 'We are checking this for you',
            createdAt: new Date('2026-08-18T10:30:00Z'),
            admin: { id: 'admin-1', firstName: 'Jane', lastName: 'Staff' }
          }
        ]
      });
      prisma.supportMessage.create.mockResolvedValue({
        id: 'msg-2',
        ticketId: 'ticket-1',
        userId: null,
        adminId: 'admin-1',
        sender: 'ADMIN',
        body: 'We are checking this for you',
        createdAt: new Date()
      });
      prisma.supportTicket.update.mockResolvedValue({
        id: 'ticket-1',
        status: 'IN_PROGRESS',
        updatedAt: new Date()
      });
      prisma.admin.findUnique.mockResolvedValue({
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
                { permission: { key: 'tickets:read' } },
                { permission: { key: 'tickets:update' } }
              ]
            }
          }
        ]
      });

      const adminReply = await app.inject({
        method: 'POST',
        url: '/api/admin/tickets/ticket-1/messages',
        headers: { authorization: `Bearer ${hashAdminToken('admin-token-for-tests')}` },
        payload: { body: 'We are checking this for you' }
      });
      expect(adminReply.statusCode).toBe(201);

      prisma.supportTicket.findUnique.mockResolvedValue({
        ...CUSTOMER_TICKET_ROW,
        status: 'IN_PROGRESS',
        order: { id: 'order-1', orderNumber: 11 },
        messages: [
          {
            id: 'msg-1',
            ticketId: 'ticket-1',
            userId: 'user-1',
            adminId: null,
            sender: 'USER',
            body: 'Need help',
            createdAt: new Date('2026-08-18T10:00:00Z'),
            admin: null
          },
          {
            id: 'msg-2',
            ticketId: 'ticket-1',
            userId: null,
            adminId: 'admin-1',
            sender: 'ADMIN',
            body: 'We are checking this for you',
            createdAt: new Date('2026-08-18T10:30:00Z'),
            admin: { id: 'admin-1', firstName: 'Jane', lastName: 'Staff' }
          }
        ]
      });

      const customerView = await app.inject({
        method: 'GET',
        url: '/api/tickets/ticket-1',
        headers: authHeaders
      });

      expect(customerView.statusCode).toBe(200);
      const ticket = customerView.json().ticket;
      expect(ticket.messages).toHaveLength(2);
      expect(ticket.messages[1]).toMatchObject({
        sender: 'ADMIN',
        fromAdmin: true,
        adminName: 'Jane Staff',
        body: 'We are checking this for you'
      });
    });

    it('requires admin authorization for admin ticket access', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/tickets'
      });

      expect(response.statusCode).toBe(401);
    });

    it('does not allow a customer to read another customer ticket', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({
        ...CUSTOMER_TICKET_ROW,
        userId: 'user-2'
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/tickets/ticket-1',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(404);
      expect(prisma.supportMessage.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('Support unread notifications', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp();
      prisma.user.findUnique.mockResolvedValue({ ...mockDbUser });
      prisma.supportMessage.count.mockResolvedValue(0);
      prisma.supportMessage.updateMany.mockResolvedValue({ count: 0 });
    });

    afterEach(async () => {
      prisma.$transaction.mockReset();
      vi.clearAllMocks();
      await app.close();
    });

    it('returns the unread ADMIN-message count for the verified customer', async () => {
      prisma.supportMessage.count.mockResolvedValue(3);

      const response = await app.inject({
        method: 'GET',
        url: '/api/tickets/unread-count',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ unreadCount: 3 });
      expect(prisma.supportMessage.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sender: 'ADMIN',
            customerReadAt: null,
            ticket: { userId: 'user-1' }
          }
        })
      );
    });

    it('does not expose the unread count without verified Telegram identity', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/tickets/unread-count'
      });

      expect(response.statusCode).toBe(401);
      expect(prisma.supportMessage.count).not.toHaveBeenCalled();
    });

    it('marks the customer admin-messages read when the support list is opened', async () => {
      prisma.supportTicket.findMany.mockResolvedValue([]);
      prisma.supportTicket.count.mockResolvedValue(0);

      const response = await app.inject({
        method: 'GET',
        url: '/api/tickets',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(prisma.supportMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sender: 'ADMIN',
            customerReadAt: null,
            ticket: { userId: 'user-1' }
          }
        })
      );
    });

    it('marks only the opened ticket read when the customer opens a ticket', async () => {
      prisma.supportTicket.findUnique
        .mockResolvedValueOnce({ id: 'ticket-1', userId: 'user-1' })
        .mockResolvedValue({
          id: 'ticket-1',
          number: 9,
          userId: 'user-1',
          orderId: 'order-1',
          subject: 'Payment problem',
          status: 'OPEN',
          createdAt: new Date('2026-08-18T10:00:00Z'),
          updatedAt: new Date('2026-08-18T10:00:00Z'),
          order: { id: 'order-1', orderNumber: 11 },
          messages: []
        });

      const response = await app.inject({
        method: 'GET',
        url: '/api/tickets/ticket-1',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(prisma.supportMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ticketId: 'ticket-1',
            sender: 'ADMIN',
            customerReadAt: null,
            ticket: { userId: 'user-1' }
          }
        })
      );
    });

    it('returns the unread customer-message count for the admin', async () => {
      prisma.supportMessage.count.mockResolvedValue(2);
      prisma.admin.findUnique.mockResolvedValue({
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
              permissions: [{ permission: { key: 'tickets:read' } }]
            }
          }
        ]
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/tickets/unread-count',
        headers: { authorization: `Bearer ${hashAdminToken('admin-token-for-tests')}` }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ unreadCount: 2 });
      expect(prisma.supportMessage.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sender: 'USER', adminReadAt: null }
        })
      );
    });

    it('rejects the admin unread count without admin authorization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/tickets/unread-count'
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Admin product & category DELETE routes', () => {
    let app: ReturnType<typeof buildApp>;

    const PRODUCT_ROW = {
      id: 'product-1',
      name: 'Gemini 18 Month',
      slug: 'gemini-18-month',
      categoryId: 'cat-1',
      type: 'DIGITAL_LINK',
      deliveryType: 'DIGITAL_LINK',
      price: new Prisma.Decimal('2.60'),
      currency: 'USD',
      minimumQuantity: 1,
      maximumQuantity: 1,
      status: 'ACTIVE',
      isActive: true,
      sortOrder: 0
    };

    const CATEGORY_ROW = {
      id: 'cat-1',
      name: 'Digital Accounts',
      slug: 'digital-accounts',
      isActive: true,
      isArchived: false,
      sortOrder: 0
    };

    const ADMIN_ROW = {
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
              { permission: { key: 'products:delete' } },
              { permission: { key: 'products:read' } },
              { permission: { key: 'categories:delete' } },
              { permission: { key: 'categories:read' } }
            ]
          }
        }
      ]
    };

    const adminHeaders = { authorization: `Bearer ${hashAdminToken('admin-token-for-tests')}` };

    beforeEach(() => {
      app = buildApp();
      prisma.admin.findUnique.mockResolvedValue(ADMIN_ROW);
      prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({
          product: { delete: vi.fn().mockResolvedValue({ id: 'product-1' }) },
          category: { delete: vi.fn().mockResolvedValue({ id: 'cat-1' }) },
          auditLog: { create: vi.fn().mockResolvedValue({ id: 'log-1' }) }
        })
      );
    });

    afterEach(async () => {
      prisma.$transaction.mockReset();
      vi.clearAllMocks();
      await app.close();
    });

    it('deletes a clean product with no dependencies (200 success)', async () => {
      prisma.product.findUnique.mockResolvedValue(PRODUCT_ROW);
      prisma.orderItem.count.mockResolvedValue(0);
      prisma.productStock.count.mockResolvedValue(0);
      prisma.productVariant.count.mockResolvedValue(0);
      prisma.license.count.mockResolvedValue(0);
      prisma.smmService.count.mockResolvedValue(0);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/products/product-1',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(prisma.product.findUnique).toHaveBeenCalledWith({ where: { id: 'product-1' } });
    });

    it('rejects deleting a product with stock (400 + safe message)', async () => {
      prisma.product.findUnique.mockResolvedValue(PRODUCT_ROW);
      prisma.orderItem.count.mockResolvedValue(0);
      prisma.productStock.count.mockResolvedValue(3);
      prisma.productVariant.count.mockResolvedValue(0);
      prisma.license.count.mockResolvedValue(0);
      prisma.smmService.count.mockResolvedValue(0);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/products/product-1',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'This product has 3 inventory items and cannot be deleted. Disable or archive it instead.'
      });
    });

    it('rejects deleting a product with order history (400 + safe message)', async () => {
      prisma.product.findUnique.mockResolvedValue(PRODUCT_ROW);
      prisma.orderItem.count.mockResolvedValue(1);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/products/product-1',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'This product has historical orders and cannot be deleted. Disable or archive it instead.'
      });
    });

    it('returns 404 when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/products/product-missing',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Product not found' });
    });

    it('rejects product deletion without admin authorization (401)', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/products/product-1'
      });

      expect(response.statusCode).toBe(401);
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
    });

    it('deletes a category with no products (200 success)', async () => {
      prisma.category.findUnique.mockResolvedValue(CATEGORY_ROW);
      prisma.product.count.mockResolvedValue(0);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/categories/cat-1',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(prisma.product.count).toHaveBeenCalledWith({ where: { categoryId: 'cat-1' } });
    });

    it('rejects deleting a category with products (400 + clear message)', async () => {
      prisma.category.findUnique.mockResolvedValue(CATEGORY_ROW);
      prisma.product.count.mockResolvedValue(4);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/categories/cat-1',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Cannot delete category with existing products' });
    });

    it('returns 404 when the category does not exist', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/categories/cat-missing',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Category not found' });
    });

    it('rejects category deletion without admin authorization (401)', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/categories/cat-1'
      });

      expect(response.statusCode).toBe(401);
      expect(prisma.category.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('Admin order refund route', () => {
    let app: ReturnType<typeof buildApp>;

    const ADMIN_ROW = {
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
              { permission: { key: 'orders:update' } },
              { permission: { key: 'orders:read' } }
            ]
          }
        }
      ]
    };

    const adminHeaders = { authorization: `Bearer ${hashAdminToken('admin-token-for-tests')}` };

    const KHQR_ORDER_ROW = {
      id: 'order-1',
      orderNumber: 59,
      userId: 'user-1',
      status: 'PAID',
      currency: 'USD',
      total: new Prisma.Decimal('2.60'),
      user: {
        id: 'user-1',
        firstName: 'John',
        lastName: 'Doe',
        username: 'johndoe',
        telegramId: BigInt(123456789)
      },
      payments: [
        {
          id: 'payment-1',
          orderId: 'order-1',
          userId: 'user-1',
          provider: 'KHQR',
          status: 'SUCCEEDED',
          amount: new Prisma.Decimal('2.60'),
          currency: 'USD',
          reference: 'JR-OR-REF1',
          providerTransactionHash: 'bakong-hash-1',
          idempotencyKey: 'idem-1'
        }
      ]
    };

    beforeEach(() => {
      app = buildApp();
      prisma.admin.findUnique.mockResolvedValue(ADMIN_ROW);
      prisma.order.findUnique.mockResolvedValue(KHQR_ORDER_ROW);
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.productStock.findMany.mockResolvedValue([]);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({
          order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          payment: {
            update: vi.fn().mockResolvedValue({ id: 'payment-1', status: 'REFUNDED' }),
            create: vi.fn().mockResolvedValue({ id: 'refund-payment-1' })
          },
          productStock: {
            findMany: vi.fn().mockResolvedValue([]),
            updateMany: vi.fn()
          },
          auditLog: { create: vi.fn().mockResolvedValue({ id: 'log-1' }) }
        })
      );
    });

    afterEach(async () => {
      prisma.$transaction.mockReset();
      vi.clearAllMocks();
      await app.close();
    });

    it('refunds a paid KHQR order via the admin route and reports the external-refund limitation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/orders/order-1/refund',
        headers: adminHeaders,
        payload: { reason: 'Duplicate purchase', amount: '2.60' }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.refund).toEqual(
        expect.objectContaining({
          provider: 'KHQR',
          amountRefunded: '2.60',
          currency: 'USD',
          externalRefundRequired: true
        })
      );
    });

    it('rejects a refund amount that exceeds the amount actually paid (400)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/orders/order-1/refund',
        headers: adminHeaders,
        payload: { amount: '99.99' }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('cannot exceed');
    });

    it('rejects refund without admin authorization (401)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/orders/order-1/refund',
        payload: { reason: 'x' }
      });

      expect(response.statusCode).toBe(401);
      expect(prisma.order.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('Customer payment cancel route (KHQR race)', () => {
    let app: ReturnType<typeof buildApp>;

    const PAYMENT_ROW = {
      id: 'payment-1',
      orderId: 'order-1',
      userId: 'user-1',
      provider: 'KHQR',
      status: 'PENDING',
      amount: new Prisma.Decimal('2.60'),
      currency: 'USD',
      reference: 'JR-OR-REF1',
      providerPaymentId: 'fakemd5abcdef0123456789abcdef0123',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      paidAt: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      order: { id: 'order-1' }
    };

    beforeEach(() => {
      app = buildApp();
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
    });

    afterEach(async () => {
      vi.clearAllMocks();
      await app.close();
    });

    it('returns paid:true when cancelling an already SUCCEEDED payment', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, status: 'SUCCEEDED', paidAt: new Date() });
      prisma.order.findUnique.mockResolvedValue({ status: 'COMPLETED' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/payment-1/expire',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({ success: true, status: 'SUCCEEDED', paid: true, alreadyTerminal: true })
      );
    });

    it('is idempotent for an already CANCELLED payment', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, status: 'CANCELLED' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/payment-1/expire',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({ success: true, status: 'CANCELLED', alreadyTerminal: true })
      );
    });

    it('refuses to cancel when the backend cannot confirm the payment is unpaid', async () => {
      prisma.payment.findUnique.mockResolvedValue(PAYMENT_ROW);

      const response = await app.inject({
        method: 'POST',
        url: '/api/payments/payment-1/expire',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('could not be confirmed');
    });
  });

  describe('GET /api/banners (targeting regression)', () => {
    let app: ReturnType<typeof buildApp>;

    const TOP_UP_CATEGORY_ID = '41235c89-a91e-4115-a6cf-f4216c6cf1c2';
    const OTHER_CATEGORY_ID = '99999999-9999-4999-8999-999999999999';

    const homeBanner = {
      id: 'banner-home',
      title: '5% OFF STOREWIDE',
      subtitle: null,
      imageUrl: null,
      buttonText: null,
      buttonDestination: null,
      targetType: 'HOME',
      targetCategoryId: null,
      targetProductId: null,
      targetPage: null
    };

    const topUpBanner = {
      id: 'banner-topup',
      title: 'MLBB biner',
      subtitle: null,
      imageUrl: null,
      buttonText: null,
      buttonDestination: null,
      targetType: 'CATEGORY',
      targetCategoryId: TOP_UP_CATEGORY_ID,
      targetProductId: null,
      targetPage: null
    };

    beforeEach(() => {
      app = buildApp();
    });

    afterEach(async () => {
      vi.clearAllMocks();
      await app.close();
    });

    it('TEST A: HOME target returns only HOME banners', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.banner.findMany.mockResolvedValue([homeBanner]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/banners?targetType=HOME',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().banners).toHaveLength(1);
      expect(response.json().banners[0]).toMatchObject({ id: 'banner-home', targetType: 'HOME' });

      const where = prisma.banner.findMany.mock.calls[0][0].where;
      expect(where.targetType).toBe('HOME');
      expect(where.targetCategoryId).toBeUndefined();
    });

    it('TEST B: CATEGORY/TopUp target matches the requested category id', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.banner.findMany.mockResolvedValue([topUpBanner]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/banners?targetType=CATEGORY&categoryId=${TOP_UP_CATEGORY_ID}`,
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().banners).toHaveLength(1);
      expect(response.json().banners[0]).toMatchObject({
        id: 'banner-topup',
        targetType: 'CATEGORY',
        targetCategoryId: TOP_UP_CATEGORY_ID
      });

      const where = prisma.banner.findMany.mock.calls[0][0].where;
      // Top-level targetType=CATEGORY must keep HOME banners out of category pages.
      expect(where.targetType).toBe('CATEGORY');
      // Schedule window survives (startsAt branch untouched)…
      expect(where.OR).toEqual([{ startsAt: null }, { startsAt: { lte: expect.any(Date) } }]);
      // …and targeting narrows via AND: HOME allowed only when no targetType filter,
      // CATEGORY only for the requested category id.
      expect(where.AND).toHaveLength(2);
      expect(where.AND[1].OR).toEqual([
        { targetType: 'HOME' },
        { AND: [{ targetType: 'CATEGORY' }, { targetCategoryId: TOP_UP_CATEGORY_ID }] }
      ]);
    });

    it('TEST C: non-matching category targets only that other category', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.banner.findMany.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/banners?targetType=CATEGORY&categoryId=${OTHER_CATEGORY_ID}`,
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().banners).toEqual([]);

      const where = prisma.banner.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(2);
      expect(where.AND[1].OR).toEqual([
        { targetType: 'HOME' },
        { AND: [{ targetType: 'CATEGORY' }, { targetCategoryId: OTHER_CATEGORY_ID }] }
      ]);
    });

    it('TEST D+E: inactive and out-of-schedule banners are excluded by the query', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.banner.findMany.mockResolvedValue([]);

      // The route snapshots its clock during the request, so the comparison
      // window must start before the request fires (post-response timestamps
      // can land on the next millisecond and flake).
      const before = new Date();
      const response = await app.inject({
        method: 'GET',
        url: '/api/banners?targetType=HOME',
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);

      const where = prisma.banner.findMany.mock.calls[0][0].where;
      const after = new Date();
      // Inactive banners can never be served.
      expect(where.isActive).toBe(true);
      // Schedule window: startsAt <= now (not yet scheduled excluded)…
      expect(where.OR).toEqual([
        { startsAt: null },
        { startsAt: { lte: expect.any(Date) } }
      ]);
      expect((where.OR[1] as { startsAt: { lte: Date } }).startsAt.lte.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect((where.OR[1] as { startsAt: { lte: Date } }).startsAt.lte.getTime()).toBeLessThanOrEqual(
        after.getTime()
      );
      // …and endsAt > now (expired banners excluded; the endAt instant itself
      // is no longer visible per the scheduling contract).
      const endsAtBranch = where.AND[0].OR;
      expect(endsAtBranch).toEqual([
        { endsAt: null },
        { endsAt: { gt: expect.any(Date) } }
      ]);
      expect((endsAtBranch[1] as { endsAt: { gt: Date } }).endsAt.gt.getTime()).toBeLessThanOrEqual(
        after.getTime()
      );
    });

    it('TEST F: multiple banners keep sortOrder ordering and are capped', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.banner.findMany.mockResolvedValue([topUpBanner, homeBanner]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/banners?targetType=CATEGORY&categoryId=${TOP_UP_CATEGORY_ID}`,
        headers: authHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().banners.map((b: { id: string }) => b.id)).toEqual(['banner-topup', 'banner-home']);

      const options = prisma.banner.findMany.mock.calls[0][0];
      expect(options.orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'desc' }]);
      expect(options.take).toBe(20);
    });
  });
