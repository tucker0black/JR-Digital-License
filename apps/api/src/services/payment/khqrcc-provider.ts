import crypto from 'node:crypto';
import type {
  CreatePaymentParams,
  CreatePaymentResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  GetPaymentStatusParams,
  GetPaymentStatusResult,
  ExpirePaymentParams,
  ExpirePaymentResult
} from './provider.js';
import { BasePaymentProvider } from './provider.js';

interface KHQRCCConfig {
  profileId: string;
  secret: string;
  gatewayUrl: string;
}

interface KHQRCCVerifyResponse {
  responseCode?: number;
  responseMessage?: string;
  data?: {
    status?: string;
    transaction_id?: string;
    amount?: number;
    hash?: string;
  };
}

export interface KHQRCCWebhookPayload {
  req_time?: number;
  merchantBakongId?: string;
  transaction_id?: string;
  amount?: number;
  status?: string;
  items?: string;
  custom_fields?: string;
  payment_details?: Record<string, unknown>;
  hash?: string;
}

const DEFAULT_GATEWAY_URL = 'https://khqr.cc/api/payment/requestv2';
const CONNECTIVITY_MESSAGE = 'KHQR.cc payment is blocked by provider connectivity or configuration.';
const MISSING_CONFIGURATION_MESSAGE = 'KHQR.cc payment is not configured. Set KHQRCC_PROFILE_ID and KHQRCC_SECRET.';

export function generateCheckoutHash(secret: string, transactionId: string, amount: string, successUrl: string, remark: string): string {
  const input = secret + transactionId + amount + successUrl + remark;
  return crypto.createHash('sha1').update(input).digest('hex');
}

