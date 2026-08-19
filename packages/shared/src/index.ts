import { z } from 'zod';

export const appName = 'JR Digital license';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const categorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Category = z.infer<typeof categorySchema>;

export const productSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  type: z.string(),
  deliveryType: z.string(),
  price: z.string(),
  currency: z.string(),
  costPrice: z.string().nullable(),
  markup: z.string().nullable(),
  minimumQuantity: z.number().int(),
  maximumQuantity: z.number().int().nullable(),
  hideWhenOutOfStock: z.boolean(),
  status: z.string(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  isPopular: z.boolean(),
  sortOrder: z.number().int(),
  instructions: z.string().nullable(),
  keywords: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Product = z.infer<typeof productSchema>;

export const categoriesResponseSchema = z.object({
  categories: z.array(categorySchema)
});

export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;

export const productsResponseSchema = z.object({
  products: z.array(productSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int()
});

export type ProductsResponse = z.infer<typeof productsResponseSchema>;

export const productDetailResponseSchema = z.object({
  product: productSchema
});

export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>;

export const orderItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
  productNameSnapshot: z.string(),
  unitPriceSnapshot: z.string(),
  quantitySnapshot: z.number().int(),
  totalSnapshot: z.string(),
  currencySnapshot: z.string(),
  deliveryTypeSnapshot: z.string(),
  providerServiceIdSnapshot: z.string().nullable(),
  target: z.string().nullable(),
  createdAt: z.string()
});

export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.number().int(),
  userId: z.string().uuid(),
  status: z.string(),
  currency: z.string(),
  subtotal: z.string(),
  discount: z.string(),
  total: z.string(),
  idempotencyKey: z.string().nullable(),
  expiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(orderItemSchema)
});

export type Order = z.infer<typeof orderSchema>;

export const ordersResponseSchema = z.object({
  orders: z.array(orderSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int()
});

export type OrdersResponse = z.infer<typeof ordersResponseSchema>;

export const orderDetailResponseSchema = z.object({
  order: orderSchema
});

export type OrderDetailResponse = z.infer<typeof orderDetailResponseSchema>;

export const createOrderRequestSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
  target: z.string().optional(),
  idempotencyKey: z.string().optional()
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const createOrderResponseSchema = z.object({
  order: orderSchema
});

export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

export const stockStatusSchema = z.enum(['AVAILABLE', 'RESERVED', 'SOLD', 'DISABLED']);
export type StockStatus = z.infer<typeof stockStatusSchema>;

export const productStockSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  deliveryValue: z.string().nullable(),
  deliveryType: z.string(),
  status: stockStatusSchema,
  orderId: z.string().uuid().nullable(),
  reservedAt: z.string().nullable(),
  soldAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  product: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string()
  }).optional(),
  variant: z.object({
    id: z.string().uuid(),
    name: z.string()
  }).optional(),
  order: z.object({
    id: z.string().uuid(),
    orderNumber: z.number().int(),
    userId: z.string().uuid()
  }).optional()
});

export type ProductStock = z.infer<typeof productStockSchema>;

export const stockResponseSchema = z.object({
  stock: z.array(productStockSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int()
});

export type StockResponse = z.infer<typeof stockResponseSchema>;

export const stockSummarySchema = z.object({
  available: z.number().int(),
  reserved: z.number().int(),
  sold: z.number().int(),
  disabled: z.number().int(),
  total: z.number().int()
});

export type StockSummary = z.infer<typeof stockSummarySchema>;

export const createStockRequestSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  deliveryType: z.string(),
  values: z.array(z.string()).min(1)
});

export type CreateStockRequest = z.infer<typeof createStockRequestSchema>;

export const createStockResponseSchema = z.object({
  stock: z.array(productStockSchema.omit({ deliveryValue: true })),
  count: z.number().int()
});

export type CreateStockResponse = z.infer<typeof createStockResponseSchema>;

