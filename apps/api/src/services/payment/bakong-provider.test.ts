import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BakongKHQR } from 'bakong-khqr';
import { BakongPaymentProvider } from './bakong-provider.js';

const EXPIRY = new Date(Date.now() + 15 * 60 * 1000);

function stubOfficialEnv(): void {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('BAKONG_API_URL', 'https://api-bakong.nbc.gov.kh');
  vi.stubEnv('BAKONG_API_TOKEN', 'official-test-token');
  vi.stubEnv('BAKONG_ACCOUNT_ID', 'merchant@bank');
  vi.stubEnv('BAKONG_MERCHANT_NAME', 'Rotha Jim');
  vi.stubEnv('BAKONG_MERCHANT_CITY', 'Phnom Penh');
}

function stubRelayEnv(): void {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('BAKONG_API_URL', 'https://api.bakongrelay.com');
  vi.stubEnv('BAKONG_API_TOKEN', 'rbk-test-token');
  vi.stubEnv('BAKONG_ACCOUNT_ID', 'merchant@bank');
  vi.stubEnv('BAKONG_MERCHANT_NAME', 'Rotha Jim');
  vi.stubEnv('BAKONG_MERCHANT_CITY', 'Phnom Penh');
}

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    json: async () => body
  } as Response;
}

function matchedTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hash: 'tx-hash-abc',
    fromAccountId: 'payer@aclb',
    toAccountId: 'merchant@bank',
    currency: 'USD',
    amount: 2.6,
    trackingStatus: 'RECEIVE_AT_RECEIVER_ACCOUNT',
    acknowledgedDateMs: Date.now(),
    ...overrides
  };
}

