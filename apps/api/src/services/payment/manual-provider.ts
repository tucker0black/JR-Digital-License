import type { CreatePaymentParams } from './provider.js';
import type { CreatePaymentResult } from './provider.js';
import type { VerifyPaymentParams } from './provider.js';
import type { VerifyPaymentResult } from './provider.js';
import type { GetPaymentStatusParams } from './provider.js';
import type { GetPaymentStatusResult } from './provider.js';
import type { ExpirePaymentParams } from './provider.js';
import type { ExpirePaymentResult } from './provider.js';
import { BasePaymentProvider } from './provider.js';

interface MockPaymentRecord {
  id: string;
  providerPaymentId: string;
  reference: string;
  idempotencyKey: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  amount: string;
  currency: string;
  createdAt: Date;
  paidAt?: Date;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

const mockPayments = new Map<string, MockPaymentRecord>();

export class ManualPaymentProvider extends BasePaymentProvider {
  readonly name = 'Manual Payment Provider';
  readonly providerType = 'MANUAL' as const;

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const providerPaymentId = `manual_${paymentId}`;

    const record: MockPaymentRecord = {
      id: paymentId,
      providerPaymentId,
      reference: params.reference,
      idempotencyKey: params.idempotencyKey,
      status: 'PENDING',
      amount: params.amount,
      currency: params.currency,
      createdAt: new Date(),
      expiresAt: params.expiresAt,
      metadata: params.metadata
    };

    mockPayments.set(params.reference, record);
    mockPayments.set(providerPaymentId, record);

    return {
      success: true,
      paymentId,
      providerPaymentId,
      reference: params.reference,
      expiresAt: params.expiresAt,
      paymentUrl: `/payment/manual/${providerPaymentId}`,
      qrCodeData: JSON.stringify({ type: 'manual', paymentId: providerPaymentId })
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    let record: MockPaymentRecord | undefined;

    if (params.providerPaymentId) {
      record = mockPayments.get(params.providerPaymentId);
    } else if (params.reference) {
      record = mockPayments.get(params.reference);
    } else if (params.idempotencyKey) {
      for (const [, r] of mockPayments) {
        if (r.idempotencyKey === params.idempotencyKey) {
          record = r;
          break;
        }
      }
    }

    if (!record) {
      return { success: false, status: 'FAILED', error: 'Payment not found' };
    }

    if (record.status === 'EXPIRED') {
      return { success: false, status: 'EXPIRED', error: 'Payment expired' };
    }

    if (record.status === 'SUCCEEDED') {
      return { success: true, status: 'SUCCEEDED', providerPaymentId: record.providerPaymentId, paidAt: record.paidAt, amount: record.amount, currency: record.currency };
    }

    if (record.status === 'FAILED' || record.status === 'CANCELLED') {
      return { success: false, status: record.status, error: 'Payment failed or cancelled' };
    }

    return { success: false, status: 'PENDING', error: 'Payment still pending' };
  }

  async getPaymentStatus(params: GetPaymentStatusParams): Promise<GetPaymentStatusResult> {
    let record: MockPaymentRecord | undefined;

    if (params.providerPaymentId) {
      record = mockPayments.get(params.providerPaymentId);
    } else if (params.reference) {
      record = mockPayments.get(params.reference);
    }

    if (!record) {
      return { success: false, status: 'FAILED', error: 'Payment not found' };
    }

    return {
      success: true,
      status: record.status,
      providerPaymentId: record.providerPaymentId,
      paidAt: record.paidAt,
      amount: record.amount,
      currency: record.currency
    };
  }

  async expirePayment(params: ExpirePaymentParams): Promise<ExpirePaymentResult> {
    let record: MockPaymentRecord | undefined;

    if (params.providerPaymentId) {
      record = mockPayments.get(params.providerPaymentId);
    } else if (params.reference) {
      record = mockPayments.get(params.reference);
    }

    if (!record) {
      return { success: false, error: 'Payment not found' };
    }

    if (record.status === 'PENDING' || record.status === 'PROCESSING') {
      record.status = 'EXPIRED';
      return { success: true };
    }

    return { success: false, error: `Cannot expire payment with status ${record.status}` };
  }

  static async simulatePayment(providerPaymentId: string, success: boolean = true): Promise<VerifyPaymentResult> {
    const record = mockPayments.get(providerPaymentId);
    if (!record) {
      return { success: false, status: 'FAILED', error: 'Payment not found' };
    }

    if (success) {
      record.status = 'SUCCEEDED';
      record.paidAt = new Date();
      return { success: true, status: 'SUCCEEDED', providerPaymentId: record.providerPaymentId, paidAt: record.paidAt, amount: record.amount, currency: record.currency };
    } else {
      record.status = 'FAILED';
      return { success: false, status: 'FAILED', error: 'Payment failed' };
    }
  }

  static clearMockData(): void {
    mockPayments.clear();
  }

  static getMockPayment(referenceOrId: string): MockPaymentRecord | undefined {
    return mockPayments.get(referenceOrId);
  }
}