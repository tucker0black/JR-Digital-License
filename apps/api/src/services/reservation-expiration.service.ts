import type { PrismaClient } from '@prisma/client';

export interface ExpiredReservationResult {
  releasedCount: number;
  expiredOrderIds: string[];
}

export class ReservationExpirationService {
  constructor(private prisma: PrismaClient) {}

  async expireOldReservations(maxAgeMinutes: number = 15): Promise<ExpiredReservationResult> {
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    const expiredStock = await this.prisma.productStock.findMany({
      where: {
        status: 'RESERVED',
        reservedAt: { lt: cutoffTime }
      },
      select: { id: true, orderId: true }
    });

    if (expiredStock.length === 0) {
      return { releasedCount: 0, expiredOrderIds: [] };
    }

    const stockIds = expiredStock.map(s => s.id);
    const orderIds = [...new Set(expiredStock.map(s => s.orderId).filter((id): id is string => id !== null))];

    await this.prisma.productStock.updateMany({
      where: { id: { in: stockIds } },
      data: {
        status: 'AVAILABLE',
        orderId: null,
        reservedAt: null
      }
    });

    return { releasedCount: stockIds.length, expiredOrderIds: orderIds };
  }

  async expireReservationForOrder(orderId: string): Promise<number> {
    const result = await this.prisma.productStock.updateMany({
      where: {
        orderId,
        status: 'RESERVED'
      },
      data: {
        status: 'AVAILABLE',
        orderId: null,
        reservedAt: null
      }
    });
    return result.count;
  }

  async getExpiredReservations(maxAgeMinutes: number = 15): Promise<Array<{ id: string; orderId: string | null; reservedAt: Date | null }>> {
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    return this.prisma.productStock.findMany({
      where: {
        status: 'RESERVED',
        reservedAt: { lt: cutoffTime }
      },
      select: { id: true, orderId: true, reservedAt: true }
    });
  }
}