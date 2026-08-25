import type { PrismaClient } from '@prisma/client';
import { OrderStatus } from '@prisma/client';

export interface DashboardStats {
  products: {
    total: number;
    active: number;
    inactive: number;
    draft: number;
    outOfStock: number;
    archived: number;
    byStatus: Record<string, number>;
  };
  orders: {
    total: number;
    pending: number;
    paid: number;
    completed: number;
    cancelled: number;
    expired: number;
    totalRevenue: string;
    recentOrders: Array<{
      id: string;
      orderNumber: number;
      total: string;
      currency: string;
      status: string;
      createdAt: Date;
      user: { firstName: string; lastName: string | null; username: string | null };
    }>;
  };
  stock: {
    total: number;
    available: number;
    reserved: number;
    sold: number;
    disabled: number;
    lowStockProducts: Array<{
      productId: string;
      productName: string;
      available: number;
      minimumQuantity: number;
    }>;
  };
  payments: {
    total: number;
    pending: number;
    succeeded: number;
    failed: number;
    expired: number;
    totalAmount: string;
    byProvider: Record<string, number>;
  };
  categories: {
    total: number;
    active: number;
    archived: number;
  };
  users: {
    total: number;
    active: number;
    withOrders: number;
  };
}

export class DashboardService {
  constructor(private prisma: PrismaClient) {}

