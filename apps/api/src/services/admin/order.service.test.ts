import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { OrderService } from './order.service.js';
import type { CustomerWalletService } from '../wallet.service.js';

function makeMockPrisma() {
  const prisma = {
    order: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn()
    },
    payment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    productStock: {
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    }
  };

  const tx = {
    order: prisma.order,
    payment: prisma.payment,
    productStock: prisma.productStock,
    auditLog: prisma.auditLog
  };

  (prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(tx)
  );

  return { prisma: prisma as unknown as PrismaClient, tx };
}

const USER_ROW = {
  id: 'user-1',
  firstName: 'John',
  lastName: 'Doe',
  username: 'johndoe',
  telegramId: BigInt(123456789)
};

function orderRow(status: string, provider: string = 'WALLET') {
  return {
    id: 'order-1',
    orderNumber: 59,
    userId: 'user-1',
    status,
    currency: 'USD',
    total: new Prisma.Decimal('2.60'),
    user: USER_ROW,
    payments: [
      {
        id: 'payment-1',
        orderId: 'order-1',
        userId: 'user-1',
        provider,
        status: 'SUCCEEDED',
        amount: new Prisma.Decimal('2.60'),
        currency: 'USD',
        reference: provider === 'WALLET' ? 'wallet_abc' : 'JR-OR-REF1',
        providerTransactionHash: provider === 'WALLET' ? null : 'bakong-hash-1',
        idempotencyKey: 'idem-1'
      }
    ]
  };
}

const REFUND_RECORD_ROW = {
  id: 'refund-payment-1',
  orderId: 'order-1',
  status: 'REFUNDED',
  metadata: { kind: 'refund' }
};

