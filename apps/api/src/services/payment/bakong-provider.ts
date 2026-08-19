import { Prisma } from '@prisma/client';
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
import { generateMerchantKhqr, renderQrImage } from './khqr.service.js';
import type { GeneratedKhqr } from './khqr.service.js';

type BakongMode = 'relay' | 'official';

interface BakongConfig {
  apiUrl: string;
  apiToken: string;
  accountId: string;
  merchantName: string;
  merchantCity: string;
  storeLabel: string;
  terminalLabel: string;
  mode: BakongMode;
}

interface BakongApiResponse {
  responseCode?: number;
  responseMessage?: string;
  errorCode?: number;
  data?: unknown;
}

interface BakongTransaction {
  hash?: string;
  fromAccountId?: string;
  toAccountId?: string;
  currency?: string;
  amount?: number | string;
  trackingStatus?: string;
  externalRef?: string;
  createdDateMs?: number;
  acknowledgedDateMs?: number;
}

type CheckPaymentStatusParams = (VerifyPaymentParams | GetPaymentStatusParams) & {
  expectedAmount?: string;
  expectedCurrency?: string;
  expectedMerchantAccount?: string;
};

const DEFAULT_RELAY_API_URL = 'https://api.bakongrelay.com';
const CONNECTIVITY_MESSAGE = 'KHQR generation/payment verification is blocked by Bakong provider connectivity or configuration.';
const MISSING_CONFIGURATION_MESSAGE = 'Real Bakong payment is not configured. Set BAKONG_ACCOUNT_ID to the KYC-verified receiving account ID.';
const MISSING_TOKEN_MESSAGE = 'Real Bakong payment verification is blocked because BAKONG_API_TOKEN is missing.';
const SIT_HOST_PATTERNS = /(^|[-.])sit[-.]|sandbox|staging|test[-.]/i;
const PRODUCTION_API_HOSTS = new Set([
  'api-bakong.nbc.gov.kh',
  'api-bakong.nbc.org.kh',
  'api.bakongrelay.com'
]);
const NON_PRODUCTION_ACCOUNT_DOMAINS = new Set(['bkr', 'devb']);

function isRelayToken(token: string | null): boolean {
  return token?.toLowerCase().startsWith('rbk') ?? false;
}

function isRelayApiUrl(apiUrl: string): boolean {
  try {
    return new URL(apiUrl).hostname.toLowerCase() === 'api.bakongrelay.com';
  } catch {
    return false;
  }
}

