import { describe, expect, it, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { KHQRCCPaymentProvider, generateQrHash, generateWebhookHash } from './khqrcc-provider.js';
import type { KHQRCCWebhookPayload } from './khqrcc-provider.js';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.KHQRCC_PROFILE_ID = 'test_profile_123';
  process.env.KHQRCC_SECRET = 'test_secret_abc';
  process.env.KHQRCC_GATEWAY_URL = 'https://khqr.cc/api/payment/request';
  process.env.KHQRCC_SUCCESS_URL = 'https://example.com/webhook/khqrcc';
});

describe('KHQRCCPaymentProvider', () => {
  describe('configuration', () => {
    it('is available when env vars are set', () => {
      const provider = new KHQRCCPaymentProvider();
      expect(provider.isAvailable()).toBe(true);
    });

    it('is not available when KHQRCC_PROFILE_ID is missing', () => {
      delete process.env.KHQRCC_PROFILE_ID;
      const provider = new KHQRCCPaymentProvider();
      expect(provider.isAvailable()).toBe(false);
      expect(provider.getAvailabilityError()).toContain('KHQRCC_PROFILE_ID');
    });

    it('is not available when KHQRCC_SECRET is missing', () => {
      delete process.env.KHQRCC_SECRET;
      const provider = new KHQRCCPaymentProvider();
      expect(provider.isAvailable()).toBe(false);
      expect(provider.getAvailabilityError()).toContain('KHQRCC_SECRET');
    });

    it('uses default gateway URL when KHQRCC_GATEWAY_URL is not set', () => {
      delete process.env.KHQRCC_GATEWAY_URL;
      const provider = new KHQRCCPaymentProvider();
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe('providerType', () => {
    it('returns KHQRCC', () => {
      const provider = new KHQRCCPaymentProvider();
      expect(provider.providerType).toBe('KHQRCC');
    });
  });
});

describe('generateQrHash', () => {
  it('produces correct SHA-1 hash', () => {
    const secret = 'my_secret';
    const transactionId = 'TXN-001';
    const amount = '5.00';
    const successUrl = 'https://example.com/callback';
    const remark = 'Deposit TXN-001';

    const hash = generateQrHash(secret, transactionId, amount, successUrl, remark);

    const expected = crypto.createHash('sha1')
      .update(secret + transactionId + amount + successUrl + remark)
      .digest('hex');

    expect(hash).toBe(expected);
    expect(hash).toHaveLength(40);
  });

  it('produces different hashes for different secrets', () => {
    const h1 = generateQrHash('secret1', 'TXN-001', '5.00', 'https://x.com/cb', 'remark');
    const h2 = generateQrHash('secret2', 'TXN-001', '5.00', 'https://x.com/cb', 'remark');
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different amounts', () => {
    const h1 = generateQrHash('secret', 'TXN-001', '5.00', 'https://x.com/cb', 'remark');
    const h2 = generateQrHash('secret', 'TXN-001', '10.00', 'https://x.com/cb', 'remark');
    expect(h1).not.toBe(h2);
  });
});

describe('generateWebhookHash', () => {
  it('produces correct SHA-256 hash', () => {
    const secret = 'my_secret';
    const reqTime = 1710500000;
    const transactionId = 'TXN-001';
    const amount = 5.00;
    const status = 'SUCCESS';

    const hash = generateWebhookHash(secret, reqTime, transactionId, amount, status);

    const expected = crypto.createHash('sha256')
      .update(secret + reqTime + transactionId + amount + status)
      .digest('hex');

    expect(hash).toBe(expected);
    expect(hash).toHaveLength(64);
  });

  it('produces different hashes for different statuses', () => {
    const h1 = generateWebhookHash('secret', 1710500000, 'TXN-001', 5.00, 'SUCCESS');
    const h2 = generateWebhookHash('secret', 1710500000, 'TXN-001', 5.00, 'FAILED');
    expect(h1).not.toBe(h2);
  });
});

describe('KHQRCCPaymentProvider.verifyWebhookHash', () => {
  it('accepts valid SHA-256 webhook hash', () => {
    const secret = 'webhook_secret';
    const reqTime = 1710500000;
    const transactionId = 'TXN-001';
    const amount = 5.00;
    const status = 'SUCCESS';

    const hash = generateWebhookHash(secret, reqTime, transactionId, amount, status);

    const payload: KHQRCCWebhookPayload = {
      req_time: reqTime,
      merchantBakongId: 'test@bakong',
      transaction_id: transactionId,
      amount,
      status,
      hash
    };

    expect(KHQRCCPaymentProvider.verifyWebhookHash(payload, secret)).toBe(true);
  });

  it('rejects invalid hash', () => {
    const payload: KHQRCCWebhookPayload = {
      req_time: 1710500000,
      transaction_id: 'TXN-001',
      amount: 5.00,
      status: 'SUCCESS',
      hash: 'a'.repeat(64)
    };

    expect(KHQRCCPaymentProvider.verifyWebhookHash(payload, 'wrong_secret')).toBe(false);
  });

  it('rejects missing hash', () => {
    const payload: KHQRCCWebhookPayload = {
      req_time: 1710500000,
      transaction_id: 'TXN-001',
      amount: 5.00,
      status: 'SUCCESS'
    };

    expect(KHQRCCPaymentProvider.verifyWebhookHash(payload, 'secret')).toBe(false);
  });

  it('rejects null payload', () => {
    expect(KHQRCCPaymentProvider.verifyWebhookHash(null as unknown as KHQRCCWebhookPayload, 'secret')).toBe(false);
  });

  it('rejects empty string hash', () => {
    const payload: KHQRCCWebhookPayload = {
      req_time: 1710500000,
      transaction_id: 'TXN-001',
      amount: 5.00,
      status: 'SUCCESS',
      hash: ''
    };

    expect(KHQRCCPaymentProvider.verifyWebhookHash(payload, 'secret')).toBe(false);
  });

  it('rejects missing required fields', () => {
    const payload = { hash: 'abc' } as unknown as KHQRCCWebhookPayload;
    expect(KHQRCCPaymentProvider.verifyWebhookHash(payload, 'secret')).toBe(false);
  });
});

describe('KHQRCCPaymentProvider.createPayment', () => {
  it('returns paymentUrl for managed checkout without calling any API', async () => {
    const provider = new KHQRCCPaymentProvider();
    const result = await provider.createPayment({
      orderId: 'order-1',
      amount: '5.00',
      currency: 'USD',
      reference: 'JR-DP-TEST-001',
      idempotencyKey: 'idem-001',
      expiresAt: new Date(Date.now() + 900000)
    });

    expect(result.success).toBe(true);
    expect(result.paymentUrl).toBeDefined();
    expect(result.paymentUrl).toContain('khqr.cc/api/payment/request/test_profile_123');
    expect(result.paymentUrl).toContain('transaction_id=JR-DP-TEST-001');
    expect(result.paymentUrl).toContain('amount=5.00');
    expect(result.paymentUrl).toContain('success_url=');
    expect(result.paymentUrl).toContain('remark=');
    expect(result.paymentUrl).toContain('hash=');
    expect(result.providerPaymentId).toBe('JR-DP-TEST-001');
    expect(result.qrCodeData).toBeUndefined();
  });

  it('returns error when SUCCESS_URL is not configured', async () => {
    delete process.env.KHQRCC_SUCCESS_URL;
    const provider = new KHQRCCPaymentProvider();
    const result = await provider.createPayment({
      orderId: 'order-1',
      amount: '5.00',
      currency: 'USD',
      reference: 'JR-DP-TEST-002',
      idempotencyKey: 'idem-002',
      expiresAt: new Date()
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('KHQRCC_SUCCESS_URL');
  });

  it('generates correct SHA-1 hash in checkout URL', async () => {
    const provider = new KHQRCCPaymentProvider();
    const result = await provider.createPayment({
      orderId: 'order-1',
      amount: '5.00',
      currency: 'USD',
      reference: 'JR-DP-TEST-003',
      idempotencyKey: 'idem-003',
      expiresAt: new Date()
    });

    expect(result.success).toBe(true);
    const url = new URL(result.paymentUrl!);
    const hash = url.searchParams.get('hash');
    expect(hash).toHaveLength(40);

    const expectedHash = crypto.createHash('sha1')
      .update('test_secret_abc' + 'JR-DP-TEST-003' + '5.00' + 'https://example.com/webhook/khqrcc' + 'Deposit JR-DP-TEST-003')
      .digest('hex');
    expect(hash).toBe(expectedHash);
  });

  it('returns error when provider is not configured', async () => {
    delete process.env.KHQRCC_PROFILE_ID;
    const provider = new KHQRCCPaymentProvider();
    const result = await provider.createPayment({
      orderId: 'order-1',
      amount: '5.00',
      currency: 'USD',
      reference: 'JR-DP-TEST-004',
      idempotencyKey: 'idem-004',
      expiresAt: new Date()
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });
});

describe('KHQRCCPaymentProvider.verifyPayment', () => {
  it('calls check-trans endpoint and returns PENDING on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    const provider = new KHQRCCPaymentProvider();
    const result = await provider.verifyPayment({
      providerPaymentId: 'TXN-001'
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('PENDING');
    expect(fetch).toHaveBeenCalled();
  });

  it('calls the correct check-trans URL without extra /api prefix', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ responseCode: 0, data: { status: 'pending' } })
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new KHQRCCPaymentProvider();
    await provider.verifyPayment({ providerPaymentId: 'TXN-001' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://khqr.cc/test_profile_123/payment-gateway/v1/payments/check-trans');
    expect(calledUrl).not.toContain('/api/');
  });

  it('returns SUCCEEDED when check-trans confirms success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        responseCode: 0,
        data: { status: 'success', amount: 5.0, hash: 'abc123' }
      })
    }));

    const provider = new KHQRCCPaymentProvider();
    const result = await provider.verifyPayment({
      providerPaymentId: 'TXN-001'
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.paidAt).toBeInstanceOf(Date);
  });

  it('returns PENDING when check-trans returns pending status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        responseCode: 0,
        data: { status: 'pending' }
      })
    }));

    const provider = new KHQRCCPaymentProvider();
    const result = await provider.verifyPayment({
      providerPaymentId: 'TXN-001'
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('PENDING');
  });

  it('returns FAILED when no providerPaymentId', async () => {
    const provider = new KHQRCCPaymentProvider();
    const result = await provider.verifyPayment({});

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
  });
});

describe('KHQRCCPaymentProvider.expirePayment', () => {
  it('returns success', async () => {
    const provider = new KHQRCCPaymentProvider();
    const result = await provider.expirePayment({ reference: 'test' });
    expect(result.success).toBe(true);
  });
});