export const paymentStatusSchema = z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentProviderSchema = z.enum(['KHQR', 'BAKONG', 'WALLET', 'MANUAL']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const paymentSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  provider: paymentProviderSchema,
  status: paymentStatusSchema,
  amount: z.string(),
  currency: z.string(),
  reference: z.string(),
  providerPaymentId: z.string().nullable(),
  idempotencyKey: z.string(),
  expiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Payment = z.infer<typeof paymentSchema>;

export const createPaymentRequestSchema = z.object({
  orderId: z.string().uuid(),
  provider: paymentProviderSchema,
  idempotencyKey: z.string().optional()
});

export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

export const createPaymentResponseSchema = z.object({
  payment: paymentSchema
});

export type CreatePaymentResponse = z.infer<typeof createPaymentResponseSchema>;

export const paymentDetailResponseSchema = z.object({
  payment: paymentSchema
});

export type PaymentDetailResponse = z.infer<typeof paymentDetailResponseSchema>;

export const paymentStatusResponseSchema = z.object({
  payment: paymentSchema,
  isExpired: z.boolean()
});

export type PaymentStatusResponse = z.infer<typeof paymentStatusResponseSchema>;

export const adminUserSchema = z.object({
  id: z.string().uuid(),
  telegramId: z.string(),
  username: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  roles: z.array(z.string()),
  permissions: z.array(z.string())
});

export type AdminUser = z.infer<typeof adminUserSchema>;

export const createProductRequestSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  categoryId: z.string().uuid(),
  type: z.enum(['DIGITAL_LINK', 'DIGITAL_CODE', 'DIGITAL_TEXT', 'DIGITAL_FILE', 'DIGITAL_ACCOUNT', 'SMM_API']),
  deliveryType: z.enum(['DIGITAL_LINK', 'DIGITAL_CODE', 'DIGITAL_TEXT', 'DIGITAL_FILE', 'DIGITAL_ACCOUNT', 'MANUAL', 'SMM']),
  price: z.union([z.string(), z.number()]),
  currency: z.string().length(3).optional(),
  costPrice: z.union([z.string(), z.number()]).nullable().optional(),
  markup: z.union([z.string(), z.number()]).nullable().optional(),
  minimumQuantity: z.number().int().min(1).optional(),
  maximumQuantity: z.number().int().min(1).nullable().optional(),
  hideWhenOutOfStock: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'DRAFT', 'OUT_OF_STOCK', 'ARCHIVED']).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  instructions: z.string().nullable().optional(),
  keywords: z.array(z.string()).optional()
});

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  categoryId: z.string().uuid().optional(),
  type: z.enum(['DIGITAL_LINK', 'DIGITAL_CODE', 'DIGITAL_TEXT', 'DIGITAL_FILE', 'DIGITAL_ACCOUNT', 'SMM_API']).optional(),
  deliveryType: z.enum(['DIGITAL_LINK', 'DIGITAL_CODE', 'DIGITAL_TEXT', 'DIGITAL_FILE', 'DIGITAL_ACCOUNT', 'MANUAL', 'SMM']).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  currency: z.string().length(3).optional(),
  costPrice: z.union([z.string(), z.number()]).nullable().optional(),
  markup: z.union([z.string(), z.number()]).nullable().optional(),
  minimumQuantity: z.number().int().min(1).optional(),
  maximumQuantity: z.number().int().min(1).nullable().optional(),
  hideWhenOutOfStock: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'DRAFT', 'OUT_OF_STOCK', 'ARCHIVED']).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  instructions: z.string().nullable().optional(),
  keywords: z.array(z.string()).optional()
});

export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const productFiltersSchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'DRAFT', 'OUT_OF_STOCK', 'ARCHIVED']).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

export type ProductFilters = z.infer<typeof productFiltersSchema>;

export const productDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  categoryId: z.string().uuid(),
  type: z.string(),
  deliveryType: z.string(),
  price: z.string(),
  currency: z.string(),
  costPrice: z.string().nullable(),
  markup: z.string().nullable(),
  minimumQuantity: z.number().int(),
  maximumQuantity: z.number().int().nullable(),
  hideWhenOutOfStock: z.boolean(),
  status: z.string(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  isPopular: z.boolean(),
  sortOrder: z.number().int(),
  instructions: z.string().nullable(),
  keywords: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  category: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string()
  }).nullable(),
  stockCount: z.object({
    available: z.number().int(),
    reserved: z.number().int(),
    sold: z.number().int(),
    disabled: z.number().int()
  })
});

export type ProductDetail = z.infer<typeof productDetailSchema>;

export const createCategoryRequestSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export const categoryFiltersSchema = z.object({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

export type CategoryFilters = z.infer<typeof categoryFiltersSchema>;

export const categoryDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  productCount: z.number().int()
});

