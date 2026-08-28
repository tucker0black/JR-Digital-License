import crypto from 'node:crypto';
import type { PrismaClient, PaymentProvider as PrismaPaymentProvider } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ManualPaymentProvider } from './manual-provider.js';
import { BakongPaymentProvider } from './bakong-provider.js';
import { PayWayPaymentProvider } from './payway-provider.js';
import type { BasePaymentProvider, VerifyPaymentParams} from './provider.js';
import type { CustomerWalletService } from '../wallet.service.js';
import type { TelegramNotificationService } from '../notifications/telegram-notification.service.js';

export interface PaymentProviderFactory {
  getProvider(type: PrismaPaymentProvider): BasePaymentProvider;
}

export class DefaultPaymentProviderFactory implements PaymentProviderFactory {
  private providers = new Map<PrismaPaymentProvider, BasePaymentProvider>();

  constructor() {
    this.providers.set('MANUAL', new ManualPaymentProvider());
    this.providers.set('BAKONG', new BakongPaymentProvider());
    this.providers.set('KHQR', new BakongPaymentProvider());
    this.providers.set('ABA_PAYWAY', new PayWayPaymentProvider());
  }

  getProvider(type: PrismaPaymentProvider): BasePaymentProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Payment provider ${type} not implemented`);
    }
    return provider;
  }

  registerProvider(type: PrismaPaymentProvider, provider: BasePaymentProvider): void {
    this.providers.set(type, provider);
  }
}

export interface CreatePaymentResult {
  success: boolean;
  resumed?: boolean;
  conflict?: boolean;
  activePayment?: {
    id: string;
    reference: string;
    amount: string;
    currency: string;
    expiresAt?: Date | null;
  };
  payment?: {
    id: string;
    reference: string;
    providerPaymentId?: string | null;
    expiresAt?: Date | null;
    paymentUrl?: string;
    qrCodeData?: string;
    qrCodeImage?: string;
    merchantName?: string;
    amount?: string;
    currency?: string;
    abapayDeeplink?: string;
  };
  error?: string;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  providerPaymentId?: string;
  providerReference?: string;
  paidAt?: Date;
  amount?: string;
  currency?: string;
  providerTransactionHash?: string;
  error?: string;
}

export interface GetPaymentStatusResult {
  success: boolean;
  payment?: {
    id: string;
    reference: string;
    provider: string;
    status: string;
    amount: string;
    currency: string;
    expiresAt?: Date;
    paidAt?: Date;
    createdAt: Date;
  };
  isExpired: boolean;
  error?: string;
}

export interface CancelPaymentResult {
  success: boolean;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  paid?: boolean;
  cancelled?: boolean;
  alreadyTerminal?: boolean;
  error?: string;
}

/**
 * Provider errors that still authoritatively prove the payment is unpaid
 * (e.g. Bakong reporting no transaction for the QR). Cancellation is safe
 * only when the backend can confirm the payment was NOT actually paid.
 */
const DEFINITELY_UNPAID = /not.*confirm|not.*found|still in flight|waiting/i;

function createPaymentReference(prefix: 'JR-DP' | 'JR-OR'): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function parseDepositAmount(input: string | number): Prisma.Decimal | string {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return 'Deposit amount must be a number';
  }

  if (typeof input === 'number' && !Number.isFinite(input)) {
    return 'Deposit amount must be a finite number';
  }

  const raw = String(input).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    return 'Deposit amount must be a positive decimal with at most 2 decimal places';
  }

  try {
    return new Prisma.Decimal(raw);
  } catch {
    return 'Deposit amount is invalid';
  }
}

export class PaymentService {
  private factory: PaymentProviderFactory;

  constructor(
    private prisma: PrismaClient,
    factory?: PaymentProviderFactory,
    private walletService?: CustomerWalletService,
    private notificationService?: TelegramNotificationService
  ) {
    this.factory = factory ?? new DefaultPaymentProviderFactory();
  }

  async createPayment(
    userId: string,
    orderId: string,
    provider: PrismaPaymentProvider,
    idempotencyKey?: string
  ): Promise<CreatePaymentResult> {
    const idempotency = idempotencyKey ?? `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

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

    if (order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.status === 'REFUNDED') {
      return { success: false, error: 'Order cannot be paid' };
    }

