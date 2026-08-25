import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Prisma, OrderStatus, PaymentStatus } from '@prisma/client';
import { customerIdFromTelegramId } from '@jr/shared';
import type { CustomerWalletService } from '../wallet.service.js';

export interface OrderFilters {
  search?: string;
  userId?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  deliveryType?: 'all' | 'automatic' | 'hand_delivery' | 'waiting_delivery' | 'delivered';
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface OrderWithDetails {
  id: string;
  orderNumber: number;
  userId: string;
  status: string;
  currency: string;
  subtotal: string;
  discount: string;
  total: string;
  idempotencyKey: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    telegramId: string;
    customerId: string;
    username: string | null;
    firstName: string;
    lastName: string | null;
  };
  items: Array<{
    id: string;
    productId: string | null;
    variantId: string | null;
    productNameSnapshot: string;
    unitPriceSnapshot: string;
    quantitySnapshot: number;
    totalSnapshot: string;
    currencySnapshot: string;
    deliveryTypeSnapshot: string;
    providerServiceIdSnapshot: string | null;
    target: string | null;
    createdAt: Date;
    product: {
      id: string;
      name: string;
      slug: string;
      imageUrl: string | null;
    } | null;
  }>;
  payments: Array<{
    id: string;
    provider: string;
    status: string;
    amount: string;
    currency: string;
    reference: string;
    providerTransactionHash: string | null;
    expiresAt: Date | null;
    paidAt: Date | null;
    createdAt: Date;
  }>;
}

export interface OrderStats {
  total: number;
  pending: number;
  paid: number;
  completed: number;
  cancelled: number;
  expired: number;
  totalRevenue: string;
}

export class OrderService {
  constructor(
    private prisma: PrismaClient,
    private walletService: CustomerWalletService
  ) {}

  private static readonly SORTABLE_COLUMNS = new Set([
    'createdAt',
    'updatedAt',
    'orderNumber',
    'status',
    'total',
    'paidAt'
  ]);

