import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { DefaultPaymentProviderFactory, PaymentService } from './payment.service.js';
import { BasePaymentProvider } from './provider.js';
import type {
  CreatePaymentParams,
  CreatePaymentResult,
  ExpirePaymentParams,
  ExpirePaymentResult,
  GetPaymentStatusParams,
  GetPaymentStatusResult,
  VerifyPaymentParams,
  VerifyPaymentResult
} from './provider.js';
import type { CustomerWalletService } from '../wallet.service.js';

class FakeQrProvider extends BasePaymentProvider {
  readonly name = 'Fake KHQR Provider';
  readonly providerType = 'KHQR' as const;
  private succeedOnVerify = false;
  private failOnVerify = false;
  private pendingError = 'Waiting for payment';

  setSucceedOnVerify(value: boolean): void {
    this.succeedOnVerify = value;
    this.failOnVerify = false;
  }

  setFailOnVerify(value: boolean): void {
    this.failOnVerify = value;
    this.succeedOnVerify = false;
  }

  setPendingError(message: string): void {
    this.pendingError = message;
    this.succeedOnVerify = false;
    this.failOnVerify = false;
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    return {
      success: true,
      reference: params.reference,
      providerPaymentId: 'fakemd5abcdef0123456789abcdef0123',
      expiresAt: params.expiresAt,
      qrCodeData: '0002010102122930012345678901234',
      qrCodeImage: 'data:image/png;base64,ZmFrZWltYWdl',
      metadata: { md5: 'fakemd5abcdef0123456789abcdef0123' }
    };
  }

  async verifyPayment(_params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    if (this.failOnVerify) {
      return { success: false, status: 'FAILED', providerPaymentId: 'fakemd5abcdef0123456789abcdef0123', error: 'Payment failed' };
    }
    if (this.succeedOnVerify) {
      return {
        success: true,
        status: 'SUCCEEDED',
        providerPaymentId: 'fakemd5abcdef0123456789abcdef0123',
        providerTransactionHash: 'provider-hash-1',
        paidAt: new Date()
      };
    }
    return { success: false, status: 'PENDING', providerPaymentId: 'fakemd5abcdef0123456789abcdef0123', error: this.pendingError };
  }

  async getPaymentStatus(_params: GetPaymentStatusParams): Promise<GetPaymentStatusResult> {
    return { success: true, status: 'PENDING' };
  }

  async expirePayment(_params: ExpirePaymentParams): Promise<ExpirePaymentResult> {
    return { success: true };
  }
}

function makeMockPrisma() {
  const prisma = {
    payment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn()
    },
    order: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    productStock: {
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    paymentEvent: {
      create: vi.fn()
    }
  };

  const tx = {
    payment: prisma.payment,
    order: prisma.order,
    productStock: prisma.productStock,
    paymentEvent: prisma.paymentEvent
  };

  prisma.payment.$transaction = undefined as never;
  (prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(tx)
  );

  return { prisma: prisma as unknown as PrismaClient, tx };
}

const ORDER_ROW = {
  id: 'order-1',
  userId: 'user-1',
  status: 'DRAFT',
  currency: 'USD',
  subtotal: 2.6,
  discount: 0,
  total: 2.6,
  items: []
};

const PAYMENT_ROW = {
  id: 'payment-1',
  orderId: 'order-1',
  userId: 'user-1',
  provider: 'KHQR',
  status: 'PENDING',
  amount: 2.6,
  currency: 'USD',
  reference: 'pay-1',
  providerPaymentId: 'fakemd5abcdef0123456789abcdef0123',
  idempotencyKey: 'idem-1',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  paidAt: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  order: ORDER_ROW
};