export type CategoryDetail = z.infer<typeof categoryDetailSchema>;

export const orderFiltersSchema = z.object({
  search: z.string().optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'PENDING', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'FULFILLING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DELIVERY_FAILED', 'REFUNDED']).optional(),
  paymentStatus: z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED']).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

export type OrderFilters = z.infer<typeof orderFiltersSchema>;

export const orderDetailSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.number().int(),
  userId: z.string().uuid(),
  status: z.string(),
  currency: z.string(),
  subtotal: z.string(),
  discount: z.string(),
  total: z.string(),
  idempotencyKey: z.string().nullable(),
  expiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  user: z.object({
    id: z.string().uuid(),
    telegramId: z.string(),
    username: z.string().nullable(),
    firstName: z.string(),
    lastName: z.string().nullable()
  }),
  items: z.array(z.object({
    id: z.string().uuid(),
    productId: z.string().uuid().nullable(),
    variantId: z.string().uuid().nullable(),
    productNameSnapshot: z.string(),
    unitPriceSnapshot: z.string(),
    quantitySnapshot: z.number().int(),
    totalSnapshot: z.string(),
    currencySnapshot: z.string(),
    deliveryTypeSnapshot: z.string(),
    providerServiceIdSnapshot: z.string().nullable(),
    target: z.string().nullable(),
    createdAt: z.string(),
    product: z.object({
      id: z.string().uuid(),
      name: z.string(),
      slug: z.string(),
      imageUrl: z.string().nullable()
    }).nullable()
  })),
  payments: z.array(z.object({
    id: z.string().uuid(),
    provider: z.string(),
    status: z.string(),
    amount: z.string(),
    currency: z.string(),
    reference: z.string(),
    paidAt: z.string().nullable(),
    createdAt: z.string()
  }))
});

export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const dashboardStatsSchema = z.object({
  products: z.object({
    total: z.number().int(),
    active: z.number().int(),
    inactive: z.number().int(),
    draft: z.number().int(),
    outOfStock: z.number().int(),
    archived: z.number().int(),
    byStatus: z.record(z.number().int())
  }),
  orders: z.object({
    total: z.number().int(),
    pending: z.number().int(),
    paid: z.number().int(),
    completed: z.number().int(),
    cancelled: z.number().int(),
    expired: z.number().int(),
    totalRevenue: z.string(),
    recentOrders: z.array(z.object({
      id: z.string().uuid(),
      orderNumber: z.number().int(),
      total: z.string(),
      currency: z.string(),
      status: z.string(),
      createdAt: z.string(),
      user: z.object({
        firstName: z.string(),
        lastName: z.string().nullable(),
        username: z.string().nullable()
      })
    }))
  }),
  stock: z.object({
    total: z.number().int(),
    available: z.number().int(),
    reserved: z.number().int(),
    sold: z.number().int(),
    disabled: z.number().int(),
    lowStockProducts: z.array(z.object({
      productId: z.string().uuid(),
      productName: z.string(),
      available: z.number().int(),
      minimumQuantity: z.number().int()
    }))
  }),
  payments: z.object({
    total: z.number().int(),
    pending: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    expired: z.number().int(),
    totalAmount: z.string(),
    byProvider: z.record(z.number().int())
  }),
  categories: z.object({
    total: z.number().int(),
    active: z.number().int(),
    archived: z.number().int()
  }),
  users: z.object({
    total: z.number().int(),
    active: z.number().int(),
    withOrders: z.number().int()
  })
});

export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const auditLogFiltersSchema = z.object({
  adminId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  action: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional()
});

export type AuditLogFilters = z.infer<typeof auditLogFiltersSchema>;

