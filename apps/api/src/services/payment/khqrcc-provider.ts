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

      const urlObj = new URL(paymentUrl);
      const hostname = urlObj.hostname;

      console.info('[KHQRCCPaymentProvider] createPayment diagnostics', {
        provider: 'KHQRCC',
        reference: params.reference,
        paymentUrl: paymentUrl,
        paymentUrlHostname: hostname,
        gatewayUrl: this.config.gatewayUrl,
        profileId: this.config.profileId,
        successUrlConfigured: !!process.env.KHQRCC_SUCCESS_URL
      });

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
        error: `KHQR.cc payment waiting — ${this.unavailableError()}`
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
      const bodyLength = rawBody?.length ?? 0;

      // Safe: determine response type without exposing secrets
      let jsonParsed: unknown;
      let jsonError: unknown;
      let isJson = false;
      try {
        jsonParsed = rawBody ? JSON.parse(rawBody) : {};
        jsonError = undefined;
        isJson = true;
      } catch (e) {
        jsonParsed = undefined;
        jsonError = e;
        isJson = false;
      }

      // Log diagnostic information (safe - no secrets, always in production)
      const contentType = response.headers?.get?.('content-type') || 'unknown';
      const isJsonObj = typeof jsonParsed === 'object' && jsonParsed !== null;
      const responseBodyType = isJsonObj ? 'JSON-object' : 'non-JSON';

      // Extract structured data for logging (never secrets)
      const diag: Record<string, unknown> = {
        verifyUrl: verifyUrl,
        httpMethod: 'POST',
        httpStatus: response.status,
        contentType,
        bodyLength,
        isJson: isJsonObj,
        responseBodyType,
      };

      if (isJsonObj) {
        const p = jsonParsed as Record<string, unknown>;
        // Log top-level keys only (no values that could contain secrets)
        const topLevelKeys = Object.keys(p).filter(
          k => !['hash', 'secret', 'token', 'key', 'signature', 'mac'].includes(k)
        );
        diag['topLevelKeys'] = topLevelKeys;
        if (p['responseCode'] !== undefined) diag['responseCode'] = p['responseCode'];
        if (p['data'] !== undefined) {
          diag['dataKeys'] = Object.keys(p['data'] as Record<string, unknown>);
          // Log status if present in data
          const data = p['data'] as Record<string, unknown>;
          if (data['status']) diag['status'] = data['status'];
        }
        if (p['status']) diag['status'] = p['status'] as string;
      } else {
        // Non-JSON: capture truncated, sanitized preview
        const bodyPreview = rawBody?.slice(0, 300) || '';
        // Simple redaction: remove potential auth/cookie headers that might appear in body
        const sanitizedPreview = bodyPreview.replace(/(Authorization|Cookie):\s*[^\s]+/gi, '$1: [REDACTED]');
        diag['responsePreview'] = sanitizedPreview.length > 300
          ? sanitizedPreview.slice(0, 300) + '...'
          : sanitizedPreview;
      }

      console.info('[KHQRCCPaymentProvider] verifyPayment diagnostics:', diag);

      if (jsonParsed && typeof jsonParsed === 'object') {
        const providerData = jsonParsed as KHQRCCVerifyResponse;
        // Check top-level responseCode first (new format)
        if (providerData.responseCode === 0 && providerData.data) {
          console.info('[KHQRCCPaymentProvider] verifyPayment new format detected, responseCode=0, data present');
          const txStatus = providerData.data.status?.toUpperCase();
          if (txStatus === 'SUCCESS' || txStatus === 'PAID' || txStatus === 'COMPLETED') {
            return {
              success: true,
              status: 'SUCCEEDED',
              providerPaymentId: transactionId,
              paidAt: new Date(),
              amount: providerData.data.amount?.toString(),
              providerTransactionHash: providerData.data.hash?.toString()
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
        }

        // Check data.status for old format: {"data": {"status": "PAID"}}
        if (providerData.data?.status) {
          const txStatus = providerData.data.status.toUpperCase();
          if (txStatus === 'SUCCESS' || txStatus === 'PAID' || txStatus === 'COMPLETED') {
            return {
              success: true,
              status: 'SUCCEEDED',
              providerPaymentId: transactionId,
              paidAt: new Date(),
              amount: providerData.data.amount?.toString(),
              providerTransactionHash: providerData.data.hash?.toString()
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
        }

        if (providerData.responseCode === 0 && providerData.data) {
          return {
            success: true,
            status: 'SUCCEEDED',
            providerPaymentId: transactionId,
            paidAt: new Date(),
            amount: providerData.data.amount?.toString(),
            providerTransactionHash: providerData.data.hash?.toString()
          };
        }

        if (!(providerData && typeof providerData === 'object') || providerData.responseCode !== 0 || !providerData.data) {
          return {
            success: false,
            status: 'PENDING',
            providerPaymentId: transactionId,
            error: `KHQR.cc payment waiting — ${providerData.responseMessage || 'not confirmed'}`
          };
        }
      }
    } catch (error) {
      logProviderError('verification', error, this.config?.secret);
      return {
        success: false,
        status: 'PENDING',
        providerPaymentId: transactionId,
        error: `KHQR.cc payment waiting — ${mapProviderError(error, 'provider connectivity or configuration error', this.config?.secret)}`
      };
    }
    return { success: false, status: 'PENDING', providerPaymentId: transactionId, error: 'Unexpected verification error' };
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
