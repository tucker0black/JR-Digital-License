import type { PrismaClient, UserStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PAID_ORDER_STATUSES } from '../customer-stats.service.js';

/**
 * Accounts created within this window are shown as NEW in the admin dashboard.
 * The customer-facing /api/me derives NEW/EXISTING from account creation at
 * authentication time; the admin panel uses the creation date as its signal.
 */
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface UserFilters {
  search?: string;
  status?: UserStatus;
  page?: number;
  pageSize?: number;
}

export class AdminUserService {
  constructor(private prisma: PrismaClient) {}

  async getUsers(filters: UserFilters = {}) {
    const {
      search,
      status,
      page = 1,
      pageSize = 20
    } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(100, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { telegramId: { equals: /^\d+$/.test(search) ? BigInt(search) : -1n } }
      ];
    }

    if (status) {
      where.status = status;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSizeNum,
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.user.count({ where })
    ]);

    const statsByUser = await this.computeStatsByUser(users.map((user) => user.id));

    return {
      users: users.map((user) => ({
        ...serializeUser(user),
        accountStatus: accountStatusFromCreatedAt(user.createdAt),
        ...statsByUser.get(user.id)
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        wallet: true,
        _count: {
          select: { orders: true, payments: true, tickets: true }
        }
      }
    });

    if (!user) return null;

    const statsByUser = await this.computeStatsByUser([id]);
    const stats = statsByUser.get(id);

    const [recentOrders, recentDeposits, recentTickets] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId: id, status: { in: [...PAID_ORDER_STATUSES] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          currency: true,
          createdAt: true
        }
      }),
      user.wallet
        ? this.prisma.walletTransaction.findMany({
            where: {
              walletId: user.wallet.id,
              type: 'DEPOSIT',
              status: 'COMPLETED'
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              type: true,
              status: true,
              amount: true,
              currency: true,
              reference: true,
              createdAt: true
            }
          })
        : Promise.resolve([]),
      this.prisma.supportTicket.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          number: true,
          subject: true,
          status: true,
          createdAt: true
        }
      })
    ]);

    return {
      ...serializeUser(user),
      accountStatus: accountStatusFromCreatedAt(user.createdAt),
      wallet: user.wallet
        ? {
            id: user.wallet.id,
            currency: user.wallet.currency,
            balance: user.wallet.balance.toString()
          }
        : null,
      orderCount: user._count.orders,
      paymentCount: user._count.payments,
      ticketCount: user._count.tickets,
      totalItemsPurchased: stats?.totalItemsPurchased ?? 0,
      totalOrders: stats?.totalOrders ?? 0,
      totalDeposited: stats?.totalDeposited ?? '0',
      activity: {
        recentOrders: recentOrders.map((order) => ({
          ...order,
          total: order.total.toString()
        })),
        recentDeposits: recentDeposits.map((tx) => ({
          ...tx,
          amount: tx.amount.toString()
        })),
        recentTickets
      }
    };
  }

  /**
   * Computes per-user purchase/deposit statistics for a set of user IDs.
   * All aggregation is filtered by the exact user IDs provided.
   */
  private async computeStatsByUser(
    userIds: string[]
  ): Promise<Map<string, { totalItemsPurchased: number; totalOrders: number; totalDeposited: string }>> {
    const result = new Map<string, { totalItemsPurchased: number; totalOrders: number; totalDeposited: string }>();
    userIds.forEach((id) => result.set(id, { totalItemsPurchased: 0, totalOrders: 0, totalDeposited: '0' }));

    if (userIds.length === 0) return result;

    const [orders, depositTransactions, wallets] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId: { in: userIds }, status: { in: [...PAID_ORDER_STATUSES] } },
        select: {
          userId: true,
          items: { select: { quantitySnapshot: true } }
        }
      }),
      this.prisma.walletTransaction.findMany({
        where: {
          wallet: { userId: { in: userIds } },
          type: 'DEPOSIT',
          status: 'COMPLETED'
        },
        select: { walletId: true, amount: true }
      }),
      this.prisma.wallet.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, userId: true }
      })
    ]);

    const walletOwner = new Map(wallets.map((wallet) => [wallet.id, wallet.userId]));

    for (const order of orders) {
      const entry = result.get(order.userId);
      if (!entry) continue;
      entry.totalOrders += 1;
      entry.totalItemsPurchased += order.items.reduce((sum, item) => sum + item.quantitySnapshot, 0);
    }

    for (const tx of depositTransactions) {
      const userId = walletOwner.get(tx.walletId);
      if (!userId) continue;
      const entry = result.get(userId);
      if (!entry) continue;
      const current = entry.totalDeposited === '0' ? new Prisma.Decimal(0) : new Prisma.Decimal(entry.totalDeposited);
      entry.totalDeposited = current.plus(tx.amount).toFixed(2);
    }

    return result;
  }

  async setUserStatus(id: string, status: UserStatus, adminId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new Error('User not found');
    }

    if (user.status === status) {
      throw new Error(`User is already ${status}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data: { status }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'User',
          entityId: id,
          action: 'STATUS_CHANGED',
          oldValue: { status: user.status },
          newValue: { status, reason: reason || null }
        }
      });

      return updatedUser;
    });

    return {
      ...serializeUser(updated),
      accountStatus: accountStatusFromCreatedAt(updated.createdAt),
      totalItemsPurchased: 0,
      totalOrders: 0,
      totalDeposited: '0'
    };
  }
}

function accountStatusFromCreatedAt(createdAt: Date): 'NEW' | 'EXISTING' {
  return Date.now() - createdAt.getTime() <= NEW_ACCOUNT_WINDOW_MS ? 'NEW' : 'EXISTING';
}

function serializeUser(user: {
  id: string;
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  languageCode: string | null;
  status: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    languageCode: user.languageCode,
    status: user.status,
    lastSeenAt: user.lastSeenAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}