describe('BakongPaymentProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('production configuration', () => {
    it('fails closed when the dedicated account ID is missing', () => {
      stubOfficialEnv();
      vi.stubEnv('BAKONG_ACCOUNT_ID', '');
      vi.stubEnv('BAKONG_MERCHANT_ACCOUNT', 'merchant@bank');

      const provider = new BakongPaymentProvider();

      expect(provider.isAvailable()).toBe(false);
      expect(provider.getAvailabilityError()).toContain('BAKONG_ACCOUNT_ID');
    });

    it('does not use the legacy merchant account variable as a fallback', () => {
      stubOfficialEnv();
      vi.stubEnv('BAKONG_ACCOUNT_ID', '');
      vi.stubEnv('BAKONG_MERCHANT_ACCOUNT', 'merchant@bank');

      const provider = new BakongPaymentProvider();

      expect(provider.isAvailable()).toBe(false);
    });

    it('rejects a known SIT/test account ID', () => {
      stubOfficialEnv();
      vi.stubEnv('BAKONG_ACCOUNT_ID', 'rotha_jim@bkr');

      const provider = new BakongPaymentProvider();

      expect(provider.isAvailable()).toBe(false);
      expect(provider.getAvailabilityError()).toContain('SIT/test');
    });

    it('requires an RBK token when Bakong Relay is selected', () => {
      stubRelayEnv();
      vi.stubEnv('BAKONG_API_TOKEN', 'not-an-rbk-token');

      const provider = new BakongPaymentProvider();

      expect(provider.isAvailable()).toBe(false);
      expect(provider.getAvailabilityError()).toContain('RBK');
    });
  });

  describe('real dynamic QR creation', () => {
    it('generates a valid dynamic KHQR with the official Bakong SDK path', async () => {
      stubOfficialEnv();
      const fetchSpy = vi.spyOn(global, 'fetch');
      const provider = new BakongPaymentProvider();

      const result = await provider.createPayment({
        orderId: 'deposit',
        amount: '2.60',
        currency: 'USD',
        reference: 'JR-DP-TEST-260',
        idempotencyKey: 'idem-1',
        expiresAt: EXPIRY
      });

      expect(result.success).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.qrCodeData).toMatch(/^000201/);
      expect(BakongKHQR.verify(result.qrCodeData!).isValid).toBe(true);
      expect(result.providerPaymentId).toMatch(/^[a-f0-9]{32}$/);
      expect(result.qrCodeImage).toMatch(/^data:image\/png;base64,/);
      expect(result.merchantName).toBe('Rotha Jim');
      expect(result.metadata).toMatchObject({
        dynamic: true,
        accountId: 'merchant@bank',
        billNumber: 'JR-DP-TEST-260'
      });
    });

    it('generates the exact-expiry QR locally when an RBK token is used for verification', async () => {
      stubRelayEnv();
      const reference = 'JR-DP-RELAY-260';
      const fetchSpy = vi.spyOn(global, 'fetch');
      const provider = new BakongPaymentProvider();

      const result = await provider.createPayment({
        orderId: 'deposit',
        amount: '2.60',
        currency: 'USD',
        reference,
        idempotencyKey: 'idem-relay',
        expiresAt: EXPIRY
      });

      expect(result.success).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.qrCodeData).toMatch(/^000201/);
      expect(BakongKHQR.verify(result.qrCodeData!).isValid).toBe(true);
      expect(result.providerPaymentId).toMatch(/^[a-f0-9]{32}$/);
      expect(result.metadata).toMatchObject({
        dynamic: true,
        generationProvider: 'bakong-khqr-sdk',
        billNumber: reference
      });
      expect(JSON.stringify(result)).not.toContain('rbk-test-token');
    });
  });

  describe('server-side verification', () => {
    it('verifies the exact account, amount, currency, and transaction hash', async () => {
      stubRelayEnv();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        mockJsonResponse({ responseCode: 0, data: matchedTransaction() })
      );
      const provider = new BakongPaymentProvider();

      const result = await provider.verifyPayment({
        providerPaymentId: 'a'.repeat(32),
        reference: 'JR-DP-RELAY-260',
        expectedAmount: '2.60',
        expectedCurrency: 'USD'
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('SUCCEEDED');
      expect(result.providerTransactionHash).toBe('tx-hash-abc');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.bakongrelay.com/v1/check_transaction_by_md5',
        expect.objectContaining({ body: JSON.stringify({ md5: 'a'.repeat(32) }) })
      );
    });

    it('keeps a not-found transaction pending', async () => {
      stubOfficialEnv();
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockJsonResponse({ responseCode: 1, errorCode: 1, responseMessage: 'Transaction not found' })
      );
      const provider = new BakongPaymentProvider();

      const result = await provider.verifyPayment({
        providerPaymentId: 'b'.repeat(32),
        expectedAmount: '2.60',
        expectedCurrency: 'USD'
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('PENDING');
    });

    it.each([
      ['wrong amount', { amount: 3 }, 'does not match expected amount'],
      ['wrong currency', { currency: 'KHR' }, 'does not match expected currency'],
      ['wrong account', { toAccountId: 'other@aclb' }, 'wrong merchant account']
    ])('rejects a transaction with %s', async (_label, data, message) => {
      stubOfficialEnv();
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockJsonResponse({ responseCode: 0, data: matchedTransaction(data) })
      );
      const provider = new BakongPaymentProvider();

      const result = await provider.verifyPayment({
        providerPaymentId: 'c'.repeat(32),
        expectedAmount: '2.60',
        expectedCurrency: 'USD'
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.error).toContain(message);
    });

    it('does not confirm a transaction without a provider hash', async () => {
      stubOfficialEnv();
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockJsonResponse({ responseCode: 0, data: matchedTransaction({ hash: undefined }) })
      );
      const provider = new BakongPaymentProvider();

      const result = await provider.verifyPayment({
        providerPaymentId: 'd'.repeat(32),
        expectedAmount: '2.60',
        expectedCurrency: 'USD'
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('PENDING');
      expect(result.error).toContain('Transaction hash missing');
    });

    it('never leaks the provider token in errors', async () => {
      stubOfficialEnv();
      vi.stubEnv('BAKONG_API_TOKEN', 'secret-provider-token');
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockJsonResponse({ responseCode: 1, responseMessage: 'Unauthorized secret-provider-token' }, 401)
      );
      const provider = new BakongPaymentProvider();

      const result = await provider.verifyPayment({ providerPaymentId: 'e'.repeat(32) });

      expect(result.error).not.toContain('secret-provider-token');
      expect(result.error).toContain('HTTP 401');
    });
  });
});