export const auditLogEntrySchema = z.object({
  id: z.string().uuid(),
  adminId: z.string().uuid().nullable(),
  admin: z.object({
    username: z.string().nullable(),
    firstName: z.string(),
    lastName: z.string().nullable()
  }).nullable(),
  entityType: z.string(),
  entityId: z.string().uuid().nullable(),
  action: z.string(),
  oldValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string()
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const smmOrderStatusSchema = z.enum(['PENDING', 'PROCESSING', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'CANCELLED', 'FAILED', 'REFUNDED']);
export type SmmOrderStatus = z.infer<typeof smmOrderStatusSchema>;

export const smmServiceStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type SmmServiceStatus = z.infer<typeof smmServiceStatusSchema>;

export const smmProviderStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type SmmProviderStatus = z.infer<typeof smmProviderStatusSchema>;

export const smmServiceSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  providerServiceId: z.string(),
  name: z.string(),
  providerCost: z.string().nullable(),
  minimumQuantity: z.number().int(),
  maximumQuantity: z.number().int(),
  status: smmServiceStatusSchema,
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type SmmService = z.infer<typeof smmServiceSchema>;

export const smmProviderSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  apiUrl: z.string(),
  encryptedApiKey: z.string(),
  status: smmProviderStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

export type SmmProvider = z.infer<typeof smmProviderSchema>;

export const smmOrderSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  smmServiceId: z.string().uuid(),
  providerId: z.string().uuid(),
  providerOrderId: z.string().nullable(),
  target: z.string(),
  quantity: z.number().int(),
  status: smmOrderStatusSchema,
  lastProviderStatus: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type SmmOrder = z.infer<typeof smmOrderSchema>;

export const getServicesRequestSchema = z.object({
  category: z.string().optional()
});

export type GetServicesRequest = z.infer<typeof getServicesRequestSchema>;

export const getServicesResponseSchema = z.object({
  success: z.boolean(),
  provider: z.string().optional(),
  services: z.array(z.object({
    id: z.string().uuid(),
    providerServiceId: z.string(),
    name: z.string(),
    category: z.string(),
    description: z.string().nullable(),
    rate: z.string(),
    minQuantity: z.number().int(),
    maxQuantity: z.number().int(),
    metadata: z.unknown().nullable()
  })).optional(),
  error: z.string().optional()
});

export type GetServicesResponse = z.infer<typeof getServicesResponseSchema>;

export const getServiceRequestSchema = z.object({
  providerServiceId: z.string()
});

export type GetServiceRequest = z.infer<typeof getServiceRequestSchema>;

export const getServiceResponseSchema = z.object({
  success: z.boolean(),
  provider: z.string().optional(),
  service: z.object({
    id: z.string().uuid(),
    providerServiceId: z.string(),
    name: z.string(),
    category: z.string(),
    description: z.string().nullable(),
    rate: z.string(),
    minQuantity: z.number().int(),
    maxQuantity: z.number().int(),
    metadata: z.unknown().nullable()
  }).optional(),
  error: z.string().optional()
});

export type GetServiceResponse = z.infer<typeof getServiceResponseSchema>;

export const createSmmOrderRequestSchema = z.object({
  orderId: z.string().uuid(),
  serviceId: z.string(),
  target: z.string(),
  quantity: z.number().int().min(1),
  reference: z.string().optional(),
  idempotencyKey: z.string().optional()
});

export type CreateSmmOrderRequest = z.infer<typeof createSmmOrderRequestSchema>;

export const createSmmOrderResponseSchema = z.object({
  success: z.boolean(),
  order: z.object({
    id: z.string().uuid(),
    reference: z.string(),
    providerOrderId: z.string().nullable()
  }).optional(),
  error: z.string().optional()
});

export type CreateSmmOrderResponse = z.infer<typeof createSmmOrderResponseSchema>;

export const smmOrderStatusRequestSchema = z.object({
  providerOrderId: z.string().optional(),
  reference: z.string().optional(),
  idempotencyKey: z.string().optional()
});

export type SmmOrderStatusRequest = z.infer<typeof smmOrderStatusRequestSchema>;

export const smmOrderStatusResponseSchema = z.object({
  success: z.boolean(),
  order: z.object({
    id: z.string().uuid(),
    reference: z.string(),
    providerOrderId: z.string().nullable(),
    status: smmOrderStatusSchema,
    amount: z.string(),
    currency: z.string(),
    target: z.string(),
    quantity: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().nullable()
  }).optional(),
  error: z.string().optional()
});

export type SmmOrderStatusResponse = z.infer<typeof smmOrderStatusResponseSchema>;

// ---------- Admin: Users ----------

export const userStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userFiltersSchema = z.object({
  search: z.string().optional(),
  status: userStatusSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional()
});

export type UserFilters = z.infer<typeof userFiltersSchema>;

export const userSchema = z.object({
  id: z.string().uuid(),
  telegramId: z.string(),
  username: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  languageCode: z.string().nullable(),
  status: userStatusSchema,
  accountStatus: z.enum(['NEW', 'EXISTING']),
  totalItemsPurchased: z.number().int(),
  totalOrders: z.number().int(),
  totalDeposited: z.string(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type User = z.infer<typeof userSchema>;

export const usersResponseSchema = z.object({
  users: z.array(userSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int()
});

export type UsersResponse = z.infer<typeof usersResponseSchema>;

export const userActivitySchema = z.object({
  recentOrders: z.array(z.object({
    id: z.string().uuid(),
    orderNumber: z.number().int(),
    status: z.string(),
    total: z.string(),
    currency: z.string(),
    createdAt: z.string()
  })),
  recentDeposits: z.array(z.object({
    id: z.string().uuid(),
    type: z.string(),
    status: z.string(),
    amount: z.string(),
    currency: z.string(),
    reference: z.string(),
    createdAt: z.string()
  })),
  recentTickets: z.array(z.object({
    id: z.string().uuid(),
    number: z.number().int(),
    subject: z.string(),
    status: z.string(),
    createdAt: z.string()
  }))
});

export const userDetailSchema = userSchema.extend({
  wallet: z.object({
    id: z.string().uuid(),
    currency: z.string(),
    balance: z.string()
  }).nullable(),
  orderCount: z.number().int(),
  paymentCount: z.number().int(),
  ticketCount: z.number().int(),
  activity: userActivitySchema
});

export type UserDetail = z.infer<typeof userDetailSchema>;

export const setUserStatusRequestSchema = z.object({
  status: userStatusSchema,
  reason: z.string().min(1).max(500).optional()
});

export type SetUserStatusRequest = z.infer<typeof setUserStatusRequestSchema>;

// ---------- Admin: Wallet ----------

export const walletSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  currency: z.string(),
  balance: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  user: z.object({
    id: z.string().uuid(),
    telegramId: z.string(),
    username: z.string().nullable(),
    firstName: z.string(),
    lastName: z.string().nullable()
  }).nullable()
});

export type Wallet = z.infer<typeof walletSchema>;

export const walletsResponseSchema = z.object({
  wallets: z.array(walletSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int()
});

export type WalletsResponse = z.infer<typeof walletsResponseSchema>;

export const walletTransactionSchema = z.object({
  id: z.string().uuid(),
  walletId: z.string().uuid(),
  paymentId: z.string().uuid().nullable(),
  type: z.enum(['DEPOSIT', 'PURCHASE', 'REFUND', 'ADJUSTMENT', 'BONUS']),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REVERSED']),
  amount: z.string(),
  currency: z.string(),
  balanceBefore: z.string(),
  balanceAfter: z.string(),
  reference: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string()
});

export type WalletTransaction = z.infer<typeof walletTransactionSchema>;

export const walletDetailSchema = z.object({
  wallet: z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    currency: z.string(),
    balance: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    user: z.object({
      id: z.string().uuid(),
      telegramId: z.string(),
      username: z.string().nullable(),
      firstName: z.string(),
      lastName: z.string().nullable()
    })
  }),
  transactions: z.array(walletTransactionSchema),
  totalTransactions: z.number().int()
});

export type WalletDetail = z.infer<typeof walletDetailSchema>;

export const walletAdjustmentTypeSchema = z.enum(['ADJUSTMENT', 'BONUS']);
export type WalletAdjustmentType = z.infer<typeof walletAdjustmentTypeSchema>;

export const createWalletAdjustmentRequestSchema = z.object({
  userId: z.string().uuid(),
  type: walletAdjustmentTypeSchema,
  amount: z.union([z.string(), z.number()]),
  reason: z.string().min(1).max(500)
});

export type CreateWalletAdjustmentRequest = z.infer<typeof createWalletAdjustmentRequestSchema>;

// ---------- Admin: Support Tickets ----------

export const supportTicketStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

export const ticketFiltersSchema = z.object({
  search: z.string().optional(),
  status: supportTicketStatusSchema.optional(),
  userId: z.string().uuid().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional()
});

export type TicketFilters = z.infer<typeof ticketFiltersSchema>;

export const ticketSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  userId: z.string().uuid(),
  orderId: z.string().uuid().nullable(),
  subject: z.string(),
  status: supportTicketStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  user: z.object({
    id: z.string().uuid(),
    telegramId: z.string(),
    username: z.string().nullable(),
    displayName: z.string().nullable(),
    usernameHandle: z.string().nullable(),
    firstName: z.string(),
    lastName: z.string().nullable()
  }).nullable(),
  order: z.object({
    id: z.string().uuid(),
    orderNumber: z.number().int()
  }).nullable(),
  messageCount: z.number().int(),
  unreadCount: z.number().int().optional()
});

export type Ticket = z.infer<typeof ticketSchema>;

export const ticketsResponseSchema = z.object({
  tickets: z.array(ticketSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int()
});

export type TicketsResponse = z.infer<typeof ticketsResponseSchema>;

export const supportMessageSchema = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  adminId: z.string().uuid().nullable(),
  sender: z.enum(['USER', 'ADMIN', 'SYSTEM']).default('USER'),
  body: z.string(),
  createdAt: z.string(),
  fromAdmin: z.boolean(),
  adminName: z.string().nullable().optional()
});

