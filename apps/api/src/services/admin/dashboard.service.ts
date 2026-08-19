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
      // Products
      totalProducts,
      activeProducts,
      inactiveProducts,
      draftProducts,
      outOfStockProducts,
      archivedProducts,
      productsByStatus,
      
      // Orders
      totalOrders,
      pendingOrders,
      paidOrders,
      completedOrders,
      cancelledOrders,
      expiredOrders,
      revenueResult,
      recentOrders,
      
      // Stock
      totalStock,
      availableStock,
      reservedStock,
      soldStock,
      disabledStock,
      
      // Payments
      totalPayments,
      pendingPayments,
      succeededPayments,
      failedPayments,
      expiredPayments,
      paymentsByProvider,
      paymentAmountResult,
      
      // Categories
      totalCategories,
      activeCategories,
      archivedCategories,
      
      // Users
      totalUsers,
      activeUsers,
      usersWithOrders
    ] = await Promise.all([
      // Products
      this.prisma.product.count(),
      this.prisma.product.count({ where: { isActive: true, status: 'ACTIVE' } }),
      this.prisma.product.count({ where: { isActive: false } }),
      this.prisma.product.count({ where: { status: 'DRAFT' } }),
      this.prisma.product.count({ where: { status: 'OUT_OF_STOCK' } }),
      this.prisma.product.count({ where: { status: 'ARCHIVED' } }),
      this.prisma.product.groupBy({ by: ['status'], _count: { status: true } }),
      
      // Orders
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.PAYMENT_PENDING } }),
      this.prisma.order.count({ where: { status: OrderStatus.PAID } }),
      this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      this.prisma.order.count({ where: { status: OrderStatus.CANCELLED } }),
      this.prisma.order.count({ where: { status: OrderStatus.EXPIRED } }),
      this.prisma.order.aggregate({
        where: { status: { in: [OrderStatus.PAID, OrderStatus.COMPLETED] } },
        _sum: { total: true }
      }),
      this.prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { firstName: true, lastName: true, username: true } }
        }
      }),
      
      // Stock
      this.prisma.productStock.count(),
      this.prisma.productStock.count({ where: { status: 'AVAILABLE' } }),
      this.prisma.productStock.count({ where: { status: 'RESERVED' } }),
      this.prisma.productStock.count({ where: { status: 'SOLD' } }),
      this.prisma.productStock.count({ where: { status: 'DISABLED' } }),
      
      // Payments
      this.prisma.payment.count(),
      this.prisma.payment.count({ where: { status: 'PENDING' } }),
      this.prisma.payment.count({ where: { status: 'SUCCEEDED' } }),
      this.prisma.payment.count({ where: { status: 'FAILED' } }),
      this.prisma.payment.count({ where: { status: 'EXPIRED' } }),
      this.prisma.payment.groupBy({ by: ['provider'], _count: { provider: true } }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCEEDED' },
        _sum: { amount: true }
      }),
      
      // Categories
      this.prisma.category.count(),
      this.prisma.category.count({ where: { isActive: true, isArchived: false } }),
      this.prisma.category.count({ where: { isArchived: true } }),
      
      // Users
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { orders: { some: {} } } })
    ]);

    // Low stock products
    const lowStockProductsList = await this.prisma.product.findMany({
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
    });

    const lowStockList = lowStockProductsList
      .map(p => {
        return {
          productId: p.id,
          productName: p.name,
          available: p.stock.length,
          minimumQuantity: p.minimumQuantity
        };
      })
      .filter(p => p.available <= p.minimumQuantity)
      .slice(0, 10);

    return {
      products: {
        total: totalProducts,
        active: activeProducts,
        inactive: inactiveProducts,
        draft: draftProducts,
        outOfStock: outOfStockProducts,
        archived: archivedProducts,
        byStatus: productsByStatus.reduce((acc, item) => {
          acc[item.status] = item._count.status;
          return acc;
        }, {} as Record<string, number>)
      },
      orders: {
        total: totalOrders,
        pending: pendingOrders,
        paid: paidOrders,
        completed: completedOrders,
        cancelled: cancelledOrders,
        expired: expiredOrders,
        totalRevenue: revenueResult._sum.total?.toString() || '0',
        recentOrders: recentOrders.map(o => {
          return {
            id: o.id,
            orderNumber: o.orderNumber,
            total: o.total.toString(),
            currency: o.currency,
            status: o.status,
            createdAt: o.createdAt,
            user: {
              firstName: o.user.firstName,
              lastName: o.user.lastName,
              username: o.user.username
            }
          };
        })
      },
      stock: {
        total: totalStock,
        available: availableStock,
        reserved: reservedStock,
        sold: soldStock,
        disabled: disabledStock,
        lowStockProducts: lowStockList
      },
      payments: {
        total: totalPayments,
        pending: pendingPayments,
        succeeded: succeededPayments,
        failed: failedPayments,
        expired: expiredPayments,
        totalAmount: paymentAmountResult._sum.amount?.toString() || '0',
        byProvider: paymentsByProvider.reduce((acc, item) => {
          acc[item.provider] = item._count.provider;
          return acc;
        }, {} as Record<string, number>)
      },
      categories: {
        total: totalCategories,
        active: activeCategories,
        archived: archivedCategories
      },
      users: {
        total: totalUsers,
        active: activeUsers,
        withOrders: usersWithOrders
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