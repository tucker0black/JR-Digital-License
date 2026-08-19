import type { PrismaClient } from '@prisma/client';

export interface ExpiredPaymentResult {
  expiredCount: number;
  expiredPaymentIds: string[];
}

export class PaymentExpirationService {
  constructor(private prisma: PrismaClient) {}

  async expireOldPayments(_maxAgeMinutes: number = 15): Promise<ExpiredPaymentResult> {
    const now = new Date();

    const expiredPayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: now }
      },
      select: { id: true }
    });

    if (expiredPayments.length === 0) {
      return { expiredCount: 0, expiredPaymentIds: [] };
    }

    const paymentIds = expiredPayments.map(p => p.id);

    const expiredPaymentIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const paymentId of paymentIds) {
        const transition = await tx.payment.updateMany({
          where: {
            id: paymentId,
            status: { in: ['PENDING', 'PROCESSING'] },
            expiresAt: { lt: now }
          },
          data: { status: 'EXPIRED' }
        });

        if (transition.count === 0) continue;
        expiredPaymentIds.push(paymentId);

        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: { order: true }
        });

        if (payment?.orderId) {
          const reservedStock = await tx.productStock.findMany({
            where: { orderId: payment.orderId, status: 'RESERVED' }
          });

          if (reservedStock.length > 0) {
            await tx.productStock.updateMany({
              where: { orderId: payment.orderId, status: 'RESERVED' },
              data: { status: 'AVAILABLE', orderId: null, reservedAt: null }
            });
          }

          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: 'DRAFT' }
          });
        }

        await tx.paymentEvent.create({
          data: {
            paymentId,
            eventType: 'payment_expired',
            payload: { expiredAt: new Date().toISOString() }
          }
        });
      }
    });

    return { expiredCount: expiredPaymentIds.length, expiredPaymentIds };
  }

  async expirePaymentById(paymentId: string): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true }
    });

    if (!payment || (payment.status !== 'PENDING' && payment.status !== 'PROCESSING')) {
      return false;
    }

    await this.prisma.$transaction(async (tx) => {
      const transition = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'EXPIRED' }
      });

      if (transition.count === 0) return;

      if (payment.orderId) {
        const reservedStock = await tx.productStock.findMany({
          where: { orderId: payment.orderId, status: 'RESERVED' }
        });

        if (reservedStock.length > 0) {
          await tx.productStock.updateMany({
            where: { orderId: payment.orderId, status: 'RESERVED' },
            data: { status: 'AVAILABLE', orderId: null, reservedAt: null }
          });
        }

        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: 'DRAFT' }
        });
      }

      await tx.paymentEvent.create({
        data: {
          paymentId,
          eventType: 'payment_expired',
          payload: { expiredAt: new Date().toISOString() }
        }
      });
    });

    return true;
  }

  async getExpiredPayments(_maxAgeMinutes: number = 15): Promise<Array<{ id: string; orderId: string | null; expiresAt: Date | null; createdAt: Date }>> {
    const now = new Date();

    return this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: now }
      },
      select: { id: true, orderId: true, expiresAt: true, createdAt: true }
    });
  }
}
