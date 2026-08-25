import crypto from 'node:crypto';
import type { PrismaClient, PaymentStatus } from '@prisma/client';
import {
  Prisma,
  WalletTransactionStatus,
  WalletTransactionType,
  PaymentStatus as PaymentStatusEnum
} from '@prisma/client';

export interface WalletInfo {
  balance: string;
  currency: string;
}

export interface WalletTransactionDto {
  id: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  reference: string;
  reason: string | null;
  createdAt: Date;
}

function serializeTransaction(tx: {
  id: string;
  type: string;
  status: string;
  amount: Prisma.Decimal;
  currency: string;
  balanceBefore: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
  reference: string;
  reason: string | null;
  createdAt: Date;
}): WalletTransactionDto {
  return {
    id: tx.id,
    type: tx.type,
    status: tx.status,
    amount: tx.amount.toString(),
    currency: tx.currency,
    balanceBefore: tx.balanceBefore.toString(),
    balanceAfter: tx.balanceAfter.toString(),
    reference: tx.reference,
    reason: tx.reason,
    createdAt: tx.createdAt
  };
}

export class CustomerWalletService {
  constructor(private prisma: PrismaClient) {}

  async getWallet(userId: string): Promise<{ wallet: WalletInfo; transactions: WalletTransactionDto[] }> {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, currency: 'USD', balance: 0 },
      update: {}
    });

    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    return {
      wallet: {
        balance: wallet.balance.toString(),
        currency: wallet.currency
      },
      transactions: transactions.map(serializeTransaction)
    };
  }

  /**
   * Lightweight wallet lookup — returns only balance and currency.
   * Skips the 50-transaction fetch used by getWallet().
   */
  async getWalletBalance(userId: string): Promise<WalletInfo> {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, currency: 'USD', balance: 0 },
      update: {}
    });

    return {
      balance: wallet.balance.toString(),
      currency: wallet.currency
    };
  }

  async creditDeposit(
    payment: { id: string; amount: Prisma.Decimal; currency: string; userId: string; reference: string },
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const run = async (client: Prisma.TransactionClient): Promise<void> => {
      const wallet = await client.wallet.upsert({
        where: { userId: payment.userId },
        create: { userId: payment.userId, currency: payment.currency, balance: 0 },
        update: {}
      });

      const locked = await client.$queryRaw<{ balance: Prisma.Decimal }[]>`
        SELECT balance FROM "Wallet" WHERE id = ${wallet.id}::uuid FOR UPDATE
      `;

      const balanceBefore = locked[0]?.balance ?? wallet.balance;

      // Re-check after the wallet row is locked so concurrent confirmations
      // cannot both pass the idempotency check and increase the balance.
      const existing = await client.walletTransaction.findFirst({
        where: { paymentId: payment.id, type: 'DEPOSIT' }
      });

      if (existing) {
        return;
      }

      const balanceAfter = balanceBefore.plus(payment.amount);

      await client.wallet.update({
        where: { id: wallet.id },
        data: { balance: balanceAfter }
      });

      await client.walletTransaction.create({
        data: {
          walletId: wallet.id,
          paymentId: payment.id,
          type: 'DEPOSIT',
          status: WalletTransactionStatus.COMPLETED,
          amount: payment.amount,
          currency: payment.currency,
          balanceBefore,
          balanceAfter,
          reference: payment.reference,
          reason: 'Deposit via KHQR/Bakong payment'
        }
      });

      // Create customer notification for wallet deposit
      try {
        await client.customerNotification.create({
            data: {
              userId: payment.userId,
              type: 'WALLET_DEPOSIT',
              title: 'Deposit Successful',
              message: `Your wallet has been credited with ${payment.amount} ${payment.currency}. New balance: ${balanceAfter} ${payment.currency}.`,
              dedupeKey: `payment:${payment.id}:WALLET_DEPOSIT`
            }
        });
      } catch (error) {
        console.error('Failed to create customer notification:', error);
      }
    };

    if (tx) {
      await run(tx);
      return;
    }

    try {
      await this.prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }
      throw error;
    }
  }

  async payOrderWithWallet(
    userId: string,
    orderId: string,
    idempotencyKey?: string
  ): Promise<{
    success: boolean;
    order?: { id: string; orderNumber: number; status: string };
    payment?: { id: string; reference: string; provider: string; status: PaymentStatus };
    error?: string;
  }> {
    const idempotency = idempotencyKey ?? `wallet_pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const existingByIdempotency = await this.prisma.payment.findUnique({
      where: { idempotencyKey: idempotency }
    });

    if (existingByIdempotency) {
      return { success: false, error: 'Payment with this idempotency key already exists' };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true }
    });

    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (order.userId !== userId) {
      return { success: false, error: 'Order does not belong to user' };
    }

    if (order.status === 'PAID' || order.status === 'COMPLETED') {
      return { success: false, error: 'Order already paid' };
    }

    // Block wallet payment if another payment rail has already been initiated
    // for the same order, so a customer cannot double-charge by paying from the
    // wallet while a KHQR session is still active.
    if (order.status === 'PAYMENT_PENDING' || order.status === 'PROCESSING' || order.status === 'FULFILLING') {
      return { success: false, error: 'Order already has an active payment session' };
    }

    if (order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.status === 'REFUNDED') {
      return { success: false, error: 'Order cannot be paid' };
    }

    const reference = `wallet_${crypto.randomUUID()}`;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const orderForUpdate = await tx.order.findUnique({
          where: { id: order.id },
          select: { status: true }
        });

        if (!orderForUpdate) {
          throw new Error('Order not found');
        }

        if (
          orderForUpdate.status === 'PAID' ||
          orderForUpdate.status === 'COMPLETED' ||
          orderForUpdate.status === 'PAYMENT_PENDING' ||
          orderForUpdate.status === 'PROCESSING' ||
          orderForUpdate.status === 'FULFILLING'
        ) {
          throw new Error('Order cannot be paid from wallet right now');
        }

        if (
          orderForUpdate.status === 'CANCELLED' ||
          orderForUpdate.status === 'EXPIRED' ||
          orderForUpdate.status === 'REFUNDED'
        ) {
          throw new Error('Order cannot be paid');
        }

        const wallet = await tx.wallet.findUnique({ where: { userId } });

        if (!wallet) {
          throw new Error('Wallet not found');
        }

        if (wallet.currency !== order.currency) {
          throw new Error('Wallet currency does not match order currency');
        }

        const locked = await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
          SELECT balance FROM "Wallet" WHERE id = ${wallet.id}::uuid FOR UPDATE
        `;

        const balanceBefore = locked[0]?.balance ?? wallet.balance;

        if (balanceBefore.lessThan(order.total)) {
          throw new Error('Insufficient wallet balance');
        }

        const balanceAfter = balanceBefore.minus(order.total);

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter }
        });

        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            userId,
            provider: 'WALLET',
            status: PaymentStatusEnum.SUCCEEDED,
            amount: order.total,
            currency: order.currency,
            reference,
            idempotencyKey: idempotency,
            paidAt: new Date(),
            metadata: { orderId: order.id, walletPayment: true }
          }
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            paymentId: payment.id,
            type: 'PURCHASE',
            status: WalletTransactionStatus.COMPLETED,
            amount: order.total,
            currency: order.currency,
            balanceBefore,
            balanceAfter,
            reference,
            reason: `Purchase for order #${order.orderNumber}`
          }
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'PAID',
            paidAt: new Date()
          }
        });

        const reservedStock = await tx.productStock.findMany({
          where: { orderId: order.id, status: 'RESERVED' }
        });

        if (reservedStock.length > 0) {
          await tx.productStock.updateMany({
            where: { orderId: order.id, status: 'RESERVED' },
            data: { status: 'SOLD', soldAt: new Date() }
          });
        }

        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            eventType: 'payment_succeeded',
            payload: { provider: 'WALLET', walletPayment: true, orderId: order.id }
          }
        });

        return { payment, order };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });

      return {
        success: true,
        order: {
          id: result.order.id,
          orderNumber: result.order.orderNumber,
          status: result.order.status
        },
        payment: {
          id: result.payment.id,
          reference: result.payment.reference,
          provider: result.payment.provider,
          status: result.payment.status
        }
      };
    } catch (error) {
      // If the idempotency key collides with a concurrent request we treat
      // the request as already processed instead of leaking the DB error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return {
          success: false,
          error: 'Payment with this idempotency key already exists'
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pay with wallet balance'
      };
    }
  }

  /**
   * Atomically refunds a wallet-funded payment: credits the buyer's wallet
   * with a REFUND transaction that links back to the original Payment row,
   * ensuring the buyer's money is never lost on a refund.
   */
  async refundDeposit(
    payment: { id: string; amount: Prisma.Decimal; currency: string; userId: string; reference: string },
    tx?: Prisma.TransactionClient,
    reason?: string
  ): Promise<void> {
    const run = async (client: Prisma.TransactionClient): Promise<void> => {
      const existing = await client.walletTransaction.findFirst({
        where: { paymentId: payment.id, type: 'REFUND' }
      });

      if (existing) {
        return;
      }

      const wallet = await client.wallet.findUnique({ where: { userId: payment.userId } });

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      if (wallet.currency !== payment.currency) {
        throw new Error('Wallet currency does not match payment currency');
      }

      const locked = await client.$queryRaw<{ balance: Prisma.Decimal }[]>`
        SELECT balance FROM "Wallet" WHERE id = ${wallet.id}::uuid FOR UPDATE
      `;

      const balanceBefore = locked[0]?.balance ?? wallet.balance;
      const balanceAfter = balanceBefore.plus(payment.amount);

      await client.wallet.update({
        where: { id: wallet.id },
        data: { balance: balanceAfter }
      });

      await client.walletTransaction.create({
        data: {
          walletId: wallet.id,
          paymentId: payment.id,
          type: WalletTransactionType.REFUND,
          status: WalletTransactionStatus.COMPLETED,
          amount: payment.amount,
          currency: payment.currency,
          balanceBefore,
          balanceAfter,
          reference: `refund_${payment.reference}`,
          reason: reason ?? 'Refund for order'
        }
      });
    };

    if (tx) {
      await run(tx);
      return;
    }

    try {
      await this.prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }

      throw error;
    }
  }
}
