import type { PrismaClient } from '@prisma/client';
import { OrderStatus, PaymentStatus } from '@prisma/client';

export interface OrderFilters {
  search?: string;
  userId?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface OrderWithDetails {
  id: string;
  orderNumber: number;
  userId: string;
  status: string;
  currency: string;
  subtotal: string;
  discount: string;
  total: string;
  idempotencyKey: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    telegramId: string;
    username: string | null;
    firstName: string;
    lastName: string | null;
  };
  items: Array<{
    id: string;
    productId: string | null;
    variantId: string | null;
    productNameSnapshot: string;
    unitPriceSnapshot: string;
    quantitySnapshot: number;
    totalSnapshot: string;
    currencySnapshot: string;
    deliveryTypeSnapshot: string;
    providerServiceIdSnapshot: string | null;
    target: string | null;
    createdAt: Date;
    product: {
      id: string;
      name: string;
      slug: string;
      imageUrl: string | null;
    } | null;
  }>;
  payments: Array<{
    id: string;
    provider: string;
    status: string;
    amount: string;
    currency: string;
    reference: string;
    paidAt: Date | null;
    createdAt: Date;
  }>;
}

export interface OrderStats {
  total: number;
  pending: number;
  paid: number;
  completed: number;
  cancelled: number;
  expired: number;
  totalRevenue: string;
}

export class OrderService {
  constructor(private prisma: PrismaClient) {}

  private static readonly SORTABLE_COLUMNS = new Set([
    'createdAt',
    'updatedAt',
    'orderNumber',
    'status',
    'total',
    'paidAt'
  ]);