export type SupportMessage = z.infer<typeof supportMessageSchema>;

export const ticketDetailSchema = ticketSchema.extend({
  messages: z.array(supportMessageSchema)
});

export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const createTicketMessageRequestSchema = z.object({
  body: z.string().min(1).max(4000)
});

export type CreateTicketMessageRequest = z.infer<typeof createTicketMessageRequestSchema>;

export const ticketUnreadCountResponseSchema = z.object({
  unreadCount: z.number().int().min(0)
});

export type TicketUnreadCountResponse = z.infer<typeof ticketUnreadCountResponseSchema>;

export const updateTicketStatusRequestSchema = z.object({
  status: supportTicketStatusSchema
});

export type UpdateTicketStatusRequest = z.infer<typeof updateTicketStatusRequestSchema>;

// ---------- Admin: Settings ----------

export const applicationSettingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  description: z.string().nullable(),
  isSecret: z.literal(false).optional(),
  updatedAt: z.string()
});

export type ApplicationSetting = z.infer<typeof applicationSettingSchema>;

export const settingsResponseSchema = z.object({
  settings: z.array(applicationSettingSchema)
});

export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

export const updateSettingRequestSchema = z.object({
  value: z.unknown()
});

export type UpdateSettingRequest = z.infer<typeof updateSettingRequestSchema>;

