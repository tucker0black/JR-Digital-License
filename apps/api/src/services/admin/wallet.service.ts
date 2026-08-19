import crypto from 'node:crypto';
import type { PrismaClient, WalletTransactionType } from '@prisma/client';
import { Prisma, WalletTransactionStatus } from '@prisma/client';

export interface WalletFilters {
  search?: string;
  page?: number;
  pageSize?: number;
}

export class AdminWalletService {
  constructor(private prisma: PrismaClient) {}

  async getWallets(filters: WalletFilters = {}) {
    const {
      search,
      page = 1,
      pageSize = 20
    } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(100, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (search) {
      where.user = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
          { telegramId: { equals: /^\d+$/.test(search) ? BigInt(search) : -1n } }
        ]
      };
    }

    const [wallets, total] = await Promise.all([
      this.prisma.wallet.findMany({
        where,
        skip,
        take: pageSizeNum,
        orderBy: { updatedAt: 'desc' },
        include: {
          user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } }
        }
      }),
      this.prisma.wallet.count({ where })
    ]);

    return {
      wallets: wallets.map(wallet => ({
        ...wallet,
        balance: wallet.balance.toString(),
        user: wallet.user
          ? {
              ...wallet.user,
              telegramId: wallet.user.telegramId.toString()
            }
          : null
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async getWalletDetail(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } }
      }
    });

    if (!wallet) return null;

    const [transactions, totalTransactions] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take: 100
      }),
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } })
    ]);

    return {
      wallet: {
        ...wallet,
        balance: wallet.balance.toString(),
        user: {
          ...wallet.user,
          telegramId: wallet.user.telegramId.toString()
        }
      },
      transactions: transactions.map(serializeTransaction),
      totalTransactions
    };
  }

  async adjustBalance(
    userId: string,
    type: WalletTransactionType,
    amountInput: string | number,
    reason: string,
    adminId: string
  ) {
    const amount = new Prisma.Decimal(amountInput.toString());
    if (amount.isZero()) {
      throw new Error('Adjustment amount must not be zero');
    }
    if (type === 'BONUS' && amount.isNegative()) {
      throw new Error('Bonus amount must be positive');
    }
    if (type === 'ADJUSTMENT' && !amount.isInteger()) {
      throw new Error('Adjustment amount must be a whole number of currency units');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const reference = `wallet_${type}_${crypto.randomUUID()}`;

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId, currency: 'USD', balance: 0 },
        update: {}
      });

      const locked = await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
        SELECT balance FROM "Wallet" WHERE id = ${wallet.id}::uuid FOR UPDATE
      `;

      const balanceBefore = locked[0]?.balance ?? wallet.balance;
      const balanceAfter = balanceBefore.plus(amount);

      if (balanceAfter.isNegative()) {
        throw new Error('Insufficient balance: adjustment would make the wallet negative');
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: balanceAfter }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          status: WalletTransactionStatus.COMPLETED,
          amount,
          currency: wallet.currency,
          balanceBefore,
          balanceAfter,
          reference,
          reason
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Wallet',
          entityId: userId,
          action: 'ADJUST_BALANCE',
          oldValue: { balance: balanceBefore.toString() },
          newValue: {
            type,
            amount: amount.toString(),
            balance: balanceAfter.toString(),
            reason,
            reference
          }
        }
      });

      return {
        id: wallet.id,
        userId: wallet.userId,
        currency: wallet.currency,
        balance: balanceAfter.toString(),
        transaction: {
          type,
          amount: amount.toString(),
          balanceBefore: balanceBefore.toString(),
          balanceAfter: balanceAfter.toString(),
          reference,
          reason
        }
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  }
}

function serializeTransaction(tx: {
  id: string;
  walletId: string;
  paymentId: string | null;
  type: string;
  status: string;
  amount: Prisma.Decimal;
  currency: string;
  balanceBefore: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
  reference: string;
  reason: string | null;
  createdAt: Date;
}) {
  return {
    id: tx.id,
    walletId: tx.walletId,
    paymentId: tx.paymentId,
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