import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FazerCardsTopUpProvider } from './fazercards-provider.js';

/**
 * Contract tests for the FazerCards adapter. Every fixture mirrors the REAL
 * live API envelopes captured during verification:
 *   GET  /balance                    -> { ok, balance, currency }
 *   GET  /topups?cursor=...          -> { ok, items, meta: { has_more, next_cursor } }
 *   GET  /topups/offers?category_id= -> { ok, offers: [{offer_id, name, price_usd}], fields }
 *   POST /topups/order               -> { ok, order_id } / { ok: false, error }
 */
describe('FazerCardsTopUpProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const provider = () =>
    new FazerCardsTopUpProvider({ apiUrl: 'https://api.fzr.cards/api/v2/', apiKey: 'test-key' });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      text: async () => JSON.stringify(body),
      json: async () => body
    };
  }

  it('reports unconfigured when credentials are missing', async () => {
    const unconfigured = new FazerCardsTopUpProvider({ apiUrl: '', apiKey: '' });
    expect(unconfigured.isAvailable()).toBe(false);
    expect((await unconfigured.testConnection()).success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('testConnection', () => {
    it('reads balance from the live {ok} envelope', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, balance: '12.3400', currency: 'USD' }));

      const result = await provider().testConnection();

      expect(result.success).toBe(true);
      expect(result.balance).toBe(12.34);
      expect(result.currency).toBe('USD');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.fzr.cards/api/v2/balance');
      expect((init.headers as Record<string, string>)['X-API-Key']).toBe('test-key');
    });

    it('fails on a {ok:false} response instead of faking success', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'Invalid API key' }));

      const result = await provider().testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid API key');
    });
  });

  describe('getCategories', () => {
    it('follows cursor pagination until has_more is false and extracts regions', async () => {
      fetchMock
        .mockImplementationOnce(async (url: string) => {
          expect(url).toBe('https://api.fzr.cards/api/v2/topups');
          return jsonResponse({
            ok: true,
            kind: 'topup',
            items: [
              { category_id: 'free_fire_sg', name: 'Free Fire (SG)', note: 'Region: Singapore\nFree Fire top-up.' },
              { category_id: 'mobile_legends_global', name: 'Mobile Legends (Global)', note: 'Region: Global\nMLBB top-up.' }
            ],
            meta: { total: 3, limit: 2, next_cursor: 'CURSOR-1', has_more: true }
          });
        })
        .mockImplementationOnce(async (url: string) => {
          expect(url).toBe('https://api.fzr.cards/api/v2/topups?cursor=CURSOR-1');
          return jsonResponse({
            ok: true,
            kind: 'topup',
            items: [{ category_id: 'pubg_mobile_auto', name: 'PUBG Mobile (Auto)', note: null }],
            meta: { total: 3, limit: 2, next_cursor: null, has_more: false }
          });
        });

      const result = await provider().getCategories();

      expect(result.success).toBe(true);
      expect(result.categories).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.categories?.[0]).toMatchObject({
        category_id: 'free_fire_sg',
        name: 'Free Fire (SG)',
        region: 'Singapore'
      });
      expect(result.categories?.[2].region).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('stops paginating after the safety cap even if the provider keeps saying has_more', async () => {
      fetchMock.mockImplementation(async () =>
        jsonResponse({
          ok: true,
          items: [{ category_id: 'x', name: 'X' }],
          meta: { total: 999999, next_cursor: 'MORE', has_more: true }
        })
      );

      const result = await provider().getCategories();

      expect(result.success).toBe(true);
      // MAX_CATEGORY_PAGES = 20
      expect(fetchMock).toHaveBeenCalledTimes(20);
    });
  });

  describe('getOffers', () => {
    it('maps the live offer/field shape (name -> offer_name, top-level fields array)', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          ok: true,
          kind: 'topup',
          category_id: 'free_fire_my_sg',
          name: 'Free Fire (MY/SG)',
          offers: [
            { offer_id: '25_diamonds', name: '25 Diamonds', price_usd: '0.2300' },
            { offer_id: 'weekly_lite', name: 'Weekly Lite', price_usd: 0.32 }
          ],
          fields: [
            { key: 'player_id', label: 'Player ID', type: 'text' },
            { key: 'server_id', label: 'Server ID', type: 'text' }
          ],
          note: 'Region: Malaysia/Singapore'
        })
      );

      const result = await provider().getOffers('free_fire_my_sg');

      expect(result.success).toBe(true);
      expect(result.payload?.offers).toEqual([
        { offer_id: '25_diamonds', offer_name: '25 Diamonds', price_usd: 0.23 },
        { offer_id: 'weekly_lite', offer_name: 'Weekly Lite', price_usd: 0.32 }
      ]);
      expect(result.payload?.fields.map((f) => f.key)).toEqual(['player_id', 'server_id']);
      expect(result.payload?.categoryName).toBe('Free Fire (MY/SG)');
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('category_id=free_fire_my_sg');
    });
  });

  describe('createOrder', () => {
    const baseParams = {
      orderId: 'order-1',
      serviceId: 'free_fire_my_sg',
      offerId: '25_diamonds',
      target: '123456789',
      serverId: undefined as string | undefined,
      customerFields: {} as Record<string, string>,
      quantity: 1,
      reference: 'ref',
      idempotencyKey: 'idem'
    };

    it('posts exactly {category_id, offer_id, fields} to /topups/order', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, order_id: 'ord-100' }));

      const result = await provider().createOrder({
        ...baseParams,
        serverId: '8001',
        customerFields: { zone: 'A1', player_id: 'SHOULD_NOT_OVERRIDE' }
      });

      expect(result.success).toBe(true);
      expect(result.providerOrderId).toBe('ord-100');
      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe('https://api.fzr.cards/api/v2/topups/order');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(Object.keys(body).sort()).toEqual(['category_id', 'fields', 'offer_id']);
      expect(body.category_id).toBe('free_fire_my_sg');
      expect(body.offer_id).toBe('25_diamonds');
      expect(body.fields).toEqual({ player_id: '123456789', server_id: '8001', zone: 'A1' });
      // No internal reference/idempotency material is leaked to the provider.
      expect(body.reference).toBeUndefined();
      expect(body.idempotency_key).toBeUndefined();
    });

    it('surfaces provider errors like insufficient balance without faking success', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'Insufficient balance.' }));

      const result = await provider().createOrder(baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient balance.');
    });

    it('rejects orders without external identifiers before calling the API', async () => {
      const result = await provider().createOrder({ ...baseParams, serviceId: '', offerId: undefined });

      expect(result.success).toBe(false);
      expect(result.error).toContain('category ID and an offer ID');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('getOrderStatus', () => {
    it('queries GET /orders/{providerOrderId} and maps statuses', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, order_id: 'ord-100', status: 'completed' }));

      const result = await provider().getOrderStatus({ providerOrderId: 'ord-100' });

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETED');
      expect(result.providerOrderId).toBe('ord-100');
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe('https://api.fzr.cards/api/v2/orders/ord-100');
    });

    it('propagates "order not found" instead of guessing a state', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'Order not found' }, 404));

      const result = await provider().getOrderStatus({ providerOrderId: 'ord-404' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Order not found');
    });
  });

  describe('getValidationSupport', () => {
    it('parses the dynamic validation-support catalog into generic categories', async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        ok: true,
        kind: 'topup',
        items: [
          { category_id: 'pubg_mobile', name: 'PUBG Mobile', fields: [{ key: 'player_id', label: 'Player ID', type: 'text' }] },
          { category_id: 'broken_entry' } // missing name/fields — skipped defensively
        ]
      }));

      const result = await provider().getValidationSupport();

      expect(result.success).toBe(true);
      expect(result.categories).toHaveLength(1);
      expect(result.categories?.[0]).toEqual({
        categoryId: 'pubg_mobile',
        name: 'PUBG Mobile',
        fields: [{ key: 'player_id', label: 'Player ID', type: 'text' }]
      });
    });

    it('reports failures instead of pretending the list is empty', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'nope' }));
      const result = await provider().getValidationSupport();
      expect(result.success).toBe(false);
      expect(result.error).toContain('nope');
    });
  });

  describe('validateAccount', () => {
    it('returns valid + player_name on a successful check', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, category_id: 'free_fire_sg', valid: true, player_name: 'JimRotha' }));

      const result = await provider().validateAccount({ categoryId: 'free_fire_sg', fields: { player_id: '123' } });

      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.playerName).toBe('JimRotha');
      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe('https://api.fzr.cards/api/v2/topups/validate-id');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ category_id: 'free_fire_sg', fields: { player_id: '123' } });
    });

    it('returns valid:false when the account does not exist', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, category_id: 'free_fire_sg', valid: false }));
      const result = await provider().validateAccount({ categoryId: 'free_fire_sg', fields: { player_id: '0' } });
      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);
    });

    it('classifies HTTP 429 as retryable', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'rate limited' }, 429));
      const result = await provider().validateAccount({ categoryId: 'x', fields: { player_id: '1' } });
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
    });

    it('classifies server errors as retryable and auth errors as not', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'boom' }, 500));
      expect((await provider().validateAccount({ categoryId: 'x', fields: { player_id: '1' } })).retryable).toBe(true);

      fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'bad key' }, 401));
      expect((await provider().validateAccount({ categoryId: 'x', fields: { player_id: '1' } })).retryable).toBe(false);
    });

    it('treats a network timeout as retryable', async () => {
      const timeoutError = new Error('The operation was aborted due to timeout');
      timeoutError.name = 'TimeoutError';
      fetchMock.mockRejectedValue(timeoutError);
      const result = await provider().validateAccount({ categoryId: 'x', fields: { player_id: '1' } });
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toMatch(/timed out/i);
    });
  });

  describe('createOrder idempotency', () => {
    it('sends the Idempotency-Key as a request header per the official contract', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, order_id: 'ord-7' }));
      await provider().createOrder({
        orderId: 'o1', serviceId: 'free_fire_sg', offerId: '25_diamonds',
        target: '1', quantity: 1, reference: 'r', idempotencyKey: 'idem-123'
      });
      const [, init] = fetchMock.mock.calls[0] as [string, Record<string, string>];
      expect(init.headers['Idempotency-Key']).toBe('idem-123');
    });
  });

  describe('verifyAccount', () => {
    it('reports verification as unsupported — never fakes success', async () => {
      const result = await provider().verifyAccount({ serviceId: 'free_fire_sg', target: '1' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/does not support account verification/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