describe('OrderService refunds', () => {
  let mock: ReturnType<typeof makeMockPrisma>;
  let walletService: { refundDeposit: ReturnType<typeof vi.fn> };
  let service: OrderService;

  beforeEach(() => {
    mock = makeMockPrisma();
    walletService = { refundDeposit: vi.fn().mockResolvedValue(undefined) };
    service = new OrderService(mock.prisma, walletService as unknown as CustomerWalletService);
    mock.prisma.order.updateMany.mockResolvedValue({ count: 1 });
    mock.prisma.productStock.findMany.mockResolvedValue([]);
    mock.prisma.payment.findFirst.mockResolvedValue(null);
    mock.prisma.payment.create.mockResolvedValue({ id: 'refund-payment-1' });
    mock.prisma.payment.update.mockResolvedValue({ id: 'payment-1', status: 'REFUNDED' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('refunds a wallet-paid order: credits the wallet once, marks order and payment REFUNDED', async () => {
    mock.prisma.order.findUnique.mockResolvedValue(orderRow('PAID'));

    const result = await service.refundOrder('order-1', 'admin-1', 'Customer requested');

    expect(result.success).toBe(true);
    expect(result.provider).toBe('WALLET');
    expect(result.externalRefundRequired).toBe(false);
    expect(result.amountRefunded).toBe('2.60');

    const claim = mock.prisma.order.updateMany.mock.calls.find(
      (call) => call[0]?.data?.status === 'REFUNDED'
    );
    expect(claim?.[0].where).toEqual(expect.objectContaining({ id: 'order-1', status: { in: ['PAID', 'COMPLETED'] } }));

    const paymentUpdate = mock.prisma.payment.update.mock.calls.find(
      (call) => call[0]?.data?.status === 'REFUNDED'
    );
    expect(paymentUpdate).toBeDefined();

    expect(walletService.refundDeposit).toHaveBeenCalledTimes(1);
    expect(walletService.refundDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'payment-1', amount: expect.any(Prisma.Decimal), userId: 'user-1', reference: 'wallet_abc' }),
      expect.anything(),
      'Admin refund: Customer requested'
    );

    const refundRecord = mock.prisma.payment.create.mock.calls.find(
      (call) => call[0]?.data?.status === 'REFUNDED'
    );
    expect(refundRecord?.[0].data.metadata).toEqual(
      expect.objectContaining({
        kind: 'refund',
        originalPaymentId: 'payment-1',
        originalReference: 'wallet_abc',
        refundedAmount: '2.60'
      })
    );

    const audit = mock.prisma.auditLog.create.mock.calls[0]?.[0]?.data;
    expect(audit?.adminId).toBe('admin-1');
    expect(audit?.action).toBe('REFUND');
    expect(audit?.entityId).toBe('order-1');
    expect(audit?.newValue).toEqual(
      expect.objectContaining({
        status: 'REFUNDED',
        amount: '2.60',
        reason: 'Customer requested',
        result: 'REFUNDED'
      })
    );
    expect(audit?.oldValue).toEqual(expect.objectContaining({ orderNumber: 59 }));
    expect(audit?.oldValue.customer).toEqual(
      expect.objectContaining({ customerId: 'ID123456789', firstName: 'John' })
    );
  });

  it('releases delivered stock back to available on refund', async () => {
    mock.prisma.order.findUnique.mockResolvedValue(orderRow('COMPLETED'));
    mock.prisma.productStock.findMany.mockResolvedValue([
      { id: 'stock-1', orderId: 'order-1', status: 'SOLD' }
    ]);

    await service.refundOrder('order-1', 'admin-1');

    const release = mock.prisma.productStock.updateMany.mock.calls.find(
      (call) => call[0]?.data?.status === 'AVAILABLE'
    );
    expect(release).toBeDefined();
    expect(release?.[0].where).toEqual(
      expect.objectContaining({ orderId: 'order-1', status: { in: ['RESERVED', 'SOLD'] } })
    );
  });

  it('is idempotent: a duplicate refund does not credit the wallet or audit again', async () => {
    mock.prisma.order.findUnique.mockResolvedValue(orderRow('REFUNDED'));
    mock.prisma.payment.findFirst.mockResolvedValue(REFUND_RECORD_ROW);

    const result = await service.refundOrder('order-1', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.idempotent).toBe(true);
    expect(walletService.refundDeposit).not.toHaveBeenCalled();
    expect(mock.prisma.auditLog.create).not.toHaveBeenCalled();
    expect(mock.prisma.payment.create).not.toHaveBeenCalled();
  });

  it('survives the concurrent-refund race: a lost claim returns idempotent success', async () => {
    mock.prisma.order.findUnique.mockResolvedValue(orderRow('PAID'));
    mock.prisma.order.updateMany.mockResolvedValue({ count: 0 });
    mock.prisma.payment.findFirst.mockResolvedValue(REFUND_RECORD_ROW);

    const result = await service.refundOrder('order-1', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.idempotent).toBe(true);
    expect(walletService.refundDeposit).not.toHaveBeenCalled();
    expect(mock.prisma.payment.create).not.toHaveBeenCalled();
    expect(mock.prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects refunding an unpaid order', async () => {
    mock.prisma.order.findUnique.mockResolvedValue(orderRow('DRAFT'));

    await expect(service.refundOrder('order-1', 'admin-1')).rejects.toThrow('Order not paid, cannot refund');
  });

  it('rejects a refund amount that exceeds the amount actually paid', async () => {
    mock.prisma.order.findUnique.mockResolvedValue(orderRow('PAID'));

    await expect(service.refundOrder('order-1', 'admin-1', undefined, '99.99')).rejects.toThrow('cannot exceed');
    expect(walletService.refundDeposit).not.toHaveBeenCalled();
  });

  it('rejects a negative or malformed refund amount', async () => {
    mock.prisma.order.findUnique.mockResolvedValue(orderRow('PAID'));

    await expect(service.refundOrder('order-1', 'admin-1', undefined, '-5')).rejects.toThrow('positive');
    await expect(service.refundOrder('order-1', 'admin-1', undefined, 'abc')).rejects.toThrow('positive decimal');
    await expect(service.refundOrder('order-1', 'admin-1', undefined, '1.234')).rejects.toThrow('2 decimal places');
    await expect(service.refundOrder('order-1', 'admin-1', undefined, '0')).rejects.toThrow('greater than zero');
    expect(walletService.refundDeposit).not.toHaveBeenCalled();
  });

  it('supports a partial refund amount without exceeding the paid amount', async () => {
    mock.prisma.order.findUnique.mockResolvedValue(orderRow('PAID'));

    const result = await service.refundOrder('order-1', 'admin-1', undefined, '1.00');

    expect(result.amountRefunded).toBe('1.00');
    expect(walletService.refundDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'payment-1', amount: new Prisma.Decimal('1.00') }),
      expect.anything(),
      'Admin refund'
    );
    const refundRecord = mock.prisma.payment.create.mock.calls.find(
      (call) => call[0]?.data?.status === 'REFUNDED'
    );
    expect(refundRecord?.[0].data.amount).toEqual(new Prisma.Decimal('1.00'));
  });

  it('records a KHQR refund locally without inventing a Bakong reversal', async () => {
    mock.prisma.order.findUnique.mockResolvedValue(orderRow('PAID', 'KHQR'));

    const result = await service.refundOrder('order-1', 'admin-1', 'KHQR refund');

    expect(result.success).toBe(true);
    expect(result.provider).toBe('KHQR');
    expect(result.externalRefundRequired).toBe(true);
    expect(walletService.refundDeposit).not.toHaveBeenCalled();

    const refundRecord = mock.prisma.payment.create.mock.calls.find(
      (call) => call[0]?.data?.status === 'REFUNDED'
    );
    expect(refundRecord?.[0].data.provider).toBe('KHQR');
    expect(refundRecord?.[0].data.metadata).toEqual(
      expect.objectContaining({
        kind: 'refund',
        originalPaymentId: 'payment-1',
        originalReference: 'JR-OR-REF1',
        originalProviderTransactionHash: 'bakong-hash-1'
      })
    );

    // The original Bakong payment record is only marked REFUNDED — never deleted
    const originalUpdate = mock.prisma.payment.update.mock.calls.find(
      (call) => call[0]?.where?.id === 'payment-1'
    );
    expect(originalUpdate?.[0].data.status).toBe('REFUNDED');
  });
});