export const notificationChannelSchema = z.enum(['TELEGRAM_GROUP', 'TELEGRAM_USER']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationTargetSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string(),
  name: z.string(),
  channel: notificationChannelSchema,
  eventTypes: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

export const notificationTargetsResponseSchema = z.object({
  targets: z.array(notificationTargetSchema)
});

export type NotificationTargetsResponse = z.infer<typeof notificationTargetsResponseSchema>;

export const createNotificationTargetRequestSchema = z.object({
  chatId: z.union([z.string(), z.number()]),
  name: z.string().min(1).max(255),
  channel: notificationChannelSchema.optional(),
  eventTypes: z.array(z.string()).optional(),
  isActive: z.boolean().optional()
});

export type CreateNotificationTargetRequest = z.infer<typeof createNotificationTargetRequestSchema>;

export const updateNotificationTargetRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  channel: notificationChannelSchema.optional(),
  eventTypes: z.array(z.string()).optional(),
  isActive: z.boolean().optional()
});

export type UpdateNotificationTargetRequest = z.infer<typeof updateNotificationTargetRequestSchema>;

// ---------- Admin: Payments ----------

export const adminPaymentFiltersSchema = z.object({
  provider: paymentProviderSchema.optional(),
  status: paymentStatusSchema.optional(),
  search: z.string().optional(),
  userId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional()
});

export type AdminPaymentFilters = z.infer<typeof adminPaymentFiltersSchema>;

export const adminPaymentSchema = paymentSchema.extend({
  order: z.object({
    id: z.string().uuid(),
    orderNumber: z.number().int()
  }).nullable(),
  user: z.object({
    id: z.string().uuid(),
    telegramId: z.string(),
    username: z.string().nullable(),
    firstName: z.string(),
    lastName: z.string().nullable()
  }).nullable()
});

export type AdminPayment = z.infer<typeof adminPaymentSchema>;

