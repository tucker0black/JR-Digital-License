import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

/**
 * Order statuses that represent a confirmed (paid) purchase for the customer.
 * Drafts, unpaid, cancelled, expired and refunded orders are excluded.
 */
export const PAID_ORDER_STATUSES = [
  'PAID',
  'PROCESSING',
  'FULFILLING',
  'COMPLETED'
] as const;

export interface CustomerStats {
  totalItemsPurchased: number;
  totalOrders: number;
  totalDeposited: string;
}

export class CustomerStatsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Computes purchase statistics for ONE customer, derived from the
   * authenticated user's own database records only.
   */
  async getStats(userId: string): Promise<CustomerStats> {
    const [orderItems, totalOrders, depositTransactions] = await Promise.all([
      this.prisma.orderItem.findMany({
        where: {
          order: {
            userId,
            status: { in: [...PAID_ORDER_STATUSES] }
          }
        },
        select: { quantitySnapshot: true }
      }),
      this.prisma.order.count({
        where: { userId, status: { in: [...PAID_ORDER_STATUSES] } }
      }),
      this.prisma.walletTransaction.findMany({
        where: {
          wallet: { userId },
          type: 'DEPOSIT',
          status: 'COMPLETED'
        },
        select: { amount: true }
      })
    ]);

    const totalItemsPurchased = orderItems.reduce(
      (sum, item) => sum + item.quantitySnapshot,
      0
    );

    const totalDeposited = depositTransactions.reduce(
      (sum, tx) => sum.plus(tx.amount),
      new Prisma.Decimal(0)
    );

    return {
      totalItemsPurchased,
      totalOrders,
      totalDeposited: totalDeposited.toString()
    };
  }
}