function normalizeApiUrl(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  const pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${parsed.origin}${pathname}`;
}

function isSitApiUrl(apiUrl: string): boolean {
  try {
    return SIT_HOST_PATTERNS.test(new URL(apiUrl).hostname);
  } catch {
    return false;
  }
}

function isKnownNonProductionAccount(accountId: string): boolean {
  const domain = accountId.split('@')[1]?.trim().toLowerCase();
  return domain ? NON_PRODUCTION_ACCOUNT_DOMAINS.has(domain) : false;
}

function isValidAccountId(accountId: string): boolean {
  return accountId.length <= 32 && /^[A-Za-z0-9][A-Za-z0-9._-]{0,30}@[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/.test(accountId);
}

function isConnectivityError(message: string): boolean {
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPROTO|self[- ]signed|certificate|DEPTH_ZERO|tls|ssl|socket hang up|network/i.test(message);
}

function redactSensitive(message: string, token?: string | null): string {
  return token ? message.split(token).join('[REDACTED]') : message;
}

function mapProviderError(error: unknown, fallback: string, token?: string | null): string {
  const message = redactSensitive(error instanceof Error ? error.message : fallback, token);
  return isConnectivityError(message) ? CONNECTIVITY_MESSAGE : message;
}

function logProviderError(operation: string, error: unknown, token?: string | null): void {
  const detail = redactSensitive(error instanceof Error ? error.message : String(error), token);
  if (isConnectivityError(detail)) {
    console.warn(`[BakongPaymentProvider] ${operation} failed due to provider connectivity/TLS.`);
  } else {
    console.warn(`[BakongPaymentProvider] ${operation} failed: ${detail}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asTransaction(value: unknown): BakongTransaction | null {
  const record = asRecord(value);
  if (!record) return null;

  return {
    hash: asString(record.hash),
    fromAccountId: asString(record.fromAccountId),
    toAccountId: asString(record.toAccountId),
    currency: asString(record.currency),
    amount: typeof record.amount === 'number' || typeof record.amount === 'string' ? record.amount : undefined,
    trackingStatus: asString(record.trackingStatus),
    externalRef: asString(record.externalRef),
    createdDateMs: typeof record.createdDateMs === 'number' ? record.createdDateMs : undefined,
    acknowledgedDateMs: typeof record.acknowledgedDateMs === 'number' ? record.acknowledgedDateMs : undefined
  };
}

function toUsdOrKhr(currency: string): 'USD' | 'KHR' {
  const normalized = currency.toUpperCase();
  if (normalized !== 'USD' && normalized !== 'KHR') {
    throw new Error(`Bakong KHQR does not support currency ${currency}. Use USD or KHR.`);
  }
  return normalized;
}

export class BakongPaymentProvider extends BasePaymentProvider {
  readonly name = 'Bakong KHQR Payment Provider';
  readonly providerType = 'BAKONG' as const;

  private config: BakongConfig | null = null;
  private configurationError: string | null = null;

  constructor() {
    super();
    this.initializeConfig();
  }

  private initializeConfig(): void {
    const apiToken = process.env.BAKONG_API_TOKEN?.trim() || null;
    const accountId = process.env.BAKONG_ACCOUNT_ID?.trim() || '';
    const merchantName = process.env.BAKONG_MERCHANT_NAME?.trim() || 'Rotha Jim';
    const merchantCity = process.env.BAKONG_MERCHANT_CITY?.trim() || 'Phnom Penh';
    const storeLabel = process.env.BAKONG_STORE_LABEL?.trim() || 'JR Digital License';
    const terminalLabel = process.env.BAKONG_TERMINAL_LABEL?.trim() || 'JR-DIGITAL-LICENSE';
    const relayToken = isRelayToken(apiToken);
    const configuredApiUrl = process.env.BAKONG_API_URL?.trim() || (relayToken ? DEFAULT_RELAY_API_URL : '');

    const missing = [
      !configuredApiUrl ? 'BAKONG_API_URL' : null,
      !apiToken ? 'BAKONG_API_TOKEN' : null,
      !accountId ? 'BAKONG_ACCOUNT_ID' : null
    ].filter((key): key is string => key !== null);

    if (missing.length > 0) {
      this.configurationError = missing.includes('BAKONG_ACCOUNT_ID')
        ? MISSING_CONFIGURATION_MESSAGE
        : missing.includes('BAKONG_API_TOKEN')
          ? MISSING_TOKEN_MESSAGE
          : `Bakong configuration is incomplete. Missing: ${missing.join(', ')}.`;
      this.logConfiguration(configuredApiUrl, apiToken, accountId, 'unconfigured');
      return;
    }

    if (!apiToken || !accountId || !configuredApiUrl) {
      return;
    }

    let normalizedApiUrl: string;
    try {
      normalizedApiUrl = normalizeApiUrl(configuredApiUrl);
    } catch {
      this.configurationError = 'BAKONG_API_URL must be a valid HTTPS URL.';
      this.logConfiguration(configuredApiUrl, apiToken, accountId, 'unconfigured');
      return;
    }

    const relayMode = relayToken || isRelayApiUrl(normalizedApiUrl);
    if (relayMode && !relayToken) {
      this.configurationError = 'Bakong Relay requires an RBK token beginning with rbk.';
      this.logConfiguration(normalizedApiUrl, apiToken, accountId, 'unconfigured');
      return;
    }

    if (relayToken && !isRelayApiUrl(normalizedApiUrl)) {
      normalizedApiUrl = DEFAULT_RELAY_API_URL;
    }

    if (isSitApiUrl(normalizedApiUrl)) {
      this.configurationError = 'BAKONG_API_URL points to a SIT/test environment. Real production payments require the production Bakong or Bakong Relay endpoint.';
      this.logConfiguration(normalizedApiUrl, apiToken, accountId, 'unconfigured');
      return;
    }

    if (!isValidAccountId(accountId)) {
      this.configurationError = 'BAKONG_ACCOUNT_ID is invalid. Set the account ID exactly as shown in the KYC-verified Bakong profile.';
      this.logConfiguration(normalizedApiUrl, apiToken, accountId, 'unconfigured');
      return;
    }

    if (isKnownNonProductionAccount(accountId)) {
      this.configurationError = 'BAKONG_ACCOUNT_ID is a SIT/test account. Set the KYC-verified production receiving account ID instead.';
      this.logConfiguration(normalizedApiUrl, apiToken, accountId, 'unconfigured');
      return;
    }

    if (merchantName !== 'Rotha Jim') {
      this.configurationError = 'BAKONG_MERCHANT_NAME must be exactly Rotha Jim for this merchant account.';
      this.logConfiguration(normalizedApiUrl, apiToken, accountId, 'unconfigured');
      return;
    }

    if (merchantCity.length === 0 || merchantCity.length > 15) {
      this.configurationError = 'BAKONG_MERCHANT_CITY must be between 1 and 15 characters.';
      this.logConfiguration(normalizedApiUrl, apiToken, accountId, 'unconfigured');
      return;
    }

    if (storeLabel.length > 25 || terminalLabel.length > 25) {
      this.configurationError = 'BAKONG_STORE_LABEL and BAKONG_TERMINAL_LABEL must be at most 25 characters.';
      this.logConfiguration(normalizedApiUrl, apiToken, accountId, 'unconfigured');
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      const hostname = new URL(normalizedApiUrl).hostname.toLowerCase();
      if (!PRODUCTION_API_HOSTS.has(hostname) || new URL(normalizedApiUrl).protocol !== 'https:') {
        this.configurationError = 'BAKONG_API_URL is not an approved HTTPS production Bakong endpoint.';
        this.logConfiguration(normalizedApiUrl, apiToken, accountId, 'unconfigured');
        return;
      }
    }

    this.config = {
      apiUrl: normalizedApiUrl,
      apiToken,
      accountId,
      merchantName,
      merchantCity,
      storeLabel,
      terminalLabel,
      mode: relayMode ? 'relay' : 'official'
    };
    this.logConfiguration(normalizedApiUrl, apiToken, accountId, relayMode ? 'relay' : 'official');
  }

  private logConfiguration(
    apiUrl: string,
    apiToken: string | null,
    accountId: string,
    mode: BakongMode | 'unconfigured'
  ): void {
    console.info('[BakongPaymentProvider] configuration', {
      apiUrl: apiUrl ? 'configured' : 'missing',
      token: apiToken ? 'PRESENT' : 'MISSING',
      accountId: accountId ? 'configured' : 'missing',
      merchantName: process.env.BAKONG_MERCHANT_NAME?.trim() || 'Rotha Jim',
      mode
    });
  }

  override isAvailable(): boolean {
    return this.config !== null && this.configurationError === null;
  }

  override getAvailabilityError(): string {
    return this.configurationError ?? MISSING_CONFIGURATION_MESSAGE;
  }

  private unavailableError(): string {
    return `Bakong payment provider is not configured: ${this.getAvailabilityError()}`;
  }

  private endpoint(path: string): string {
    if (!this.config) throw new Error(this.unavailableError());
    return `${this.config.apiUrl}${path}`;
  }

  private async post(path: string, payload: Record<string, unknown>): Promise<BakongApiResponse> {
    if (!this.config) throw new Error(this.unavailableError());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(this.endpoint(path), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiToken}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      let parsed: unknown;
      if (typeof response.text === 'function') {
        const body = await response.text();
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch {
          parsed = {};
        }
      } else {
        parsed = await response.json();
      }

      const apiResponse = asRecord(parsed) as BakongApiResponse | null;
      if (!response.ok) {
        const detail = apiResponse?.responseMessage;
        throw new Error(`Bakong API error: HTTP ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
      }

      return apiResponse ?? {};
    } finally {
      clearTimeout(timeout);
    }
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    if (!this.isAvailable() || !this.config) {
      return { success: false, error: this.unavailableError() };
    }

    try {
      const reference = params.reference || this.generateReference();
      const currency = toUsdOrKhr(params.currency);
      if (reference.length > 25) {
        throw new Error('Bakong bill number must be at most 25 characters');
      }

      // Generate locally with the installed KHQR SDK so the dynamic timestamp
      // matches the payment session's exact expiry. The provider API is used
      // only for server-side verification, never for client-side success.
      const generated: GeneratedKhqr = generateMerchantKhqr({
        accountId: this.config.accountId,
        merchantName: this.config.merchantName,
        merchantCity: this.config.merchantCity,
        amount: params.amount,
        currency,
        billNumber: reference,
        expiresAt: params.expiresAt,
        storeLabel: this.config.storeLabel,
        terminalLabel: this.config.terminalLabel
      });

      const qrCodeImage = await renderQrImage(generated.qr);
      return {
        success: true,
        paymentId: reference,
        providerPaymentId: generated.md5,
        reference,
        expiresAt: params.expiresAt,
        merchantName: this.config.merchantName,
        qrCodeData: generated.qr,
        qrCodeImage,
        metadata: {
          md5: generated.md5,
          qrCode: generated.qr,
          qrCodeImage,
          billNumber: reference,
          accountId: this.config.accountId,
          merchantName: this.config.merchantName,
          currency,
          amount: params.amount,
          dynamic: true,
          generationProvider: 'bakong-khqr-sdk'
        }
      };
    } catch (error) {
      logProviderError('createPayment', error, this.config.apiToken);
      return {
        success: false,
        error: mapProviderError(error, 'Failed to create Bakong payment', this.config.apiToken)
      };
    }
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    return this.checkPaymentStatus(params, 'verifyPayment') as Promise<VerifyPaymentResult>;
  }

  async getPaymentStatus(params: GetPaymentStatusParams): Promise<GetPaymentStatusResult> {
    return this.checkPaymentStatus(params, 'getPaymentStatus') as Promise<GetPaymentStatusResult>;
  }

  private async checkTransactionByMd5(md5: string): Promise<BakongApiResponse> {
    if (!/^[a-f0-9]{32}$/i.test(md5)) {
      throw new Error('Invalid KHQR MD5 for status check');
    }
    return this.post('/v1/check_transaction_by_md5', { md5 });
  }

  private async checkPaymentStatus(
    params: CheckPaymentStatusParams,
    operation: 'verifyPayment' | 'getPaymentStatus'
  ): Promise<VerifyPaymentResult | GetPaymentStatusResult> {
    if (!this.isAvailable() || !this.config) {
      return {
        success: false,
        status: 'PENDING',
        error: this.unavailableError()
      };
    }

    const md5 = params.providerPaymentId;
    if (!md5) {
      return {
        success: false,
        status: 'FAILED',
        error: 'Missing provider payment ID (KHQR md5) for status check'
      };
    }

    try {
      const response = await this.checkTransactionByMd5(md5);
      const responseMessage = response.responseMessage || 'Bakong has not confirmed this payment yet';

      if (response.responseCode !== 0) {
        const isExplicitFailure = response.errorCode === 3 || /failed|cancel|reject/i.test(responseMessage);
        return {
          success: !isExplicitFailure,
          status: isExplicitFailure ? 'FAILED' : 'PENDING',
          providerPaymentId: md5,
          error: responseMessage
        };
      }

      const data = asTransaction(response.data);
      if (!data) {
        return {
          success: false,
          status: 'PENDING',
          providerPaymentId: md5,
          error: 'Bakong returned an empty transaction'
        };
      }

      const expectedMerchantAccount = params.expectedMerchantAccount || this.config.accountId;
      if (!data.toAccountId || data.toAccountId.toLowerCase() !== expectedMerchantAccount.toLowerCase()) {
        return {
          success: false,
          status: 'FAILED',
          providerPaymentId: md5,
          amount: data.amount?.toString(),
          currency: data.currency,
          error: data.toAccountId
            ? 'Payment was made to the wrong merchant account'
            : 'Bakong transaction did not include the merchant account'
        };
      }

      if (params.expectedAmount && data.amount === undefined) {
        return {
          success: false,
          status: 'FAILED',
          providerPaymentId: md5,
          currency: data.currency,
          error: 'Bakong transaction did not include the paid amount'
        };
      }

      if (params.expectedAmount) {
        const paid = new Prisma.Decimal(data.amount!.toString());
        const expected = new Prisma.Decimal(params.expectedAmount);
        if (!paid.equals(expected)) {
          return {
            success: false,
            status: 'FAILED',
            providerPaymentId: md5,
            amount: paid.toString(),
            currency: data.currency,
            error: `Paid amount (${paid.toString()}) does not match expected amount (${expected.toString()})`
          };
        }
      }

      if (params.expectedCurrency && !data.currency) {
        return {
          success: false,
          status: 'FAILED',
          providerPaymentId: md5,
          amount: data.amount?.toString(),
          error: 'Bakong transaction did not include the paid currency'
        };
      }

      if (params.expectedCurrency && data.currency!.toUpperCase() !== params.expectedCurrency.toUpperCase()) {
        return {
          success: false,
          status: 'FAILED',
          providerPaymentId: md5,
          amount: data.amount?.toString(),
          currency: data.currency,
          error: `Paid currency (${data.currency}) does not match expected currency (${params.expectedCurrency})`
        };
      }

      const trackingStatus = (data.trackingStatus || '').toUpperCase();
      if (/FAILED|CANCEL|REJECT/.test(trackingStatus)) {
        return {
          success: false,
          status: 'FAILED',
          providerPaymentId: md5,
          amount: data.amount?.toString(),
          currency: data.currency,
          error: 'Bakong reports the payment as failed'
        };
      }

      if (trackingStatus && !/RECEIVE_AT_RECEIVER_ACCOUNT|SUCCESS|COMPLETED/.test(trackingStatus)) {
        return {
          success: false,
          status: 'PENDING',
          providerPaymentId: md5,
          amount: data.amount?.toString(),
          currency: data.currency,
          error: 'Transaction is still in flight — waiting for payment to reach the merchant'
        };
      }

      if (!data.hash) {
        return {
          success: false,
          status: 'PENDING',
          providerPaymentId: md5,
          error: 'Transaction hash missing — payment cannot be confirmed'
        };
      }

      const paidAtMs = data.acknowledgedDateMs ?? data.createdDateMs;
      return {
        success: true,
        status: 'SUCCEEDED',
        providerPaymentId: md5,
        providerTransactionHash: data.hash,
        providerReference: data.externalRef ?? data.hash,
        paidAt: paidAtMs ? new Date(paidAtMs) : undefined,
        amount: data.amount?.toString(),
        currency: data.currency
      };
    } catch (error) {
      logProviderError(operation, error, this.config.apiToken);
      return {
        success: false,
        status: 'PENDING',
        providerPaymentId: md5,
        error: mapProviderError(error, 'Failed to verify payment with Bakong', this.config.apiToken)
      };
    }
  }

  async expirePayment(_params: ExpirePaymentParams): Promise<ExpirePaymentResult> {
    if (!this.isAvailable()) {
      return { success: false, error: this.unavailableError() };
    }

    // Bakong does not expose a cancellation endpoint for a generated KHQR.
    // Local payment state and the dynamic QR expiration are enforced by the API.
    return { success: true };
  }

  static clearMockData(): void {
    // Real provider has no in-memory payment state.
  }
}
