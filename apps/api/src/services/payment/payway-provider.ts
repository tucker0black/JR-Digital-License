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

interface PayWayConfig {
  environment: 'sandbox' | 'production';
  merchantId: string;
  apiKey: string;
  apiUrl: string;
}

interface PayWayPurchaseResponse {
  status?: {
    code?: string | number;
    message?: string;
    tran_id?: string;
  };
  qr_string?: string;
  abapay_deeplink?: string;
  checkout_qr_url?: string;
}

interface PayWayCheckTransactionResponse {
  data?: {
    payment_status_code?: number;
    total_amount?: number;
    original_amount?: number;
    refund_amount?: number;
    discount_amount?: number;
    payment_amount?: number;
    payment_currency?: string;
    apv?: string;
    payment_status?: string;
    transaction_date?: string;
  };
  status?: {
    code?: string | number;
    message?: string;
    tran_id?: string;
  };
}

interface PayWayWebhookPayload {
  transaction_id?: string;
  transaction_date?: string;
  original_currency?: string;
  original_amount?: number;
  bank_ref?: string;
  apv?: string;
  payment_status_code?: number;
  payment_status?: string;
  payment_currency?: string;
  payment_amount?: number;
  payment_type?: string;
  payer_account?: string;
  bank_name?: string;
  merchant_ref?: string;
}

const SANDBOX_BASE_URL = 'https://checkout-sandbox.payway.com.kh';
const PRODUCTION_BASE_URL = 'https://checkout.payway.com.kh';

const CONNECTIVITY_MESSAGE = 'ABA PayWay payment is blocked by provider connectivity or configuration.';
const MISSING_CONFIGURATION_MESSAGE = 'ABA PayWay payment is not configured. Set ABA_PAYWAY_MERCHANT_ID and ABA_PAYWAY_API_KEY.';