export function generateWebhookHash(secret: string, reqTime: number, transactionId: string, amount: number, status: string): string {
  const input = secret + reqTime + transactionId + amount + status;
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generateVerificationHash(secret: string, transactionId: string): string {
  const input = secret + transactionId;
  return crypto.createHash('sha1').update(input).digest('hex');
}

function isConnectivityError(message: string): boolean {
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPROTO|self[- ]signed|certificate|DEPTH_ZERO|tls|ssl|socket hang up|network/i.test(message);
}

function redactSensitive(message: string, secret?: string | null): string {
  return secret ? message.split(secret).join('[REDACTED]') : message;
}

function mapProviderError(error: unknown, fallback: string, secret?: string | null): string {
  const message = redactSensitive(error instanceof Error ? error.message : fallback, secret);
  return isConnectivityError(message) ? CONNECTIVITY_MESSAGE : message;
}

function logProviderError(operation: string, error: unknown, secret?: string | null): void {
  const detail = redactSensitive(error instanceof Error ? error.message : String(error), secret);
  if (isConnectivityError(detail)) {
    console.warn(`[KHQRCCPaymentProvider] ${operation} failed due to provider connectivity/TLS.`);
  } else {
    console.warn(`[KHQRCCPaymentProvider] ${operation} failed: ${detail}`);
  }
}

export class KHQRCCPaymentProvider extends BasePaymentProvider {
  readonly name = 'KHQR.cc Payment Provider';
  readonly providerType = 'KHQRCC' as const;

  private config: KHQRCCConfig | null = null;
  private configurationError: string | null = null;

  constructor() {
    super();
    this.initializeConfig();
  }

  private initializeConfig(): void {
    const profileId = process.env.KHQRCC_PROFILE_ID?.trim() || '';
    const secret = process.env.KHQRCC_SECRET?.trim() || '';
    const gatewayUrl = process.env.KHQRCC_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL;

    const missing = [
      !profileId ? 'KHQRCC_PROFILE_ID' : null,
      !secret ? 'KHQRCC_SECRET' : null
    ].filter((key): key is string => key !== null);

    if (missing.length > 0) {
      this.configurationError = `KHQR.cc configuration is incomplete. Missing: ${missing.join(', ')}.`;
      console.info('[KHQRCCPaymentProvider] configuration', { status: 'unconfigured', missing });
      return;
    }

    this.config = { profileId, secret, gatewayUrl };
    console.info('[KHQRCCPaymentProvider] configuration', { status: 'configured', profileId: 'configured', mode: 'managed_checkout' });
  }

  override isAvailable(): boolean {
    return this.config !== null && this.configurationError === null;
  }

  override getAvailabilityError(): string {
    return this.configurationError ?? MISSING_CONFIGURATION_MESSAGE;
  }

  private unavailableError(): string {
    return `KHQR.cc payment provider is not configured: ${this.getAvailabilityError()}`;
  }

  buildCheckoutUrl(transactionId: string, amount: string, successUrl: string, remark: string): string {
    if (!this.config) throw new Error(this.unavailableError());

    const hash = generateCheckoutHash(this.config.secret, transactionId, amount, successUrl, remark);

    const params = new URLSearchParams({
      transaction_id: transactionId,
      amount,
      success_url: successUrl,
      remark,
      hash
    });

    return `${this.config.gatewayUrl}/${this.config.profileId}?${params.toString()}`;
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    if (!this.isAvailable() || !this.config) {
      return { success: false, error: this.unavailableError() };
    }

    try {
      const transactionId = params.reference;
      const amount = params.amount;
      const remark = `Deposit ${params.reference}`;
      const successUrl = process.env.KHQRCC_SUCCESS_URL?.trim() || '';

      if (!successUrl) {
        return { success: false, error: 'KHQRCC_SUCCESS_URL is not configured' };
      }

      const paymentUrl = this.buildCheckoutUrl(transactionId, amount, successUrl, remark);

      return {
        success: true,
        paymentId: params.reference,
        providerPaymentId: transactionId,
        reference: params.reference,
        expiresAt: params.expiresAt,
        paymentUrl,
        metadata: {
          transactionId,
          checkoutUrl: paymentUrl,
          mode: 'managed_checkout'
        }
      };
    } catch (error) {
      logProviderError('checkout URL generation', error, this.config?.secret);
      return {
        success: false,
        error: mapProviderError(error, 'Failed to generate KHQR.cc checkout URL', this.config?.secret)
      };
    }
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    if (!this.isAvailable() || !this.config) {
      return {
        success: false,
        status: 'PENDING',
        error: this.unavailableError()
      };
    }

    const transactionId = params.providerPaymentId;
    if (!transactionId) {
      return {
        success: false,
        status: 'FAILED',
        error: 'Missing provider payment ID (transaction_id) for status check'
      };
    }

    try {
      const baseUrl = new URL(this.config.gatewayUrl).origin;
      const verifyUrl = `${baseUrl}/${this.config.profileId}/payment-gateway/v1/payments/check-trans`;
      const hash = generateVerificationHash(this.config.secret, transactionId);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      let response: Response;
      try {
        const formBody = new URLSearchParams({
          transaction_id: transactionId,
          hash
        });

        response = await fetch(verifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody.toString(),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const rawBody = await response.text();
      let parsed: KHQRCCVerifyResponse;
      try {
        parsed = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        return {
          success: false,
          status: 'PENDING',
          providerPaymentId: transactionId,
          error: 'KHQR.cc verification returned invalid JSON'
        };
      }

      if (parsed.responseCode !== 0 || !parsed.data) {
        return {
          success: false,
          status: 'PENDING',
          providerPaymentId: transactionId,
          error: `KHQR.cc payment waiting — ${parsed.responseMessage || 'not confirmed'}`
        };
      }

      const txStatus = parsed.data.status?.toUpperCase();
      if (txStatus === 'SUCCESS' || txStatus === 'COMPLETED') {
        return {
          success: true,
          status: 'SUCCEEDED',
          providerPaymentId: transactionId,
          paidAt: new Date(),
          amount: parsed.data.amount?.toString(),
          providerTransactionHash: parsed.data.hash
        };
      }

      if (txStatus === 'FAILED' || txStatus === 'CANCELLED') {
        return {
          success: false,
          status: 'FAILED',
          providerPaymentId: transactionId,
          error: `Payment ${txStatus.toLowerCase()}`
        };
      }

      return {
        success: false,
        status: 'PENDING',
        providerPaymentId: transactionId,
        error: `Payment waiting — status: ${txStatus || 'unknown'}`
      };
    } catch (error) {
      logProviderError('verification', error, this.config?.secret);
      return {
        success: false,
        status: 'PENDING',
        providerPaymentId: transactionId,
        error: mapProviderError(error, 'Failed to verify KHQR.cc payment', this.config?.secret)
      };
    }
  }

  async getPaymentStatus(params: GetPaymentStatusParams): Promise<GetPaymentStatusResult> {
    const result = await this.verifyPayment(params);
    return {
      success: result.success,
      status: result.status,
      providerPaymentId: result.providerPaymentId,
      paidAt: result.paidAt,
      amount: result.amount,
      currency: result.currency,
      error: result.error
    };
  }

  async expirePayment(_params: ExpirePaymentParams): Promise<ExpirePaymentResult> {
    if (!this.isAvailable()) {
      return { success: false, error: this.unavailableError() };
    }
    return { success: true };
  }

  /**
   * Verify a KHQR.cc webhook notification.
   * Returns true if the hash is valid, false otherwise.
   */
  static verifyWebhookHash(
    payload: KHQRCCWebhookPayload,
    secret: string
  ): boolean {
    if (!payload || typeof payload !== 'object') return false;
    if (!payload.hash || typeof payload.hash !== 'string') return false;
    if (!payload.req_time || !payload.transaction_id || payload.amount === undefined || !payload.status) return false;

    const expectedHash = generateWebhookHash(
      secret,
      payload.req_time,
      payload.transaction_id,
      payload.amount,
      payload.status
    );

    if (expectedHash.length !== payload.hash.length) return false;

    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    const actualBuffer = Buffer.from(payload.hash, 'hex');

    if (expectedBuffer.length !== actualBuffer.length) return false;

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }

  static clearMockData(): void {
    // Real provider has no in-memory payment state.
  }
}

export { generateCheckoutHash as generateQrHash };