    const providerInstance = this.factory.getProvider(provider);
    if (!providerInstance.isAvailable()) {
      return { success: false, error: providerInstance.getAvailabilityError() };
    }

    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        orderId,
        status: { in: ['PENDING', 'PROCESSING'] }
      }
    });

    if (existingPayment) {
      if (existingPayment.expiresAt && existingPayment.expiresAt <= new Date()) {
        await this.expirePayment(existingPayment.id);
      } else {
        return this.resumePayment(existingPayment);
      }
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const createParams: Parameters<typeof providerInstance.createPayment>[0] = {
      orderId,
      amount: order.total.toString(),
      currency: order.currency,
      reference: createPaymentReference('JR-OR'),
      idempotencyKey: idempotency,
      expiresAt,
      metadata: { orderId, userId }
    };

    const providerResult = await providerInstance.createPayment(createParams);

    if (!providerResult.success) {
      return { success: false, error: providerResult.error || 'Failed to create payment with provider' };
    }

    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        userId,
        provider,
        status: 'PENDING',
        amount: order.total,
        currency: order.currency,
        reference: providerResult.reference!,
        providerPaymentId: providerResult.providerPaymentId,
        idempotencyKey: idempotency,
        expiresAt,
        metadata: providerResult.metadata as Prisma.InputJsonValue | undefined
      }
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'PAYMENT_PENDING' }
    });

    return {
      success: true,
      payment: {
        id: payment.id,
        reference: payment.reference,
        providerPaymentId: payment.providerPaymentId ?? undefined,
        expiresAt: payment.expiresAt ?? undefined,
        paymentUrl: providerResult.paymentUrl,
        qrCodeData: providerResult.qrCodeData,
        qrCodeImage: providerResult.qrCodeImage,
        merchantName: providerResult.merchantName,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        abapayDeeplink: typeof providerResult.metadata?.abapayDeeplink === 'string'
          ? providerResult.metadata.abapayDeeplink
          : undefined
      }
    };
  }

  async createDepositPayment(
    userId: string,
    amountInput: string | number,
    currency: string,
    idempotencyKey?: string
  ): Promise<CreatePaymentResult> {
    const parsedAmount = parseDepositAmount(amountInput);
    if (typeof parsedAmount === 'string') {
      return { success: false, error: parsedAmount };
    }

    const amount = parsedAmount;

    if (!amount.isPositive()) {
      return { success: false, error: 'Deposit amount must be positive' };
    }

    if (amount.greaterThan(1000)) {
      return { success: false, error: 'Deposit amount must not exceed 1000' };
    }

    if (amount.decimalPlaces() > 2) {
      return { success: false, error: 'Deposit amount must have at most 2 decimal places' };
    }

    const normalizedCurrency = currency.trim().toUpperCase();
    if (normalizedCurrency !== 'USD' && normalizedCurrency !== 'KHR') {
      return { success: false, error: 'Deposit currency must be USD or KHR' };
    }

    const idempotency = idempotencyKey ?? `deposit_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const existingByIdempotency = await this.prisma.payment.findUnique({
      where: { idempotencyKey: idempotency }
    });

    if (existingByIdempotency) {
      return { success: false, error: 'Payment with this idempotency key already exists' };
    }

    const provider = 'ABA_PAYWAY' as PrismaPaymentProvider;
    const providerInstance = this.factory.getProvider(provider);
    if (!providerInstance.isAvailable()) {
      return { success: false, error: providerInstance.getAvailabilityError() };
    }

    await this.expireOverdueDeposits(userId);

    const existingDeposit = await this.prisma.payment.findFirst({
      where: {
        userId,
        orderId: null,
        status: { in: ['PENDING', 'PROCESSING'] }
      }
    });

    if (existingDeposit) {
      if (!new Prisma.Decimal(existingDeposit.amount).equals(amount)) {
        return {
          success: false,
          conflict: true,
          error: `Another deposit of ${existingDeposit.amount.toFixed(2)} ${existingDeposit.currency} is already active. Cancel it first, then create a new deposit.`,
          activePayment: {
            id: existingDeposit.id,
            reference: existingDeposit.reference,
            amount: existingDeposit.amount.toFixed(2),
            currency: existingDeposit.currency,
            expiresAt: existingDeposit.expiresAt
          }
        };
      }
      return this.resumePayment(existingDeposit);
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const createParams: Parameters<typeof providerInstance.createPayment>[0] = {
      orderId: 'deposit',
      amount: amount.toFixed(2),
      currency: normalizedCurrency,
      reference: createPaymentReference('JR-DP'),
      idempotencyKey: idempotency,
      expiresAt,
      metadata: { type: 'deposit', userId }
    };

    const providerResult = await providerInstance.createPayment(createParams);

    if (!providerResult.success) {
      return { success: false, error: providerResult.error || 'Failed to create deposit with provider' };
    }

    const payment = await this.prisma.payment.create({
      data: {
        orderId: null,
        userId,
        provider,
        status: 'PENDING',
        amount,
        currency: normalizedCurrency,
        reference: providerResult.reference!,
        providerPaymentId: providerResult.providerPaymentId,
        idempotencyKey: idempotency,
        expiresAt,
        metadata: { ...(providerResult.metadata as Record<string, unknown> | undefined), type: 'deposit' } as Prisma.InputJsonValue
      }
    });

    return {
      success: true,
      payment: {
        id: payment.id,
        reference: payment.reference,
        providerPaymentId: payment.providerPaymentId ?? undefined,
        expiresAt: payment.expiresAt ?? undefined,
        paymentUrl: providerResult.paymentUrl,
        qrCodeData: providerResult.qrCodeData,
        qrCodeImage: providerResult.qrCodeImage,
        merchantName: providerResult.merchantName,
        amount: payment.amount.toFixed(2),
        currency: payment.currency
      }
    };
  }

  private async expireOverdueDeposits(userId: string): Promise<void> {
    const overdue = await this.prisma.payment.findMany({
      where: {
        userId,
        orderId: null,
        status: { in: ['PENDING', 'PROCESSING'] },
        expiresAt: { lte: new Date() }
      },
      select: { id: true }
    });

    for (const payment of overdue) {
      await this.expirePayment(payment.id);
    }
  }

  private resumePayment(payment: {
    id: string;
    reference: string;
    providerPaymentId?: string | null;
    expiresAt?: Date | null;
    amount: Prisma.Decimal;
    currency: string;
    metadata?: Prisma.JsonValue | null;
  }): CreatePaymentResult {
    const metadata = (payment.metadata ?? {}) as Record<string, unknown>;

    const qrCodeData =
      (typeof metadata.qrString === 'string' && metadata.qrString) ||
      (typeof metadata.qrCode === 'string' && metadata.qrCode) ||
      undefined;

    const qrCodeImage =
      (typeof metadata.qrCodeImage === 'string' && metadata.qrCodeImage) ||
      undefined;

    const merchantName =
      (typeof metadata.merchantName === 'string' && metadata.merchantName) ||
      undefined;

    const abapayDeeplink =
      (typeof metadata.abapayDeeplink === 'string' && metadata.abapayDeeplink) ||
      undefined;

    return {
      success: true,
      resumed: true,
      payment: {
        id: payment.id,
        reference: payment.reference,
        providerPaymentId: payment.providerPaymentId ?? undefined,
        expiresAt: payment.expiresAt ?? undefined,
        qrCodeData,
        qrCodeImage,
        merchantName,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        abapayDeeplink
      }
    };
  }

  async verifyPayment(
    paymentId: string,
    providerPayload?: Record<string, unknown>
  ): Promise<VerifyPaymentResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true }
    });

    if (!payment) {
      return { success: false, status: 'FAILED', error: 'Payment not found' };
    }

    if (payment.status === 'SUCCEEDED') {
      return { success: true, status: 'SUCCEEDED', providerPaymentId: payment.providerPaymentId ?? undefined, paidAt: payment.paidAt ?? undefined };
    }

    if (payment.status === 'EXPIRED' || payment.status === 'CANCELLED') {
      return { success: false, status: payment.status, error: `Payment is already ${payment.status.toLowerCase()}` };
    }

    if (payment.status === 'FAILED') {
      return { success: false, status: 'FAILED', error: 'Payment is already failed' };
    }

    if (payment.expiresAt && payment.expiresAt <= new Date()) {
      await this.expirePayment(paymentId);
      return { success: false, status: 'EXPIRED', error: 'Payment expired' };
    }

    const providerInstance = this.factory.getProvider(payment.provider);

    const verifyParams: VerifyPaymentParams = {
      providerPaymentId: payment.providerPaymentId ?? undefined,
      reference: payment.reference,
      idempotencyKey: payment.idempotencyKey,
      payload: providerPayload,
      expectedAmount: payment.amount.toString(),
      expectedCurrency: payment.currency
    };

    const result = await providerInstance.verifyPayment(verifyParams);

    if (
      result.success &&
      result.status === 'SUCCEEDED' &&
      payment.expiresAt &&
      result.paidAt &&
      result.paidAt > payment.expiresAt
    ) {
      await this.expirePayment(paymentId);
      return { success: false, status: 'EXPIRED', error: 'Payment was confirmed after the payment session expired' };
    }

    if (
      result.success &&
      result.status === 'SUCCEEDED' &&
      payment.expiresAt &&
      !result.paidAt &&
      payment.expiresAt <= new Date()
    ) {
      await this.expirePayment(paymentId);
      return { success: false, status: 'EXPIRED', error: 'Payment was confirmed after the payment session expired' };
    }

    if (result.success && result.status === 'SUCCEEDED') {
      const transitioned = await this.handleSuccessfulPayment(payment, result);
      if (!transitioned) {
        const current = await this.prisma.payment.findUnique({
          where: { id: paymentId },
          select: { status: true }
        });
        if (current?.status === 'FAILED') {
          return {
            success: false,
            status: 'FAILED',
            error: 'Payment rejected: provider transaction already recorded for another payment'
          };
        }
        if (current?.status === 'EXPIRED') {
          return { success: false, status: 'EXPIRED', error: 'Payment session expired' };
        }
        if (payment.expiresAt && payment.expiresAt <= new Date()) {
          await this.expirePayment(paymentId);
          return { success: false, status: 'EXPIRED', error: 'Payment session expired' };
        }
      }
    } else if (result.status === 'FAILED' || result.status === 'CANCELLED') {
      await this.handleFailedPayment(payment);
    }

    return result;
  }

  async getPaymentStatus(paymentId: string, userId: string): Promise<GetPaymentStatusResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true }
    });

    if (!payment) {
      return { success: false, error: 'Payment not found', isExpired: false };
    }

    if (payment.userId !== userId) {
      return { success: false, error: 'Payment not found', isExpired: false };
    }

    const isExpired = Boolean(
      payment.expiresAt &&
      payment.expiresAt <= new Date() &&
      (payment.status === 'PENDING' || payment.status === 'PROCESSING')
    );

    if (isExpired) {
      await this.expirePayment(paymentId);
      const updated = await this.prisma.payment.findUnique({ where: { id: paymentId } });
      return {
        success: true,
        isExpired: true,
        payment: updated ? {
          id: updated.id,
          reference: updated.reference,
          provider: updated.provider,
          status: updated.status,
          amount: updated.amount.toString(),
          currency: updated.currency,
          expiresAt: updated.expiresAt ?? undefined,
          paidAt: updated.paidAt ?? undefined,
          createdAt: updated.createdAt
        } : undefined
      };
    }

    return {
      success: true,
      isExpired: false,
      payment: {
        id: payment.id,
        reference: payment.reference,
        provider: payment.provider,
        status: payment.status,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        expiresAt: payment.expiresAt ?? undefined,
        paidAt: payment.paidAt ?? undefined,
        createdAt: payment.createdAt
      }
    };
  }

  /**
   * Customer-initiated cancellation of a payment session.
   *
   * The server re-checks the authoritative payment state BEFORE cancelling:
   * if the customer actually paid (verified server-side), success wins and
   * cancellation never turns a genuinely paid payment back into an unpaid
   * one. If the provider cannot confirm the payment is unpaid (connectivity
   * or configuration problems), cancellation is refused so money is never
   * stranded by a cancel racing a real payment.
   */
  async cancelPayment(paymentId: string, userId: string): Promise<CancelPaymentResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true }
    });

    if (!payment || payment.userId !== userId) {
      return { success: false, status: 'PENDING', error: 'Payment not found' };
    }

    if (payment.status === 'SUCCEEDED') {
      return { success: true, status: 'SUCCEEDED', paid: true, alreadyTerminal: true };
    }

    if (payment.status === 'CANCELLED' || payment.status === 'EXPIRED' || payment.status === 'FAILED') {
      return { success: true, status: payment.status, alreadyTerminal: true };
    }

    // Authoritative recheck: the backend decides, never the frontend.
    const verification = await this.verifyPayment(paymentId);

    if (verification.status === 'SUCCEEDED') {
      return { success: true, status: 'SUCCEEDED', paid: true };
    }

    if (verification.status === 'FAILED') {
      return { success: true, status: 'FAILED' };
    }

    if (verification.status === 'EXPIRED' || verification.status === 'CANCELLED') {
      return { success: true, status: verification.status };
    }

    // Still pending: only proceed when the provider could authoritatively
    // confirm the payment is genuinely unpaid. An indeterminate outcome
    // (network/configuration error) means we must not expire the session.
    if (verification.status === 'PENDING' || verification.status === 'PROCESSING') {
      if (verification.error && !DEFINITELY_UNPAID.test(verification.error)) {
        return {
          success: false,
          status: 'PENDING',
          error: 'Payment status could not be confirmed. The payment is still valid — try cancelling again.'
        };
      }

      await this.expirePayment(paymentId);
      return { success: true, status: 'EXPIRED', cancelled: true };
    }

    return { success: false, status: 'PENDING', error: 'Payment status could not be determined' };
  }

  async expirePayment(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true }
    });

    if (!payment) return;

    if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') return;

    const providerInstance = this.factory.getProvider(payment.provider);

    await providerInstance.expirePayment({ reference: payment.reference });

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
    });
  }

  async expireOldPayments(_maxAgeMinutes: number = 15): Promise<{ expiredCount: number }> {
    const now = new Date();

    const expiredPayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: now }
      }
    });

    let expiredCount = 0;

    for (const payment of expiredPayments) {
      await this.expirePayment(payment.id);
      expiredCount++;
    }

    return { expiredCount };
  }

  private async handleSuccessfulPayment(payment: {
    id: string;
    orderId?: string | null;
    providerPaymentId?: string | null;
    userId: string;
    amount: Prisma.Decimal;
    currency: string;
    reference: string;
    expiresAt?: Date | null;
  }, result: VerifyPaymentResult): Promise<boolean> {
    let transitioned = false;

    try {
      await this.prisma.$transaction(async (tx) => {
      const paidAt = result.paidAt ?? new Date();
      const claim = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: ['PENDING', 'PROCESSING'] },
          ...(payment.expiresAt
            ? {
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gte: paidAt } }
                ]
              }
            : {})
        },
        data: {
          status: 'SUCCEEDED',
          paidAt,
          providerPaymentId: result.providerPaymentId ?? payment.providerPaymentId,
          providerTransactionHash: result.providerTransactionHash ?? null
        }
      });

      if (claim.count === 0) {
        return;
      }

      transitioned = true;

      if (payment.orderId) {
        const order = await tx.order.findUnique({ where: { id: payment.orderId } });

        if (order && order.status !== 'PAID' && order.status !== 'COMPLETED') {
          await tx.order.update({
            where: { id: payment.orderId },
            data: {
              status: 'PAID',
              paidAt
            }
          });
        }

        const reservedStock = await tx.productStock.findMany({
          where: { orderId: payment.orderId, status: 'RESERVED' }
        });

        if (reservedStock.length > 0) {
          await tx.productStock.updateMany({
            where: { orderId: payment.orderId, status: 'RESERVED' },
            data: { status: 'SOLD', soldAt: new Date() }
          });
        }
      }

      if (!payment.orderId && this.walletService) {
        await this.walletService.creditDeposit({
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          userId: payment.userId,
          reference: payment.reference
        }, tx);
      }

      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          eventType: 'payment_succeeded',
          payload: {
              providerPaymentId: result.providerPaymentId,
              providerReference: result.providerReference,
              providerTransactionHash: result.providerTransactionHash,
              paidAt
            }
        }
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        console.warn(`[PaymentService] Payment ${payment.id} rejected: provider transaction hash already recorded for another payment. No credit applied.`);
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED' }
        });
        return false;
      }
      throw error;
    }

    if (transitioned && payment.orderId && this.notificationService) {
      void this.notifyOrderPaid(payment.orderId);
      void this.createCustomerOrderNotification(payment.orderId);
    }

    return transitioned;
  }

  private async createCustomerOrderNotification(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, user: { select: { id: true } } }
      });
      if (!order) return;

      const productNames = order.items.map((item) => item.productNameSnapshot).join(', ');
      
      await this.prisma.customerNotification.create({
        data: {
          userId: order.userId,
            type: 'ORDER_PAID',
            title: 'Payment Confirmed',
            message: `Your order #${order.orderNumber} for ${productNames} has been paid successfully.`,
            orderId: order.id,
            dedupeKey: `order:${order.id}:ORDER_PAID`
          }
      });
    } catch (error) {
      console.error('Failed to create customer notification:', error);
    }
  }

  private async notifyOrderPaid(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true }
      });
      if (!order || !this.notificationService) return;

      await this.notificationService.sendNewOrderNotification({
        orderNumber: order.orderNumber,
        items: order.items.map((item) => ({
          productName: item.productNameSnapshot,
          quantity: item.quantitySnapshot
        })),
        total: order.total.toString(),
        currency: order.currency
      });
    } catch (error) {
      console.error('Failed to send order notification.', error);
    }
  }

  private async handleFailedPayment(payment: { id: string; orderId?: string | null }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const transition = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'FAILED' }
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
          paymentId: payment.id,
          eventType: 'payment_failed',
          payload: { orderId: payment.orderId }
        }
      });
    });
  }
}
