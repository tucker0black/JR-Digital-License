import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { CustomerStatsService, PAID_ORDER_STATUSES } from './customer-stats.service.js';

const mockPrisma = {
  orderItem: { findMany: vi.fn() },
  order: { count: vi.fn() },
  walletTransaction: { findMany: vi.fn() }
};

describe('CustomerStatsService', () => {
  const service = new CustomerStatsService(mockPrisma as unknown as PrismaClient);

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.orderItem.findMany.mockResolvedValue([
      { quantitySnapshot: 2 },
      { quantitySnapshot: 1 }
    ]);
    mockPrisma.order.count.mockResolvedValue(2);
    mockPrisma.walletTransaction.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal('5.00') },
      { amount: new Prisma.Decimal('2.50') }
    ]);
  });

  it('calculates paid customer purchases and confirmed deposits only', async () => {
    const result = await service.getStats('user-jim');

    expect(result).toEqual({
      totalItemsPurchased: 3,
      totalOrders: 2,
      totalDeposited: '7.5'
    });
    expect(mockPrisma.order.count).toHaveBeenCalledWith({
      where: { userId: 'user-jim', status: { in: [...PAID_ORDER_STATUSES] } }
    });
    expect(mockPrisma.walletTransaction.findMany).toHaveBeenCalledWith({
      where: {
        wallet: { userId: 'user-jim' },
        type: 'DEPOSIT',
        status: 'COMPLETED'
      },
      select: { amount: true }
    });
  });

  it('does not treat delivery failures as paid purchase statistics', async () => {
    expect(PAID_ORDER_STATUSES).not.toContain('DELIVERY_FAILED');
    expect(PAID_ORDER_STATUSES).not.toContain('CANCELLED');
    expect(PAID_ORDER_STATUSES).not.toContain('REFUNDED');
    expect(PAID_ORDER_STATUSES).not.toContain('PAYMENT_PENDING');
  });
});
