export interface PaymentProvider {
  readonly name: string;
  readonly providerType: 'KHQR' | 'BAKONG' | 'WALLET' | 'MANUAL' | 'ABA_PAYWAY' | 'KHQRCC';

  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;
  getPaymentStatus(params: GetPaymentStatusParams): Promise<GetPaymentStatusResult>;
  expirePayment(params: ExpirePaymentParams): Promise<ExpirePaymentResult>;
}

export interface CreatePaymentParams {
  orderId: string;
  amount: string;
  currency: string;
  reference: string;
  idempotencyKey: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentResult {
  success: boolean;
  paymentId?: string;
  providerPaymentId?: string;
  reference?: string;
  expiresAt?: Date;
  paymentUrl?: string;
  qrCodeData?: string;
  qrCodeImage?: string;
  merchantName?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface VerifyPaymentParams {
  providerPaymentId?: string;
  reference?: string;
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
  expectedAmount?: string;
  expectedCurrency?: string;
  expectedMerchantAccount?: string;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'EXPIRED' | 'CANCELLED';
  providerPaymentId?: string;
  paidAt?: Date;
  amount?: string;
  currency?: string;
  providerTransactionHash?: string;
  providerReference?: string;
  error?: string;
}

export interface GetPaymentStatusParams {
  providerPaymentId?: string;
  reference?: string;
  expectedAmount?: string;
  expectedCurrency?: string;
}

export interface GetPaymentStatusResult {
  success: boolean;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  providerPaymentId?: string;
  paidAt?: Date;
  amount?: string;
  currency?: string;
  error?: string;
}

export interface ExpirePaymentParams {
  reference?: string;
  providerPaymentId?: string;
}

export interface ExpirePaymentResult {
  success: boolean;
  error?: string;
}

export abstract class BasePaymentProvider implements PaymentProvider {
  abstract readonly name: string;
  abstract readonly providerType: 'KHQR' | 'BAKONG' | 'WALLET' | 'MANUAL' | 'ABA_PAYWAY' | 'KHQRCC';

  isAvailable(): boolean {
    return true;
  }

  getAvailabilityError(): string {
    return `${this.name} is not available`;
  }

  abstract createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  abstract verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;
  abstract getPaymentStatus(params: GetPaymentStatusParams): Promise<GetPaymentStatusResult>;
  abstract expirePayment(params: ExpirePaymentParams): Promise<ExpirePaymentResult>;

  protected generateReference(): string {
    return `pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  protected generateIdempotencyKey(): string {
    return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}