describe('PaymentService', () => {
  let factory: DefaultPaymentProviderFactory;
  let provider: FakeQrProvider;
  let walletService: { creditDeposit: ReturnType<typeof vi.fn> };
  let mock: ReturnType<typeof makeMockPrisma>;
  let service: PaymentService;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();

    mock = makeMockPrisma();
    mock.prisma.payment.findMany.mockResolvedValue([]);
    mock.prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    factory = new DefaultPaymentProviderFactory();
    provider = new FakeQrProvider();
    factory.registerProvider('KHQR', provider);
    walletService = { creditDeposit: vi.fn().mockResolvedValue(undefined) };
    service = new PaymentService(mock.prisma, factory, walletService as unknown as CustomerWalletService);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('createDepositPayment', () => {
    it('creates a PENDING deposit payment with QR data without touching the wallet', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.payment.findFirst.mockResolvedValue(null);
      mock.prisma.payment.create.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, reference: 'dep-1', idempotencyKey: 'idem-dep-1' });

      const result = await service.createDepositPayment('user-1', '5.00', 'USD', 'idem-dep-1');

      expect(result.success).toBe(true);
      expect(result.payment?.qrCodeData).toBe('0002010102122930012345678901234');
      expect(result.payment?.qrCodeImage).toMatch(/^data:image\/png;base64,/);
      expect(result.payment?.reference).toBe('dep-1');
      expect(result.payment?.expiresAt).toBeInstanceOf(Date);
      expect(mock.prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: null, status: 'PENDING', userId: 'user-1', amount: expect.any(Object) })
        })
      );
      expect(walletService.creditDeposit).not.toHaveBeenCalled();
    });

    it('resumes an existing active deposit session when the requested amount matches', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      const activeRow = {
        ...PAYMENT_ROW,
        orderId: null,
        reference: 'dep-active',
        idempotencyKey: 'idem-dep-2',
        amount: new Prisma.Decimal('5.00')
      };
      mock.prisma.payment.findFirst.mockResolvedValue(activeRow);

      const result = await service.createDepositPayment('user-1', '5.00', 'USD', 'idem-dep-2');

      expect(result.success).toBe(true);
      expect(result.resumed).toBe(true);
      expect(result.payment?.id).toBe('payment-1');
      expect(result.payment?.reference).toBe('dep-active');
      expect(result.payment?.amount).toBe('5.00');
      expect(mock.prisma.payment.create).not.toHaveBeenCalled();
    });

    it('does not resume or change an active PENDING deposit when the requested amount differs', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      const activeRow = {
        ...PAYMENT_ROW,
        orderId: null,
        reference: 'dep-active',
        idempotencyKey: 'idem-dep-2',
        amount: new Prisma.Decimal('1.00')
      };
      mock.prisma.payment.findFirst.mockResolvedValue(activeRow);

      const result = await service.createDepositPayment('user-1', '1.50', 'USD', 'idem-dep-3');

      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
      expect(result.activePayment?.id).toBe('payment-1');
      expect(result.activePayment?.amount).toBe('1.00');
      expect(result.activePayment?.currency).toBe('USD');
      expect(mock.prisma.payment.create).not.toHaveBeenCalled();
      expect(mock.prisma.payment.update).not.toHaveBeenCalled();
    });

    it('creates a new deposit with the requested amount after the old one is cancelled', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.payment.findFirst.mockResolvedValue(null);
      mock.prisma.payment.create.mockResolvedValue({
        ...PAYMENT_ROW,
        orderId: null,
        amount: new Prisma.Decimal('1.50'),
        reference: 'dep-after-cancel',
        idempotencyKey: 'idem-dep-4'
      });

      const result = await service.createDepositPayment('user-1', '1.50', 'USD', 'idem-dep-4');

      expect(result.success).toBe(true);
      expect(result.resumed).toBeUndefined();
      expect(mock.prisma.payment.create).toHaveBeenCalledTimes(1);
      const created = mock.prisma.payment.create.mock.calls[0]?.[0].data;
      expect(created?.amount.toFixed(2)).toBe('1.50');
      expect(created?.reference).toMatch(/^JR-DP-[A-Z0-9-]+$/);
      expect(result.payment?.reference).toBe('dep-after-cancel');
    });

    it.each([
      ['1.50', '1.50'],
      ['2.75', '2.75']
    ])('creates a deposit payment for exactly %s USD', async (input, expected) => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.payment.findFirst.mockResolvedValue(null);
      mock.prisma.payment.create.mockResolvedValue({
        ...PAYMENT_ROW,
        orderId: null,
        amount: new Prisma.Decimal(expected),
        reference: `dep-${expected}`,
        idempotencyKey: `idem-${expected}`
      });
      const createSpy = vi.spyOn(provider, 'createPayment');

      const result = await service.createDepositPayment('user-1', input, 'USD', `idem-${expected}`);

      expect(result.success).toBe(true);
      expect(result.payment?.amount).toBe(expected);
      expect(result.payment?.currency).toBe('USD');
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ amount: expected, currency: 'USD' })
      );
      const created = mock.prisma.payment.create.mock.calls[0]?.[0].data;
      expect(created?.amount.toFixed(2)).toBe(expected);
      expect(created?.currency).toBe('USD');
    });

    it('creates a fresh payment session after the previous deposit is PAID', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.payment.findFirst.mockResolvedValue(null);
      mock.prisma.payment.create.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, reference: 'dep-2', idempotencyKey: 'idem-dep-2' });

      const result = await service.createDepositPayment('user-1', '5.00', 'USD', 'idem-dep-2');

      expect(result.success).toBe(true);
      expect(result.resumed).toBeUndefined();
      expect(mock.prisma.payment.create).toHaveBeenCalledTimes(1);
      const created = mock.prisma.payment.create.mock.calls[0]?.[0].data;
      expect(created?.reference).toMatch(/^JR-DP-[A-Z0-9-]+$/);
      expect(created?.reference.length).toBeLessThanOrEqual(25);
    });

    it('lazily expires overdue deposits before creating a new one', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      const overdueRow = { ...PAYMENT_ROW, orderId: null, expiresAt: new Date(Date.now() - 60 * 1000) };
      mock.prisma.payment.findMany.mockResolvedValue([{ id: overdueRow.id }]);
      mock.prisma.payment.findFirst.mockResolvedValue(null);
      mock.prisma.payment.findUnique.mockResolvedValueOnce(null);
      mock.prisma.payment.findUnique.mockResolvedValue(overdueRow);
      mock.prisma.payment.create.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, reference: 'dep-new', idempotencyKey: 'idem-dep-3' });

      const result = await service.createDepositPayment('user-1', '5.00', 'USD', 'idem-dep-3');

      expect(result.success).toBe(true);
      expect(result.resumed).toBeUndefined();
      expect(result.payment?.reference).toBe('dep-new');
      expect(mock.prisma.payment.create).toHaveBeenCalledTimes(1);
      const expiredUpdates = mock.prisma.payment.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'EXPIRED'
      );
      expect(expiredUpdates).toHaveLength(1);
    });

    it('credits the wallet exactly once when verification succeeds, even when called twice', async () => {
      provider.setSucceedOnVerify(true);
      mock.prisma.payment.findUnique
        .mockResolvedValueOnce({ ...PAYMENT_ROW, orderId: null, reference: 'dep-1', idempotencyKey: 'idem-dep-1' })
        .mockResolvedValue({ ...PAYMENT_ROW, orderId: null, reference: 'dep-1', idempotencyKey: 'idem-dep-1' });
      mock.prisma.payment.create.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, reference: 'dep-1', idempotencyKey: 'idem-dep-1' });
      let claimed = false;
      mock.prisma.payment.updateMany.mockImplementation(async () => {
        if (claimed) return { count: 0 };
        claimed = true;
        return { count: 1 };
      });

      const first = await service.verifyPayment('payment-1');
      const second = await service.verifyPayment('payment-1');

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(walletService.creditDeposit).toHaveBeenCalledTimes(1);
      expect(walletService.creditDeposit).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'payment-1', userId: 'user-1', reference: 'dep-1' }),
        expect.anything()
      );
    });

    it('never marks a deposit paid merely because a QR was generated', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.payment.findFirst.mockResolvedValue(null);
      mock.prisma.payment.create.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, reference: 'dep-1', idempotencyKey: 'idem-dep-1' });

      const result = await service.createDepositPayment('user-1', '5.00', 'USD', 'idem-dep-1');

      expect(result.success).toBe(true);
      const createdData = mock.prisma.payment.create.mock.calls[0]?.[0].data;
      expect(createdData?.status).toBe('PENDING');
      expect(walletService.creditDeposit).not.toHaveBeenCalled();
    });
  });

  describe('createPayment (order)', () => {
    it('creates a PENDING payment with QR data and puts the order in PAYMENT_PENDING', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
      mock.prisma.payment.findFirst.mockResolvedValue(null);
      mock.prisma.payment.create.mockResolvedValue(PAYMENT_ROW);

      const result = await service.createPayment('user-1', 'order-1', 'KHQR', 'idem-1');

      expect(result.success).toBe(true);
      expect(result.payment?.qrCodeData).toBe('0002010102122930012345678901234');
      expect(result.payment?.qrCodeImage).toMatch(/^data:image\/png;base64,/);
      expect(mock.prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PAYMENT_PENDING' }) })
      );
      const createdData = mock.prisma.payment.create.mock.calls[0]?.[0].data;
      expect(createdData?.status).toBe('PENDING');
      expect(createdData?.amount.toString()).toBe('2.6');
      expect(createdData?.reference.length).toBeLessThanOrEqual(25);
      expect(createdData?.reference).toMatch(/^JR-OR-[A-Z0-9-]+$/);
    });

    it('uses the exact server-calculated order total for the QR', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
      mock.prisma.payment.findFirst.mockResolvedValue(null);
      mock.prisma.payment.create.mockResolvedValue(PAYMENT_ROW);
      const createSpy = vi.spyOn(provider, 'createPayment');

      await service.createPayment('user-1', 'order-1', 'KHQR', 'idem-order-total');

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '2.6', currency: 'USD' })
      );
    });

    it('rejects payment for an order that is already paid', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.order.findUnique.mockResolvedValue({ ...ORDER_ROW, status: 'PAID' });
      mock.prisma.payment.findFirst.mockResolvedValue(null);

      const result = await service.createPayment('user-1', 'order-1', 'KHQR', 'idem-2');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already paid');
      expect(mock.prisma.payment.create).not.toHaveBeenCalled();
    });

    it('rejects payment for an order owned by another user', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.order.findUnique.mockResolvedValue({ ...ORDER_ROW, userId: 'other-user' });

      const result = await service.createPayment('user-1', 'order-1', 'KHQR', 'idem-3');

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not belong');
    });
  });

  describe('verifyPayment (order)', () => {
    it('marks the order PAID and stock SOLD only once on duplicate confirmations', async () => {
      provider.setSucceedOnVerify(true);
      mock.prisma.payment.findUnique
        .mockResolvedValueOnce(PAYMENT_ROW)
        .mockResolvedValue(PAYMENT_ROW);
      mock.prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
      mock.prisma.productStock.findMany.mockResolvedValue([{ id: 'stock-1', orderId: 'order-1', status: 'RESERVED' }]);
      mock.prisma.payment.update.mockResolvedValue({ ...PAYMENT_ROW, status: 'SUCCEEDED' });
      let claimed = false;
      mock.prisma.payment.updateMany.mockImplementation(async () => {
        if (claimed) return { count: 0 };
        claimed = true;
        return { count: 1 };
      });

      await service.verifyPayment('payment-1');
      await service.verifyPayment('payment-1');

      expect(claimed).toBe(true);

      const paidUpdates = mock.prisma.order.update.mock.calls.filter(
        (call) => call[0]?.data?.status === 'PAID'
      );
      expect(paidUpdates).toHaveLength(1);

      const soldUpdates = mock.prisma.productStock.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'SOLD'
      );
      expect(soldUpdates).toHaveLength(1);
    });

    it('does not fulfill or mark paid while the provider reports pending', async () => {
      provider.setSucceedOnVerify(false);
      mock.prisma.payment.findUnique.mockResolvedValue(PAYMENT_ROW);

      const result = await service.verifyPayment('payment-1');

      expect(result.success).toBe(false);
      expect(result.status).toBe('PENDING');
      expect(mock.prisma.payment.update).not.toHaveBeenCalled();
      expect(mock.prisma.order.update).not.toHaveBeenCalled();
      expect(mock.prisma.productStock.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('verifyPayment (one-time enforcement)', () => {
    it('expires a PENDING payment past its QR expiry without asking the provider or crediting', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, expiresAt: new Date(Date.now() - 1000) });
      const verifySpy = vi.spyOn(provider, 'verifyPayment');

      const result = await service.verifyPayment('payment-1');

      expect(result.success).toBe(false);
      expect(result.status).toBe('EXPIRED');
      expect(verifySpy).not.toHaveBeenCalled();
      expect(walletService.creditDeposit).not.toHaveBeenCalled();
      const expiredUpdates = mock.prisma.payment.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'EXPIRED'
      );
      expect(expiredUpdates).toHaveLength(1);
    });

    it('does not re-credit or re-verify an already SUCCEEDED payment', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, status: 'SUCCEEDED', paidAt: new Date() });
      const verifySpy = vi.spyOn(provider, 'verifyPayment');

      const result = await service.verifyPayment('payment-1');

      expect(result.success).toBe(true);
      expect(result.status).toBe('SUCCEEDED');
      expect(verifySpy).not.toHaveBeenCalled();
      expect(walletService.creditDeposit).not.toHaveBeenCalled();
    });

    it('passes the server-side amount and currency as expectations to the provider', async () => {
      provider.setSucceedOnVerify(true);
      mock.prisma.payment.findUnique.mockResolvedValue(PAYMENT_ROW);
      mock.prisma.productStock.findMany.mockResolvedValue([]);
      const verifySpy = vi.spyOn(provider, 'verifyPayment');

      const result = await service.verifyPayment('payment-1');

      expect(result.success).toBe(true);
      expect(verifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ expectedAmount: '2.6', expectedCurrency: 'USD' })
      );
    });

    it('does not credit the wallet when the provider reports a failed payment', async () => {
      provider.setFailOnVerify(true);
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, reference: 'dep-1', idempotencyKey: 'idem-dep-1' });

      const result = await service.verifyPayment('payment-1');

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(walletService.creditDeposit).not.toHaveBeenCalled();
       const failedUpdates = mock.prisma.payment.updateMany.mock.calls.filter(
         (call) => call[0]?.data?.status === 'FAILED'
       );
      expect(failedUpdates).toHaveLength(1);
    });

    it('releases reserved stock back to available when an order payment fails', async () => {
      provider.setFailOnVerify(true);
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, orderId: 'order-1' });
      mock.prisma.productStock.findMany.mockResolvedValue([
        { id: 'stock-1', productId: 'product-1', status: 'RESERVED', orderId: 'order-1' }
      ]);

      const result = await service.verifyPayment('payment-1');

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      const failedPaymentUpdate = mock.prisma.payment.updateMany.mock.calls.find(
        (call) => call[0]?.data?.status === 'FAILED'
      );
      expect(failedPaymentUpdate).toBeDefined();
      const releasedStockUpdate = mock.prisma.productStock.updateMany.mock.calls.find(
        (call) => call[0]?.data?.status === 'AVAILABLE'
      );
      expect(releasedStockUpdate).toBeDefined();
      expect(releasedStockUpdate[0].where).toEqual(
        expect.objectContaining({ orderId: 'order-1', status: 'RESERVED' })
      );
      const orderUpdate = mock.prisma.order.update.mock.calls.find(
        (call) => call[0]?.data?.status === 'DRAFT'
      );
      expect(orderUpdate).toBeDefined();
    });

    it('stores the provider transaction hash inside the claim transaction', async () => {
      provider.setSucceedOnVerify(true);
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, reference: 'dep-1', idempotencyKey: 'idem-dep-1' });

      const result = await service.verifyPayment('payment-1');

      expect(result.success).toBe(true);
      const claim = mock.prisma.payment.updateMany.mock.calls.find(
        (call) => call[0]?.data?.status === 'SUCCEEDED'
      )?.[0];
      expect(claim?.data?.providerTransactionHash).toBe('provider-hash-1');
      expect(walletService.creditDeposit).toHaveBeenCalledTimes(1);
    });

    it('rejects a second payment verified with the same provider transaction hash without crediting', async () => {
      provider.setSucceedOnVerify(true);
      mock.prisma.payment.findUnique
        .mockResolvedValueOnce({ ...PAYMENT_ROW, orderId: null, reference: 'dep-1', idempotencyKey: 'idem-dep-1' })
        .mockResolvedValueOnce({ ...PAYMENT_ROW, id: 'payment-2', orderId: null, reference: 'dep-2', idempotencyKey: 'idem-dep-2' })
        .mockResolvedValue({ ...PAYMENT_ROW, id: 'payment-2', orderId: null, reference: 'dep-2', status: 'FAILED', idempotencyKey: 'idem-dep-2' });
      mock.prisma.payment.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockImplementationOnce(async () => {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on providerTransactionHash',
            { code: 'P2002', clientVersion: 'test' }
          );
        });

      const first = await service.verifyPayment('payment-1');
      const second = await service.verifyPayment('payment-2');

      expect(first.success).toBe(true);
      expect(first.status).toBe('SUCCEEDED');
      expect(second.success).toBe(false);
      expect(second.status).toBe('FAILED');
      expect(walletService.creditDeposit).toHaveBeenCalledTimes(1);
       const failedUpdates = mock.prisma.payment.update.mock.calls.filter(
         (call) => call[0]?.data?.status === 'FAILED'
       );
      expect(failedUpdates).toHaveLength(1);
    });

    it('credits the wallet exactly once when two verification requests race', async () => {
      provider.setSucceedOnVerify(true);
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, orderId: null, reference: 'dep-1', idempotencyKey: 'idem-dep-1' });
      let claimed = false;
      mock.prisma.payment.updateMany.mockImplementation(async () => {
        if (claimed) return { count: 0 };
        claimed = true;
        return { count: 1 };
      });

      await Promise.all([
        service.verifyPayment('payment-1'),
        service.verifyPayment('payment-1')
      ]);

      expect(walletService.creditDeposit).toHaveBeenCalledTimes(1);
      const succeededClaims = mock.prisma.payment.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'SUCCEEDED'
      );
      expect(succeededClaims).toHaveLength(2);
    });
  });

  describe('cancelPayment (KHQR cancel/payment race)', () => {
    it('cancels a genuinely pending payment after an authoritative recheck', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(PAYMENT_ROW);
      mock.prisma.productStock.findMany.mockResolvedValue([]);

      const result = await service.cancelPayment('payment-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.status).toBe('EXPIRED');
      expect(result.cancelled).toBe(true);
      const expiredUpdates = mock.prisma.payment.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'EXPIRED'
      );
      expect(expiredUpdates).toHaveLength(1);
      const draftUpdate = mock.prisma.order.update.mock.calls.find(
        (call) => call[0]?.data?.status === 'DRAFT'
      );
      expect(draftUpdate).toBeDefined();
    });

    it('never lets a cancel turn an already SUCCEEDED payment back into an unpaid state', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, status: 'SUCCEEDED', paidAt: new Date() });
      const verifySpy = vi.spyOn(provider, 'verifyPayment');

      const result = await service.cancelPayment('payment-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.paid).toBe(true);
      expect(result.alreadyTerminal).toBe(true);
      expect(verifySpy).not.toHaveBeenCalled();
      expect(mock.prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('lets a server-verified payment win the race against a cancel request', async () => {
      provider.setSucceedOnVerify(true);
      mock.prisma.payment.findUnique.mockResolvedValue(PAYMENT_ROW);
      mock.prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
      mock.prisma.productStock.findMany.mockResolvedValue([
        { id: 'stock-1', orderId: 'order-1', status: 'RESERVED' }
      ]);

      const result = await service.cancelPayment('payment-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.status).toBe('SUCCEEDED');
      expect(result.paid).toBe(true);
      expect(result.cancelled).toBeUndefined();

      const expiredUpdates = mock.prisma.payment.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'EXPIRED'
      );
      expect(expiredUpdates).toHaveLength(0);

      const paidUpdates = mock.prisma.order.update.mock.calls.filter(
        (call) => call[0]?.data?.status === 'PAID'
      );
      expect(paidUpdates).toHaveLength(1);

      const soldUpdates = mock.prisma.productStock.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'SOLD'
      );
      expect(soldUpdates).toHaveLength(1);
    });

    it('refuses to cancel when the provider cannot confirm the payment is unpaid', async () => {
      provider.setPendingError('Bakong provider connectivity is blocked');
      mock.prisma.payment.findUnique.mockResolvedValue(PAYMENT_ROW);

      const result = await service.cancelPayment('payment-1', 'user-1');

      expect(result.success).toBe(false);
      expect(result.status).toBe('PENDING');
      expect(result.error).toContain('could not be confirmed');
      const expiredUpdates = mock.prisma.payment.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'EXPIRED'
      );
      expect(expiredUpdates).toHaveLength(0);
    });

    it('cancelling an already cancelled payment is idempotent', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, status: 'CANCELLED' });

      const result = await service.cancelPayment('payment-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.status).toBe('CANCELLED');
      expect(result.alreadyTerminal).toBe(true);
      expect(mock.prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('reports an expired session as EXPIRED instead of cancelling it', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue({
        ...PAYMENT_ROW,
        expiresAt: new Date(Date.now() - 60_000)
      });
      mock.prisma.productStock.findMany.mockResolvedValue([]);

      const result = await service.cancelPayment('payment-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.status).toBe('EXPIRED');
      const expiredUpdates = mock.prisma.payment.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'EXPIRED'
      );
      expect(expiredUpdates).toHaveLength(1);
    });

    it('rejects cancellation of another users payment', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, userId: 'other-user' });

      const result = await service.cancelPayment('payment-1', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Payment not found');
    });

    it('does not claim a payment that was paid after it was cancelled', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue({ ...PAYMENT_ROW, status: 'CANCELLED' });

      const result = await service.verifyPayment('payment-1');

      expect(result.success).toBe(false);
      expect(result.status).toBe('CANCELLED');
      expect(mock.prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(mock.prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('createPayment (one QR per order)', () => {
    it('never creates a second QR while the first payment is still active', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(null);
      mock.prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
      mock.prisma.payment.findFirst.mockResolvedValue({
        ...PAYMENT_ROW,
        amount: new Prisma.Decimal('2.60'),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      });

      const result = await service.createPayment('user-1', 'order-1', 'KHQR', 'idem-race-1');

      expect(result.success).toBe(true);
      expect(result.resumed).toBe(true);
      expect(mock.prisma.payment.create).not.toHaveBeenCalled();
    });

    it('only regenerates a QR when the previous payment is no longer active', async () => {
      mock.prisma.payment.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...PAYMENT_ROW,
          expiresAt: new Date(Date.now() - 60_000)
        });
      mock.prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
      mock.prisma.payment.findFirst.mockResolvedValue({
        ...PAYMENT_ROW,
        amount: new Prisma.Decimal('2.60'),
        expiresAt: new Date(Date.now() - 60_000)
      });
      mock.prisma.productStock.findMany.mockResolvedValue([]);
      mock.prisma.payment.create.mockResolvedValue({
        ...PAYMENT_ROW,
        amount: new Prisma.Decimal('2.60'),
        reference: 'pay-new'
      });

      const result = await service.createPayment('user-1', 'order-1', 'KHQR', 'idem-race-2');

      expect(result.success).toBe(true);
      expect(result.resumed).toBeUndefined();
      expect(mock.prisma.payment.create).toHaveBeenCalledTimes(1);
      const expiredUpdates = mock.prisma.payment.updateMany.mock.calls.filter(
        (call) => call[0]?.data?.status === 'EXPIRED'
      );
      expect(expiredUpdates).toHaveLength(1);
    });
  });

  describe('getPaymentStatus', () => {
    it('reports the payment to the owning user only', async () => {
      mock.prisma.payment.findUnique.mockResolvedValue(PAYMENT_ROW);

      const owner = await service.getPaymentStatus('payment-1', 'user-1');
      expect(owner.success).toBe(true);
      expect(owner.payment?.status).toBe('PENDING');

      const stranger = await service.getPaymentStatus('payment-1', 'other-user');
      expect(stranger.success).toBe(false);
      expect(stranger.error).toContain('not found');
    });
  });
});