function formatPayWayTime(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}`;
}

function generateHash(apiKey: string, ...values: string[]): string {
  const concatenated = values.join('');
  return crypto.createHmac('sha512', apiKey).update(concatenated).digest('base64');
}

function isConnectivityError(message: string): boolean {
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPROTO|self[- ]signed|certificate|DEPTH_ZERO|tls|ssl|socket hang up|network/i.test(message);
}

function redactSensitive(message: string, apiKey?: string | null): string {
  return apiKey ? message.split(apiKey).join('[REDACTED]') : message;
}

function mapProviderError(error: unknown, fallback: string, apiKey?: string | null): string {
  const message = redactSensitive(error instanceof Error ? error.message : fallback, apiKey);
  return isConnectivityError(message) ? CONNECTIVITY_MESSAGE : message;
}

function logProviderError(operation: string, error: unknown, apiKey?: string | null): void {
  const detail = redactSensitive(error instanceof Error ? error.message : String(error), apiKey);
  if (isConnectivityError(detail)) {
    console.warn(`[PayWayPaymentProvider] ${operation} failed due to provider connectivity/TLS.`);
  } else {
    console.warn(`[PayWayPaymentProvider] ${operation} failed: ${detail}`);
  }
}

function mapPayWayStatus(statusCode: number | undefined, paymentStatus: string | undefined): 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'EXPIRED' | 'CANCELLED' {
  if (statusCode === 0 || paymentStatus === 'APPROVED') return 'SUCCEEDED';
  if (statusCode === 3 || paymentStatus === 'DECLINED') return 'FAILED';
  if (statusCode === 2 || paymentStatus === 'PENDING') return 'PENDING';
  if (statusCode === 7 || paymentStatus === 'CANCELLED') return 'CANCELLED';
  if (statusCode === 4 || paymentStatus === 'REFUNDED') return 'FAILED';
  return 'PENDING';
}

export class PayWayPaymentProvider extends BasePaymentProvider {
  readonly name = 'ABA PayWay Payment Provider';
  readonly providerType = 'ABA_PAYWAY' as const;

  private config: PayWayConfig | null = null;
  private configurationError: string | null = null;

  constructor() {
    super();
    this.initializeConfig();
  }

  private initializeConfig(): void {
    const environment = (process.env.ABA_PAYWAY_ENVIRONMENT?.trim() || 'sandbox') as 'sandbox' | 'production';
    const merchantId = process.env.ABA_PAYWAY_MERCHANT_ID?.trim() || '';
    const apiKey = process.env.ABA_PAYWAY_API_KEY?.trim() || '';
    const configuredApiUrl = process.env.ABA_PAYWAY_API_URL?.trim() || '';

    const missing = [
      !merchantId ? 'ABA_PAYWAY_MERCHANT_ID' : null,
      !apiKey ? 'ABA_PAYWAY_API_KEY' : null
    ].filter((key): key is string => key !== null);

    if (missing.length > 0) {
      this.configurationError = missing.includes('ABA_PAYWAY_MERCHANT_ID')
        ? MISSING_CONFIGURATION_MESSAGE
        : `ABA PayWay configuration is incomplete. Missing: ${missing.join(', ')}.`;
      this.logConfiguration(environment, merchantId, 'unconfigured');
      return;
    }

    let apiUrl = configuredApiUrl;
    if (!apiUrl) {
      apiUrl = environment === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
    }

    this.config = {
      environment,
      merchantId,
      apiKey,
      apiUrl
    };
    this.logConfiguration(environment, merchantId, 'configured');
  }

  private logConfiguration(
    environment: string,
    merchantId: string,
    status: 'configured' | 'unconfigured'
  ): void {
    console.info('[PayWayPaymentProvider] configuration', {
      environment,
      merchantId: merchantId ? 'configured' : 'missing',
      status
    });
  }

  override isAvailable(): boolean {
    return this.config !== null && this.configurationError === null;
  }

  override getAvailabilityError(): string {
    return this.configurationError ?? MISSING_CONFIGURATION_MESSAGE;
  }

  private unavailableError(): string {
    return `ABA PayWay payment provider is not configured: ${this.getAvailabilityError()}`;
  }

  private endpoint(path: string): string {
    if (!this.config) throw new Error(this.unavailableError());
    return `${this.config.apiUrl}${path}`;
  }

  private generateTranId(reference: string): string {
    const sanitized = reference.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
    const timestamp = Date.now().toString(36).slice(-8);
    return `${sanitized}${timestamp}`.slice(0, 20);
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    if (!this.isAvailable() || !this.config) {
      return { success: false, error: this.unavailableError() };
    }

    try {
      const reference = params.reference || this.generateReference();
      const reqTime = formatPayWayTime(new Date());
      const tranId = this.generateTranId(reference);
      const amount = params.amount;
      const currency = params.currency.toUpperCase();

      const paymentOption = 'abapay_khqr_deeplink';

      const hash = generateHash(
        this.config.apiKey,
        reqTime,                 // 1  req_time
        this.config.merchantId,  // 2  merchant_id
        tranId,                  // 3  tran_id
        amount,                  // 4  amount
        '',                      // 5  items
        '',                      // 6  shipping
        '',                      // 7  firstname
        '',                      // 8  lastname
        '',                      // 9  email
        '',                      // 10 phone
        '',                      // 11 type
        paymentOption,           // 12 payment_option
        '',                      // 13 return_url
        '',                      // 14 cancel_url
        '',                      // 15 continue_success_url
        '',                      // 16 return_deeplink
        currency,                // 17 currency
        '',                      // 18 custom_fields
        reference,               // 19 return_params
        '',                      // 20 payout
        '',                      // 21 lifetime
        '',                      // 22 additional_params
        '',                      // 23 google_pay_token
        ''                       // 24 skip_success_page
      );

      const formData = new FormData();
      formData.append('req_time', reqTime);
      formData.append('merchant_id', this.config.merchantId);
      formData.append('tran_id', tranId);
      formData.append('amount', amount);
      formData.append('hash', hash);
      formData.append('currency', currency);
      formData.append('payment_option', paymentOption);
      formData.append('firstname', (params.metadata?.firstName as string) || '');
      formData.append('lastname', (params.metadata?.lastName as string) || '');
      formData.append('return_params', reference);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      let response: Response;
      try {
        response = await fetch(this.endpoint('/api/payment-gateway/v1/payments/purchase'), {
          method: 'POST',
          body: formData,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/html')) {
        const html = await response.text();
        return {
          success: true,
          paymentId: reference,
          providerPaymentId: tranId,
          reference,
          expiresAt: params.expiresAt,
          paymentUrl: this.endpoint('/api/payment-gateway/v1/payments/purchase'),
          metadata: {
            tranId,
            reqTime,
            checkoutHtml: html,
            checkoutUrl: `${this.config.apiUrl}/api/payment-gateway/v1/payments/purchase`,
            environment: this.config.environment
          }
        };
      }

      let parsed: PayWayPurchaseResponse;
      try {
        const body = await response.text();
        parsed = body ? JSON.parse(body) : {};
      } catch {
        parsed = {};
      }

      if (parsed.status?.code !== '00' && parsed.status?.code !== 0) {
        const code = parsed.status?.code;
        const message = parsed.status?.message || 'PayWay rejected the transaction';
        console.warn(`[PayWayPaymentProvider] createPayment failed: code=${code} message=${message}`);
        return {
          success: false,
          error: `PayWay error ${code}: ${message}`
        };
      }

      return {
        success: true,
        paymentId: reference,
        providerPaymentId: parsed.status?.tran_id || tranId,
        reference,
        expiresAt: params.expiresAt,
        qrCodeData: parsed.qr_string,
        paymentUrl: parsed.checkout_qr_url,
        metadata: {
          tranId: parsed.status?.tran_id || tranId,
          reqTime,
          qrString: parsed.qr_string,
          abapayDeeplink: parsed.abapay_deeplink,
          checkoutQrUrl: parsed.checkout_qr_url,
          environment: this.config.environment
        }
      };
    } catch (error) {
      logProviderError('createPayment', error, this.config?.apiKey);
      return {
        success: false,
        error: mapProviderError(error, 'Failed to create ABA PayWay payment', this.config?.apiKey)
      };
    }
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    return this.checkPaymentStatus(params, 'verifyPayment') as Promise<VerifyPaymentResult>;
  }

  async getPaymentStatus(params: GetPaymentStatusParams): Promise<GetPaymentStatusResult> {
    return this.checkPaymentStatus(params, 'getPaymentStatus') as Promise<GetPaymentStatusResult>;
  }

  private async checkPaymentStatus(
    params: VerifyPaymentParams | GetPaymentStatusParams,
    operation: 'verifyPayment' | 'getPaymentStatus'
  ): Promise<VerifyPaymentResult | GetPaymentStatusResult> {
    if (!this.isAvailable() || !this.config) {
      return {
        success: false,
        status: 'PENDING',
        error: this.unavailableError()
      };
    }

    const tranId = params.providerPaymentId;
    if (!tranId) {
      return {
        success: false,
        status: 'FAILED',
        error: 'Missing provider payment ID (tran_id) for status check'
      };
    }

    try {
      const reqTime = formatPayWayTime(new Date());

      const hash = generateHash(
        this.config.apiKey,
        reqTime,
        this.config.merchantId,
        tranId
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      let response: Response;
      try {
        response = await fetch(this.endpoint('/api/payment-gateway/v1/payments/check-transaction-2'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            req_time: reqTime,
            merchant_id: this.config.merchantId,
            tran_id: tranId,
            hash
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      let parsed: PayWayCheckTransactionResponse;
      try {
        const body = await response.text();
        parsed = body ? JSON.parse(body) : {};
      } catch {
        parsed = {};
      }

      if (parsed.status?.code !== '00' && parsed.status?.code !== 0) {
        const code = parsed.status?.code;
        const message = parsed.status?.message || 'Transaction not found';
        return {
          success: false,
          status: 'PENDING',
          providerPaymentId: tranId,
          error: `PayWay check error ${code}: ${message}`
        };
      }

      const data = parsed.data;
      if (!data) {
        return {
          success: false,
          status: 'PENDING',
          providerPaymentId: tranId,
          error: 'PayWay returned empty transaction data'
        };
      }

      const payWayStatus = mapPayWayStatus(data.payment_status_code, data.payment_status);

      if (payWayStatus === 'SUCCEEDED') {
        if (params.expectedAmount && data.payment_amount !== undefined) {
          const paid = data.payment_amount;
          const expected = parseFloat(params.expectedAmount);
          if (Math.abs(paid - expected) > 0.01) {
            return {
              success: false,
              status: 'FAILED',
              providerPaymentId: tranId,
              amount: paid.toString(),
              currency: data.payment_currency,
              error: `Paid amount (${paid}) does not match expected amount (${expected})`
            };
          }
        }

        if (params.expectedCurrency && data.payment_currency) {
          if (data.payment_currency.toUpperCase() !== params.expectedCurrency.toUpperCase()) {
            return {
              success: false,
              status: 'FAILED',
              providerPaymentId: tranId,
              amount: data.payment_amount?.toString(),
              currency: data.payment_currency,
              error: `Paid currency (${data.payment_currency}) does not match expected currency (${params.expectedCurrency})`
            };
          }
        }

        return {
          success: true,
          status: 'SUCCEEDED',
          providerPaymentId: tranId,
          providerTransactionHash: data.apv || tranId,
          providerReference: data.apv || tranId,
          paidAt: data.transaction_date ? new Date(data.transaction_date) : new Date(),
          amount: data.payment_amount?.toString(),
          currency: data.payment_currency
        };
      }

      return {
        success: payWayStatus !== 'PENDING',
        status: payWayStatus,
        providerPaymentId: tranId,
        amount: data.payment_amount?.toString(),
        currency: data.payment_currency,
        error: payWayStatus === 'PENDING' ? 'PayWay has not confirmed this payment yet' : `PayWay status: ${data.payment_status}`
      };
    } catch (error) {
      logProviderError(operation, error, this.config.apiKey);
      return {
        success: false,
        status: 'PENDING',
        providerPaymentId: tranId,
        error: mapProviderError(error, 'Failed to verify payment with ABA PayWay', this.config.apiKey)
      };
    }
  }

  async expirePayment(_params: ExpirePaymentParams): Promise<ExpirePaymentResult> {
    if (!this.isAvailable()) {
      return { success: false, error: this.unavailableError() };
    }
    return { success: true };
  }

  /**
   * Verify a webhook notification from ABA PayWay.
   * Returns the parsed and validated webhook payload, or null if invalid.
   */
  static verifyWebhookPayload(
    payload: PayWayWebhookPayload,
    _expectedMerchantId: string
  ): PayWayWebhookPayload | null {
    if (!payload || typeof payload !== 'object') return null;

    if (!payload.transaction_id) {
      return null;
    }

    if (payload.payment_status_code === undefined) {
      return null;
    }

    return payload;
  }

  static clearMockData(): void {
    // Real provider has no in-memory payment state.
  }
}

export type { PayWayWebhookPayload };
