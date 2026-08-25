import type { Prisma, PrismaClient, PaymentProvider, PaymentStatus } from '@prisma/client';
import { customerIdFromTelegramId } from '@jr/shared';

export interface AdminPaymentFilters {
  provider?: PaymentProvider;
  status?: PaymentStatus;
  search?: string;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
}

export class AdminPaymentService {
  constructor(private prisma: PrismaClient) {}

  async getPayments(filters: AdminPaymentFilters = {}) {
    const {
      provider,
      status,
      search,
      userId,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 20
    } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(100, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (provider) where.provider = provider;
    if (status) where.status = status;
    if (userId) where.userId = userId;

    if (search) {
      where.OR = [
        { reference: { contains: search, mode: 'insensitive' } },
        { providerPaymentId: { contains: search, mode: 'insensitive' } },
        { order: { orderNumber: { equals: parseInt(search) || undefined } } }
      ];
    }

    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = dateFrom;
      if (dateTo) createdAt.lte = dateTo;
      where.createdAt = createdAt;
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: pageSizeNum,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { id: true, orderNumber: true } },
          user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } }
        }
      }),
      this.prisma.payment.count({ where })
    ]);

    return {
      payments: payments.map(serializePayment),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async getPaymentById(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        order: { select: { id: true, orderNumber: true } },
        user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 50
        }
      }
    });

    if (!payment) return null;

    return {
      ...serializePayment(payment),
      events: payment.events.map(event => ({
        id: event.id,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        processedAt: event.processedAt,
        createdAt: event.createdAt
      }))
    };
  }
}

function serializePayment(payment: {
  id: string;
  orderId: string | null;
  userId: string;
  provider: string;
  status: string;
  amount: Prisma.Decimal;
  currency: string;
  reference: string;
  providerPaymentId: string | null;
  idempotencyKey: string;
  expiresAt: Date | null;
  paidAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  order: { id: string; orderNumber: number } | null;
  user: { id: string; telegramId: bigint; username: string | null; firstName: string; lastName: string | null };
}) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    userId: payment.userId,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount.toString(),
    currency: payment.currency,
    reference: payment.reference,
    providerPaymentId: payment.providerPaymentId,
    idempotencyKey: payment.idempotencyKey,
    expiresAt: payment.expiresAt,
    paidAt: payment.paidAt,
    metadata: payment.metadata,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    order: payment.order,
    user: payment.user
      ? {
          id: payment.user.id,
          telegramId: payment.user.telegramId.toString(),
          customerId: customerIdFromTelegramId(payment.user.telegramId),
          username: payment.user.username,
          firstName: payment.user.firstName,
          lastName: payment.user.lastName
        }
      : null
  };
}