  private static readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async getOrders(filters: OrderFilters = {}) {
    const {
      search,
      userId,
      status,
      paymentStatus,
      deliveryType,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = filters;

    const pageNum = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
    const pageSizeNum =
      Number.isFinite(pageSize) && pageSize >= 1 ? Math.min(100, Math.floor(pageSize)) : 20;
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (search) {
      const or: Record<string, unknown>[] = [
        { orderNumber: { equals: parseInt(search, 10) || 0 } }
      ];
      if (OrderService.UUID_PATTERN.test(search)) {
        or.push({ id: { equals: search } });
      }
      where.OR = or;
    }

    if (userId) {
      where.userId = userId;
    }

    if (status) {
      where.status = status;
    }

    if (paymentStatus && Object.values(PaymentStatus).includes(paymentStatus)) {
      where.payments = { some: { status: paymentStatus } };
    }

    if (deliveryType && deliveryType !== 'all') {
      if (deliveryType === 'automatic') {
        where.items = { every: { product: { isHandDelivery: false } } };
      } else if (deliveryType === 'hand_delivery') {
        where.items = { some: { product: { isHandDelivery: true } } };
      } else if (deliveryType === 'waiting_delivery') {
        where.AND = [
          { items: { some: { product: { isHandDelivery: true } } } },
          { status: 'PAID' }
        ];
      } else if (deliveryType === 'delivered') {
        where.AND = [
          { items: { some: { product: { isHandDelivery: true } } } },
          { status: 'COMPLETED' }
        ];
      }
    }

    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = dateFrom;
      if (dateTo) createdAt.lte = dateTo;
      where.createdAt = createdAt;
    }

    const safeSortBy = OrderService.SORTABLE_COLUMNS.has(sortBy) ? sortBy : 'createdAt';
    const safeSortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: pageSizeNum,
        orderBy: { [safeSortBy]: safeSortOrder },
        include: {
          user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, slug: true, imageUrl: true, price: true, isHandDelivery: true } },
              fulfillment: { select: { status: true } }
            }
          },
          payments: {
            select: { id: true, provider: true, status: true, amount: true, currency: true, reference: true, paidAt: true, createdAt: true }
          }
        }
      }),
      this.prisma.order.count({ where })
    ]);

    const ordersWithDetails = orders.map(order => {
      return {
        ...order,
        subtotal: order.subtotal.toString(),
        discount: order.discount.toString(),
        total: order.total.toString(),
        user: {
          id: order.user.id,
          telegramId: order.user.telegramId.toString(),
          customerId: customerIdFromTelegramId(order.user.telegramId),
          username: order.user.username,
          firstName: order.user.firstName,
          lastName: order.user.lastName
        },
        items: order.items.map(item => {
          return {
            ...item,
            unitPriceSnapshot: item.unitPriceSnapshot.toString(),
            totalSnapshot: item.totalSnapshot.toString(),
            product: item.product ? { ...item.product, price: item.product.price?.toString() } : null
          };
        }),
        payments: order.payments.map(p => {
          return {
            ...p,
            amount: p.amount.toString()
          };
        })
      };
    });

    return {
      orders: ordersWithDetails,
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async getOrderById(id: string): Promise<OrderWithDetails | null> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, slug: true, imageUrl: true, price: true } }
          }
        },
        payments: {
          select: { id: true, provider: true, status: true, amount: true, currency: true, reference: true, providerTransactionHash: true, expiresAt: true, paidAt: true, createdAt: true }
        }
      }
    });

    if (!order) return null;

    return {
      ...order,
      subtotal: order.subtotal.toString(),
      discount: order.discount.toString(),
      total: order.total.toString(),
      user: {
        id: order.user.id,
        telegramId: order.user.telegramId.toString(),
        customerId: customerIdFromTelegramId(order.user.telegramId),
        username: order.user.username,
        firstName: order.user.firstName,
        lastName: order.user.lastName
      },
      items: order.items.map(item => {
        return {
          ...item,
          unitPriceSnapshot: item.unitPriceSnapshot.toString(),
          totalSnapshot: item.totalSnapshot.toString(),
          product: item.product ? { ...item.product, price: item.product.price?.toString() } : null
        };
      }),
      payments: order.payments.map(p => {
        return {
          ...p,
          amount: p.amount.toString()
        };
      })
    };
  }

  async getOrderByNumber(orderNumber: number): Promise<OrderWithDetails | null> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, slug: true, imageUrl: true, price: true } }
          }
        },
        payments: {
          select: { id: true, provider: true, status: true, amount: true, currency: true, reference: true, providerTransactionHash: true, expiresAt: true, paidAt: true, createdAt: true }
        }
      }
    });

    if (!order) return null;

    return {
      ...order,
      subtotal: order.subtotal.toString(),
      discount: order.discount.toString(),
      total: order.total.toString(),
      user: {
        id: order.user.id,
        telegramId: order.user.telegramId.toString(),
        customerId: customerIdFromTelegramId(order.user.telegramId),
        username: order.user.username,
        firstName: order.user.firstName,
        lastName: order.user.lastName
      },
      items: order.items.map(item => {
        return {
          ...item,
          unitPriceSnapshot: item.unitPriceSnapshot.toString(),
          totalSnapshot: item.totalSnapshot.toString(),
          product: item.product ? { ...item.product, price: item.product.price?.toString() } : null
        };
      }),
      payments: order.payments.map(p => {
        return {
          ...p,
          amount: p.amount.toString()
        };
      })
    };
  }

  async getOrderStats(): Promise<OrderStats> {
    const [total, pending, paid, completed, cancelled, expired, revenueResult] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.PAYMENT_PENDING } }),
      this.prisma.order.count({ where: { status: OrderStatus.PAID } }),
      this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      this.prisma.order.count({ where: { status: OrderStatus.CANCELLED } }),
      this.prisma.order.count({ where: { status: OrderStatus.EXPIRED } }),
      this.prisma.order.aggregate({
        where: { status: { in: [OrderStatus.PAID, OrderStatus.COMPLETED] } },
        _sum: { total: true }
      })
    ]);

    return {
      total,
      pending,
      paid,
      completed,
      cancelled,
      expired,
      totalRevenue: revenueResult._sum.total?.toString() || '0'
    };
  }

  async getPendingHandDeliveryCount(): Promise<number> {
    // Use a single efficient query instead of fetching full order objects.
    // Count orders that have at least one hand-delivery item where the
    // fulfillment is NOT yet DELIVERED.
    const result = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT o."id") AS count
      FROM "Order" o
      INNER JOIN "OrderItem" oi ON oi."orderId" = o."id"
      INNER JOIN "Product" p ON p."id" = oi."productId"
      LEFT JOIN "FulfillmentRecord" fr ON fr."orderItemId" = oi."id"
      WHERE o."status" IN ('PAID', 'PROCESSING', 'FULFILLING')
        AND p."isHandDelivery" = true
        AND (fr."status" IS NULL OR fr."status" != 'DELIVERED')
    `;
    return Number(result[0]?.count ?? 0);
  }

  async cancelOrder(id: string, _adminId: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, payments: true }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      throw new Error('Order already cancelled or refunded');
    }

    if (order.status === 'COMPLETED' || order.status === 'FULFILLING') {
      throw new Error('Cannot cancel fulfilled order');
    }

    await this.prisma.$transaction(async (tx) => {
      // Release reserved stock first so it can be re-sold
      const reservedStock = await tx.productStock.findMany({
        where: { orderId: id, status: 'RESERVED' }
      });

      if (reservedStock.length > 0) {
        await tx.productStock.updateMany({
          where: { orderId: id, status: 'RESERVED' },
          data: { status: 'AVAILABLE', orderId: null, reservedAt: null }
        });
      }

      // Update payments if pending (KHQR/BAKONG) so the customer's money
      // cannot be claimed for an order the admin just cancelled.
      await tx.payment.updateMany({
        where: { orderId: id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'CANCELLED' }
      });

      // If the order was already paid via wallet, refund the wallet so the
      // customer does not lose money on a cancelled order.
      const paidWalletPayment = order.payments.find(
        p => p.provider === 'WALLET' && p.status === 'SUCCEEDED'
      );
      if (paidWalletPayment) {
        const existingRefund = await tx.walletTransaction.findFirst({
          where: { paymentId: paidWalletPayment.id, type: 'REFUND' }
        });
        if (!existingRefund) {
          const wallet = await tx.wallet.findUnique({ where: { userId: order.userId } });
          if (wallet && wallet.currency === paidWalletPayment.currency) {
            const locked = await tx.$queryRaw<{ balance: typeof paidWalletPayment.amount }[]>`
              SELECT balance FROM "Wallet" WHERE id = ${wallet.id}::uuid FOR UPDATE
            `;
            const balanceBefore = locked[0]?.balance ?? wallet.balance;
            const balanceAfter = balanceBefore.plus(paidWalletPayment.amount);
            await tx.wallet.update({
              where: { id: wallet.id },
              data: { balance: balanceAfter }
            });
            await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                paymentId: paidWalletPayment.id,
                type: 'REFUND',
                status: 'COMPLETED',
                amount: paidWalletPayment.amount,
                currency: paidWalletPayment.currency,
                balanceBefore,
                balanceAfter,
                reference: `refund_${paidWalletPayment.reference}`,
                reason: reason || 'Admin cancelled order'
              }
            });
          }
        }
      }

      // Update order status
      await tx.order.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() }
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          adminId: _adminId,
          entityType: 'Order',
          entityId: id,
          action: 'CANCEL',
          oldValue: { status: 'PENDING' },
          newValue: { status: 'CANCELLED', reason: reason || 'Admin cancelled' }
        }
      });
    });
  }

  async refundOrder(id: string, adminId: string, reason?: string, amountInput?: string | number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { payments: true, user: { select: { id: true, firstName: true, lastName: true, username: true, telegramId: true } } }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    const paidPayment = order.payments.find(p => p.status === 'SUCCEEDED');
    if (!paidPayment) {
      throw new Error('No successful payment found for this order');
    }

    // Idempotency: an already-refunded order returns success without creating
    // a second refund record, second wallet credit, or second audit entry.
    if (order.status === 'REFUNDED') {
      const existingRefund = await this.prisma.payment.findFirst({
        where: {
          orderId: order.id,
          status: 'REFUNDED',
          metadata: { path: ['kind'], equals: 'refund' }
        }
      });
      if (existingRefund) {
        return {
          success: true,
          idempotent: true,
          provider: paidPayment.provider,
          amountRefunded: paidPayment.amount.toString(),
          currency: paidPayment.currency,
          externalRefundRequired: paidPayment.provider !== 'WALLET'
        };
      }
      throw new Error('Order already refunded');
    }

    if (order.status !== 'PAID' && order.status !== 'COMPLETED') {
      throw new Error('Order not paid, cannot refund');
    }

    const paidAmount = paidPayment.amount;
    let refundAmount = paidAmount;

    if (amountInput !== undefined && amountInput !== null && amountInput !== '') {
      const raw = String(amountInput).trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
        throw new Error('Refund amount must be a positive decimal with at most 2 decimal places');
      }

      let parsed: Prisma.Decimal;
      try {
        parsed = new Prisma.Decimal(raw);
      } catch {
        throw new Error('Refund amount is invalid');
      }

      if (!parsed.isPositive() || parsed.isZero()) {
        throw new Error('Refund amount must be greater than zero');
      }

      if (parsed.greaterThan(paidAmount)) {
        throw new Error(`Refund amount cannot exceed the amount actually paid (${paidAmount.toFixed(2)} ${paidPayment.currency})`);
      }

      refundAmount = parsed;
    }

    const refundReference = `refund_${crypto.randomUUID()}`;

    const txResult = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: only one refund can transition the order out of
      // PAID/COMPLETED, which makes concurrent refunds idempotent.
      const claim = await tx.order.updateMany({
        where: { id, status: { in: ['PAID', 'COMPLETED'] } },
        data: { status: 'REFUNDED', cancelledAt: new Date() }
      });

      if (claim.count === 0) {
        const existingRefund = await tx.payment.findFirst({
          where: {
            orderId: id,
            status: 'REFUNDED',
            metadata: { path: ['kind'], equals: 'refund' }
          }
        });
        if (existingRefund) {
          return { idempotent: true };
        }
        throw new Error('Order already refunded');
      }

      // Release reserved and sold stock back to available so it can be re-sold
      const reservedStock = await tx.productStock.findMany({
        where: { orderId: id, status: { in: ['RESERVED', 'SOLD'] } }
      });

      if (reservedStock.length > 0) {
        await tx.productStock.updateMany({
          where: { orderId: id, status: { in: ['RESERVED', 'SOLD'] } },
          data: { status: 'AVAILABLE', orderId: null, reservedAt: null, soldAt: null }
        });
      }

      // Update the original paid payment
      await tx.payment.update({
        where: { id: paidPayment.id },
        data: { status: 'REFUNDED' }
      });

      // Create the refund payment record. It is clearly distinguishable from
      // the original payment (status REFUNDED + metadata.kind 'refund') and
      // preserves the original Bakong transaction/reference via
      // originalPaymentId / providerTransactionHash untouched.
      await tx.payment.create({
        data: {
          orderId: order.id,
          userId: order.userId,
          provider: paidPayment.provider,
          status: 'REFUNDED',
          amount: refundAmount,
          currency: paidPayment.currency,
          reference: refundReference,
          idempotencyKey: refundReference,
          metadata: {
            kind: 'refund',
            originalPaymentId: paidPayment.id,
            originalReference: paidPayment.reference,
            originalProviderTransactionHash: paidPayment.providerTransactionHash ?? null,
            refundedAmount: refundAmount.toFixed(2),
            reason: reason || 'Admin refund'
          }
        }
      });

      // If the original payment was funded from the wallet, credit the wallet
      // exactly once using the shared wallet transaction system. Any failure
      // here rolls back the whole refund so the order is never marked
      // REFUNDED without the money returning to the customer.
      if (paidPayment.provider === 'WALLET') {
        await this.walletService.refundDeposit({
          id: paidPayment.id,
          amount: refundAmount,
          currency: paidPayment.currency,
          userId: order.userId,
          reference: paidPayment.reference
        }, tx, reason ? `Admin refund: ${reason}` : 'Admin refund');
      }

      // Audit log: admin, customer, order, amount, reason and result.
      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Order',
          entityId: id,
          action: 'REFUND',
          oldValue: {
            status: order.status,
            amount: paidPayment.amount.toString(),
            currency: paidPayment.currency,
            customer: {
              id: order.user.id,
              customerId: customerIdFromTelegramId(order.user.telegramId),
              firstName: order.user.firstName,
              lastName: order.user.lastName,
              username: order.user.username
            },
            orderNumber: order.orderNumber
          },
          newValue: {
            status: 'REFUNDED',
            amount: refundAmount.toFixed(2),
            currency: paidPayment.currency,
            reason: reason || 'Admin refund',
            provider: paidPayment.provider,
            result: 'REFUNDED',
            refundPaymentId: refundReference
          }
        }
      });

      return { idempotent: false };
    });

    if (txResult?.idempotent) {
      return {
        success: true,
        idempotent: true,
        provider: paidPayment.provider,
        amountRefunded: paidPayment.amount.toFixed(2),
        currency: paidPayment.currency,
        externalRefundRequired: paidPayment.provider !== 'WALLET'
      };
    }

    return {
      success: true,
      provider: paidPayment.provider,
      amountRefunded: refundAmount.toFixed(2),
      currency: paidPayment.currency,
      // KHQR/Bakong has no automated reversal in this architecture: the refund
      // is recorded locally and the admin must return the funds out-of-band.
      externalRefundRequired: paidPayment.provider !== 'WALLET'
    };
  }

  async retryFailedPayment(paymentId: string, _adminId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true }
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.status !== 'FAILED' && payment.status !== 'EXPIRED') {
      throw new Error('Only failed or expired payments can be retried');
    }

    // Reset payment status to pending
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });

    return { success: true };
  }
}