  private static readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async getOrders(filters: OrderFilters = {}) {
    const {
      search,
      userId,
      status,
      paymentStatus,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = filters;

    const pageNum = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
    const pageSizeNum =
      Number.isFinite(pageSize) && pageSize >= 1 ? Math.min(100, Math.floor(pageSize)) : 20;
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (search) {
      const or: Record<string, unknown>[] = [
        { orderNumber: { equals: parseInt(search, 10) || 0 } }
      ];
      if (OrderService.UUID_PATTERN.test(search)) {
        or.push({ id: { equals: search } });
      }
      where.OR = or;
    }

    if (userId) {
      where.userId = userId;
    }

    if (status) {
      where.status = status;
    }

    if (paymentStatus && Object.values(PaymentStatus).includes(paymentStatus)) {
      where.payments = { some: { status: paymentStatus } };
    }

    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = dateFrom;
      if (dateTo) createdAt.lte = dateTo;
      where.createdAt = createdAt;
    }

    const safeSortBy = OrderService.SORTABLE_COLUMNS.has(sortBy) ? sortBy : 'createdAt';
    const safeSortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: pageSizeNum,
        orderBy: { [safeSortBy]: safeSortOrder },
        include: {
          user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, slug: true, imageUrl: true, price: true } }
            }
          },
          payments: {
            select: { id: true, provider: true, status: true, amount: true, currency: true, reference: true, paidAt: true, createdAt: true }
          }
        }
      }),
      this.prisma.order.count({ where })
    ]);

    const ordersWithDetails = orders.map(order => {
      return {
        ...order,
        subtotal: order.subtotal.toString(),
        discount: order.discount.toString(),
        total: order.total.toString(),
        user: {
          id: order.user.id,
          telegramId: order.user.telegramId.toString(),
          username: order.user.username,
          firstName: order.user.firstName,
          lastName: order.user.lastName
        },
        items: order.items.map(item => {
          return {
            ...item,
            unitPriceSnapshot: item.unitPriceSnapshot.toString(),
            totalSnapshot: item.totalSnapshot.toString(),
            product: item.product ? { ...item.product, price: item.product.price?.toString() } : null
          };
        }),
        payments: order.payments.map(p => {
          return {
            ...p,
            amount: p.amount.toString()
          };
        })
      };
    });

    return {
      orders: ordersWithDetails,
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async getOrderById(id: string): Promise<OrderWithDetails | null> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, slug: true, imageUrl: true, price: true } }
          }
        },
        payments: {
          select: { id: true, provider: true, status: true, amount: true, currency: true, reference: true, paidAt: true, createdAt: true }
        }
      }
    });

    if (!order) return null;

    return {
      ...order,
      subtotal: order.subtotal.toString(),
      discount: order.discount.toString(),
      total: order.total.toString(),
      user: {
        id: order.user.id,
        telegramId: order.user.telegramId.toString(),
        username: order.user.username,
        firstName: order.user.firstName,
        lastName: order.user.lastName
      },
      items: order.items.map(item => {
        return {
          ...item,
          unitPriceSnapshot: item.unitPriceSnapshot.toString(),
          totalSnapshot: item.totalSnapshot.toString(),
          product: item.product ? { ...item.product, price: item.product.price?.toString() } : null
        };
      }),
      payments: order.payments.map(p => {
        return {
          ...p,
          amount: p.amount.toString()
        };
      })
    };
  }

  async getOrderByNumber(orderNumber: number): Promise<OrderWithDetails | null> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, slug: true, imageUrl: true, price: true } }
          }
        },
        payments: {
          select: { id: true, provider: true, status: true, amount: true, currency: true, reference: true, paidAt: true, createdAt: true }
        }
      }
    });

    if (!order) return null;

    return {
      ...order,
      subtotal: order.subtotal.toString(),
      discount: order.discount.toString(),
      total: order.total.toString(),
      user: {
        id: order.user.id,
        telegramId: order.user.telegramId.toString(),
        username: order.user.username,
        firstName: order.user.firstName,
        lastName: order.user.lastName
      },
      items: order.items.map(item => {
        return {
          ...item,
          unitPriceSnapshot: item.unitPriceSnapshot.toString(),
          totalSnapshot: item.totalSnapshot.toString(),
          product: item.product ? { ...item.product, price: item.product.price?.toString() } : null
        };
      }),
      payments: order.payments.map(p => {
        return {
          ...p,
          amount: p.amount.toString()
        };
      })
    };
  }

  async getOrderStats(): Promise<OrderStats> {
    const [total, pending, paid, completed, cancelled, expired, revenueResult] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.PAYMENT_PENDING } }),
      this.prisma.order.count({ where: { status: OrderStatus.PAID } }),
      this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      this.prisma.order.count({ where: { status: OrderStatus.CANCELLED } }),
      this.prisma.order.count({ where: { status: OrderStatus.EXPIRED } }),
      this.prisma.order.aggregate({
        where: { status: { in: [OrderStatus.PAID, OrderStatus.COMPLETED] } },
        _sum: { total: true }
      })
    ]);

    return {
      total,
      pending,
      paid,
      completed,
      cancelled,
      expired,
      totalRevenue: revenueResult._sum.total?.toString() || '0'
    };
  }

  async cancelOrder(id: string, _adminId: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      throw new Error('Order already cancelled or refunded');
    }

    if (order.status === 'COMPLETED' || order.status === 'FULFILLING') {
      throw new Error('Cannot cancel fulfilled order');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date()
        }
      });

      // Release reserved stock
      const reservedStock = await tx.productStock.findMany({
        where: { orderId: id, status: 'RESERVED' }
      });

      if (reservedStock.length > 0) {
        await tx.productStock.updateMany({
          where: { orderId: id, status: 'RESERVED' },
          data: { status: 'AVAILABLE', orderId: null, reservedAt: null }
        });
      }

      // Update payments if pending
      await tx.payment.updateMany({
        where: { orderId: id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'CANCELLED' }
      });

      // Update order status
      await tx.order.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() }
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          adminId: _adminId,
          entityType: 'Order',
          entityId: id,
          action: 'CANCEL',
          oldValue: { status: 'PENDING' },
          newValue: { status: 'CANCELLED', reason: reason || 'Admin cancelled' }
        }
      });
    });
  }

  async refundOrder(id: string, _adminId: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { payments: true }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status !== 'PAID' && order.status !== 'COMPLETED') {
      throw new Error('Order not paid, cannot refund');
    }

    const paidPayment = order.payments.find(p => p.status === 'SUCCEEDED');
    if (!paidPayment) {
      throw new Error('No successful payment found for this order');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          status: 'REFUNDED',
          cancelledAt: new Date()
        }
      });

      // Release reserved stock
      const reservedStock = await tx.productStock.findMany({
        where: { orderId: id, status: { in: ['RESERVED', 'SOLD'] } }
      });

      if (reservedStock.length > 0) {
        await tx.productStock.updateMany({
          where: { orderId: id, status: { in: ['RESERVED', 'SOLD'] } },
          data: { status: 'AVAILABLE', orderId: null, reservedAt: null, soldAt: null }
        });
      }

      // Update payment
      await tx.payment.update({
        where: { id: paidPayment.id },
        data: { status: 'REFUNDED' }
      });

      // Create refund payment record
      await tx.payment.create({
        data: {
          orderId: order.id,
          userId: order.userId,
          provider: paidPayment.provider,
          status: 'REFUNDED',
          amount: paidPayment.amount,
          currency: paidPayment.currency,
          reference: `refund_${Date.now()}`,
          idempotencyKey: `refund_${Date.now()}`,
          metadata: { originalPaymentId: paidPayment.id, reason: reason || 'Admin refund' }
        }
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          adminId: _adminId,
          entityType: 'Order',
          entityId: id,
          action: 'REFUND',
          oldValue: { status: order.status },
          newValue: { status: 'REFUNDED', reason: reason || 'Admin refund' }
        }
      });
    });
  }

  async retryFailedPayment(paymentId: string, _adminId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true }
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.status !== 'FAILED' && payment.status !== 'EXPIRED') {
      throw new Error('Only failed or expired payments can be retried');
    }

    // Reset payment status to pending
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });

    return { success: true };
  }
}