export const adminPaymentsResponseSchema = z.object({
  payments: z.array(adminPaymentSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int()
});

export type AdminPaymentsResponse = z.infer<typeof adminPaymentsResponseSchema>;

export const adminPaymentDetailSchema = adminPaymentSchema.extend({
  events: z.array(z.object({
    id: z.string().uuid(),
    providerEventId: z.string().nullable(),
    eventType: z.string(),
    processedAt: z.string().nullable(),
    createdAt: z.string()
  }))
});

export type AdminPaymentDetail = z.infer<typeof adminPaymentDetailSchema>;

// ---------- Admin: SMM providers and services ----------

export const adminSmmProviderSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  apiUrl: z.string(),
  status: smmProviderStatusSchema,
  serviceCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type AdminSmmProvider = z.infer<typeof adminSmmProviderSchema>;

export const adminSmmServiceSchema = smmServiceSchema.extend({
  provider: z.object({
    id: z.string().uuid(),
    name: z.string(),
    status: smmProviderStatusSchema
  }),
  product: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string()
  }).nullable()
});

export type AdminSmmService = z.infer<typeof adminSmmServiceSchema>;

export const createSmmProviderRequestSchema = z.object({
  name: z.string().min(1).max(255),
  apiUrl: z.string().min(1).max(500),
  apiKey: z.string().min(1).max(2000),
  status: smmProviderStatusSchema.optional()
});

export type CreateSmmProviderRequest = z.infer<typeof createSmmProviderRequestSchema>;

export const updateSmmProviderRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  apiUrl: z.string().min(1).max(500).optional(),
  apiKey: z.string().min(1).max(2000).optional(),
  status: smmProviderStatusSchema.optional()
});

export type UpdateSmmProviderRequest = z.infer<typeof updateSmmProviderRequestSchema>;

export const createSmmServiceRequestSchema = z.object({
  providerId: z.string().uuid(),
  productId: z.string().uuid().nullable().optional(),
  providerServiceId: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  providerCost: z.union([z.string(), z.number()]).nullable().optional(),
  minimumQuantity: z.number().int().min(1),
  maximumQuantity: z.number().int().min(1),
  status: smmServiceStatusSchema.optional(),
  metadata: z.unknown().optional()
});

export type CreateSmmServiceRequest = z.infer<typeof createSmmServiceRequestSchema>;

export const updateSmmServiceRequestSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  providerServiceId: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255).optional(),
  providerCost: z.union([z.string(), z.number()]).nullable().optional(),
  minimumQuantity: z.number().int().min(1).optional(),
  maximumQuantity: z.number().int().min(1).optional(),
  status: smmServiceStatusSchema.optional(),
  metadata: z.unknown().optional()
});

export type UpdateSmmServiceRequest = z.infer<typeof updateSmmServiceRequestSchema>;

// ---------- Admin: Analytics ----------

export const analyticsSchema = z.object({
  dailySeries: z.array(z.object({
    date: z.string(),
    orders: z.number().int(),
    revenue: z.string()
  })),
  topProducts: z.array(z.object({
    productId: z.string().uuid().nullable(),
    productName: z.string(),
    orderCount: z.number().int(),
    quantitySold: z.number().int(),
    revenue: z.string()
  })),
  paymentPerformance: z.object({
    total: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    successRate: z.string()
  }),
  fulfillmentFailures: z.object({
    count: z.number().int(),
    recent: z.array(z.object({
      id: z.string().uuid(),
      orderItemId: z.string().uuid(),
      status: z.string(),
      failureReason: z.string().nullable(),
      attemptCount: z.number().int(),
      updatedAt: z.string()
    }))
  }),
  smmPerformance: z.object({
    total: z.number().int(),
    completed: z.number().int(),
    inProgress: z.number().int(),
    failed: z.number().int()
  })
});

export type Analytics = z.infer<typeof analyticsSchema>;

// ---------- Admin: Bulk product actions and duplication ----------

export const bulkProductActionSchema = z.enum(['ACTIVATE', 'DEACTIVATE', 'ARCHIVE', 'CHANGE_CATEGORY']);
export type BulkProductAction = z.infer<typeof bulkProductActionSchema>;

export const bulkProductActionRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: bulkProductActionSchema,
  categoryId: z.string().uuid().optional()
});

export type BulkProductActionRequest = z.infer<typeof bulkProductActionRequestSchema>;

export const bulkProductActionResponseSchema = z.object({
  success: z.boolean(),
  updatedCount: z.number().int()
});

export type BulkProductActionResponse = z.infer<typeof bulkProductActionResponseSchema>;