  async getDashboardStats(): Promise<DashboardStats> {
    const [
      // Consolidated counts using raw SQL for better performance
      productCounts,
      orderCounts,
      stockCounts,
      paymentCounts,
      categoryCounts,
      userCounts,
      revenueResult,
      paymentAmountResult,
      recentOrders,
      lowStockProductsList
    ] = await Promise.all([
      // Product counts in a single query
      this.prisma.$queryRaw<{
        total: bigint;
        active: bigint;
        inactive: bigint;
        draft: bigint;
        outOfStock: bigint;
        archived: bigint;
      }[]>`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE "isActive" = true AND "status" = 'ACTIVE') AS active,
          COUNT(*) FILTER (WHERE "isActive" = false) AS inactive,
          COUNT(*) FILTER (WHERE "status" = 'DRAFT') AS draft,
          COUNT(*) FILTER (WHERE "status" = 'OUT_OF_STOCK') AS "outOfStock",
          COUNT(*) FILTER (WHERE "status" = 'ARCHIVED') AS archived
        FROM "Product"
      `,

      // Order counts in a single query
      this.prisma.$queryRaw<{
        total: bigint;
        pending: bigint;
        paid: bigint;
        completed: bigint;
        cancelled: bigint;
        expired: bigint;
      }[]>`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE "status" = 'PAYMENT_PENDING') AS pending,
          COUNT(*) FILTER (WHERE "status" = 'PAID') AS paid,
          COUNT(*) FILTER (WHERE "status" = 'COMPLETED') AS completed,
          COUNT(*) FILTER (WHERE "status" = 'CANCELLED') AS cancelled,
          COUNT(*) FILTER (WHERE "status" = 'EXPIRED') AS expired
        FROM "Order"
      `,

      // Stock counts in a single query
      this.prisma.$queryRaw<{
        total: bigint;
        available: bigint;
        reserved: bigint;
        sold: bigint;
        disabled: bigint;
      }[]>`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE "status" = 'AVAILABLE') AS available,
          COUNT(*) FILTER (WHERE "status" = 'RESERVED') AS reserved,
          COUNT(*) FILTER (WHERE "status" = 'SOLD') AS sold,
          COUNT(*) FILTER (WHERE "status" = 'DISABLED') AS disabled
        FROM "ProductStock"
      `,

      // Payment counts in a single query
      this.prisma.$queryRaw<{
        total: bigint;
        pending: bigint;
        succeeded: bigint;
        failed: bigint;
        expired: bigint;
      }[]>`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE "status" = 'PENDING') AS pending,
          COUNT(*) FILTER (WHERE "status" = 'SUCCEEDED') AS succeeded,
          COUNT(*) FILTER (WHERE "status" = 'FAILED') AS failed,
          COUNT(*) FILTER (WHERE "status" = 'EXPIRED') AS expired
        FROM "Payment"
      `,

      // Category counts in a single query
      this.prisma.$queryRaw<{
        total: bigint;
        active: bigint;
        archived: bigint;
      }[]>`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE "isActive" = true AND "isArchived" = false) AS active,
          COUNT(*) FILTER (WHERE "isArchived" = true) AS archived
        FROM "Category"
      `,

      // User counts in a single query
      this.prisma.$queryRaw<{
        total: bigint;
        active: bigint;
        withOrders: bigint;
      }[]>`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE u."status" = 'ACTIVE') AS active,
          COUNT(DISTINCT u."id") AS "withOrders"
        FROM "User" u
        INNER JOIN "Order" o ON o."userId" = u."id"
      `,

      // Revenue aggregate
      this.prisma.order.aggregate({
        where: { status: { in: [OrderStatus.PAID, OrderStatus.COMPLETED] } },
        _sum: { total: true }
      }),

      // Payment amount aggregate
      this.prisma.payment.aggregate({
        where: { status: 'SUCCEEDED' },
        _sum: { amount: true }
      }),

      // Recent orders (still needs individual rows for display)
      this.prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { firstName: true, lastName: true, username: true } }
        }
      }),

      // Low stock products
      this.prisma.product.findMany({
        where: {
          hideWhenOutOfStock: false,
          isActive: true,
          status: 'ACTIVE',
          minimumQuantity: { gt: 0 }
        },
        include: {
          stock: { where: { status: 'AVAILABLE' } }
        },
        take: 10
      })
    ]);

    const pc = productCounts[0] ?? { total: 0n, active: 0n, inactive: 0n, draft: 0n, outOfStock: 0n, archived: 0n };
    const oc = orderCounts[0] ?? { total: 0n, pending: 0n, paid: 0n, completed: 0n, cancelled: 0n, expired: 0n };
    const sc = stockCounts[0] ?? { total: 0n, available: 0n, reserved: 0n, sold: 0n, disabled: 0n };
    const pyC = paymentCounts[0] ?? { total: 0n, pending: 0n, succeeded: 0n, failed: 0n, expired: 0n };
    const cc = categoryCounts[0] ?? { total: 0n, active: 0n, archived: 0n };
    const uc = userCounts[0] ?? { total: 0n, active: 0n, withOrders: 0n };

    const lowStockList = lowStockProductsList
      .map(p => ({
        productId: p.id,
        productName: p.name,
        available: p.stock.length,
        minimumQuantity: p.minimumQuantity
      }))
      .filter(p => p.available <= p.minimumQuantity)
      .slice(0, 10);

    return {
      products: {
        total: Number(pc.total),
        active: Number(pc.active),
        inactive: Number(pc.inactive),
        draft: Number(pc.draft),
        outOfStock: Number(pc.outOfStock),
        archived: Number(pc.archived),
        byStatus: {}
      },
      orders: {
        total: Number(oc.total),
        pending: Number(oc.pending),
        paid: Number(oc.paid),
        completed: Number(oc.completed),
        cancelled: Number(oc.cancelled),
        expired: Number(oc.expired),
        totalRevenue: revenueResult._sum.total?.toString() || '0',
        recentOrders: recentOrders.map(o => ({
          id: o.id,
          orderNumber: o.orderNumber,
          total: o.total.toString(),
          currency: o.currency,
          status: o.status,
          createdAt: o.createdAt,
          user: { firstName: o.user.firstName, lastName: o.user.lastName, username: o.user.username }
        }))
      },
      stock: {
        total: Number(sc.total),
        available: Number(sc.available),
        reserved: Number(sc.reserved),
        sold: Number(sc.sold),
        disabled: Number(sc.disabled),
        lowStockProducts: lowStockList
      },
      payments: {
        total: Number(pyC.total),
        pending: Number(pyC.pending),
        succeeded: Number(pyC.succeeded),
        failed: Number(pyC.failed),
        expired: Number(pyC.expired),
        totalAmount: paymentAmountResult._sum.amount?.toString() || '0',
        byProvider: {}
      },
      categories: {
        total: Number(cc.total),
        active: Number(cc.active),
        archived: Number(cc.archived)
      },
      users: {
        total: Number(uc.total),
        active: Number(uc.active),
        withOrders: Number(uc.withOrders)
      }
    };
  }

  async getRecentActivity(limit: number = 20) {
    const [recentOrders, recentPayments, recentProducts] = await Promise.all([
      this.prisma.order.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { firstName: true, lastName: true, username: true } } }
      }),
      this.prisma.payment.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { order: { select: { orderNumber: true } } }
      }),
      this.prisma.product.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    return {
      orders: recentOrders.map(o => {
        return {
          id: o.id,
          type: 'order',
          orderNumber: o.orderNumber,
          status: o.status,
          amount: o.total.toString(),
          currency: o.currency,
          user: o.user,
          createdAt: o.createdAt
        };
      }),
      payments: recentPayments.map(p => {
        return {
          id: p.id,
          type: 'payment',
          reference: p.reference,
          status: p.status,
          amount: p.amount.toString(),
          currency: p.currency,
          provider: p.provider,
          orderNumber: p.order?.orderNumber,
          createdAt: p.createdAt
        };
      }),
      products: recentProducts.map(p => {
        return {
          id: p.id,
          type: 'product',
          name: p.name,
          status: p.status,
          price: p.price.toString(),
          currency: p.currency,
          createdAt: p.createdAt
        };
      })
    };
  }

  async getAnalytics() {
    const days = 14;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const [topProducts, paymentTotals, fulfillmentFailures, smmPerformance, confirmedOrders] = await Promise.all([
      this.prisma.orderItem.groupBy({
        by: ['productId', 'productNameSnapshot'],
        where: { order: { status: { in: ['PAID', 'PROCESSING', 'FULFILLING', 'COMPLETED'] } } },
        _count: { productId: true },
        _sum: { quantitySnapshot: true, totalSnapshot: true },
        orderBy: { _sum: { totalSnapshot: 'desc' } },
        take: 10
      }),
      this.prisma.payment.groupBy({
        by: ['status'],
        _count: { status: true }
      }),
      this.prisma.fulfillmentRecord.findMany({
        where: { status: { in: ['FAILED', 'RETRYING'] } },
        orderBy: { updatedAt: 'desc' },
        take: 10
      }),
      this.prisma.smmOrder.groupBy({
        by: ['status'],
        _count: { status: true }
      }),
      this.prisma.order.findMany({
        where: {
          status: { in: ['PAID', 'PROCESSING', 'FULFILLING', 'COMPLETED'] },
          createdAt: { gte: start }
        },
        select: { total: true, createdAt: true }
      })
    ]);

    const dailyMap = new Map<string, { orders: number; revenue: number }>();
    for (let i = 0; i < days; i += 1) {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() + i);
      dailyMap.set(day.toISOString().slice(0, 10), { orders: 0, revenue: 0 });
    }
    for (const order of confirmedOrders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      const entry = dailyMap.get(key);
      if (entry) {
        entry.orders += 1;
        entry.revenue += Number(order.total);
      }
    }
    const dailySeries = Array.from(dailyMap.entries()).map(([date, entry]) => ({
      date,
      orders: entry.orders,
      revenue: entry.revenue.toFixed(2)
    }));

    const paymentCounts = paymentTotals.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {} as Record<string, number>);

    const paymentTotal = paymentTotals.reduce((sum, item) => sum + item._count.status, 0);
    const succeeded = paymentCounts.SUCCEEDED || 0;
    const failed = (paymentCounts.FAILED || 0) + (paymentCounts.EXPIRED || 0) + (paymentCounts.CANCELLED || 0);
    const successRate = paymentTotal > 0 ? ((succeeded / paymentTotal) * 100).toFixed(1) : '0.0';

    const smmCounts = smmPerformance.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {} as Record<string, number>);

    return {
      dailySeries,
      topProducts: topProducts.map(item => ({
        productId: item.productId,
        productName: item.productNameSnapshot,
        orderCount: item._count.productId,
        quantitySold: item._sum.quantitySnapshot ?? 0,
        revenue: item._sum.totalSnapshot?.toString() ?? '0'
      })),
      paymentPerformance: {
        total: paymentTotal,
        succeeded,
        failed,
        successRate
      },
      fulfillmentFailures: {
        count: fulfillmentFailures.length,
        recent: fulfillmentFailures.map(f => ({
          id: f.id,
          orderItemId: f.orderItemId,
          status: f.status,
          failureReason: f.failureReason,
          attemptCount: f.attemptCount,
          updatedAt: f.updatedAt
        }))
      },
      smmPerformance: {
        total: smmPerformance.reduce((sum, item) => sum + item._count.status, 0),
        completed: smmCounts.COMPLETED || 0,
        inProgress: (smmCounts.PENDING || 0) + (smmCounts.PROCESSING || 0) + (smmCounts.IN_PROGRESS || 0),
        failed: (smmCounts.FAILED || 0) + (smmCounts.CANCELLED || 0) + (smmCounts.REFUNDED || 0)
      }
    };
  }
}