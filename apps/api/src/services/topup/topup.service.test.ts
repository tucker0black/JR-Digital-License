import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { TopUpService } from './topup.service.js';
import { clearSupportCacheForTests } from './verification.service.js';
import { encryptInventoryValue } from '../../utils/encryption.js';

process.env.INVENTORY_ENCRYPTION_KEY = 'test-inventory-encryption-key-0123456789abcdef';

const mockPrisma = {
  order: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  topUpPackage: { findUnique: vi.fn() },
  topUpGameConfig: { findUnique: vi.fn() },
  topUpOrder: { findFirst: vi.fn(), create: vi.fn() },
  topUpProvider: { findUnique: vi.fn() },
  topUpProviderService: { findUnique: vi.fn() },
  topUpVerification: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() }
};

function packageRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pkg-1',
    game: 'Mobile Legends',
    name: '86 Diamonds',
    diamondAmount: 86,
    price: { toString: () => '0.99' },
    currency: 'USD',
    isActive: true,
    providerId: null,
    providerServiceId: null,
    providerOfferId: null,
    providerService: null,
    provider: null,
    ...overrides
  };
}

/** Provider-linked package whose internal service UUID resolves to a real external FazerCards category. */
function fazerPackageRecord(overrides: Record<string, unknown> = {}) {
  return packageRecord({
    providerId: 'prov-1',
    // Internal reference: TopUpProviderService.id
    providerServiceId: 'svc-internal-uuid',
    // External identifiers used by the provider API:
    providerOfferId: '25_diamonds',
    providerService: { id: 'svc-internal-uuid', providerServiceId: 'free_fire_my_sg' },
    provider: {
      id: 'prov-1',
      name: 'FazerCards',
      status: 'ACTIVE',
      apiUrl: 'https://api.fzr.cards/api/v2',
      encryptedApiKey: encryptInventoryValue('secret-key')
    },
    ...overrides
  });
}

function orderRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    status: 'PAID',
    currency: 'USD',
    total: { toString: () => '0.99' },
    orderNumber: 59,
    items: [
      {
        id: 'item-1',
        deliveryTypeSnapshot: 'TOPUP',
        quantitySnapshot: 1,
        target: '12345678',
        serverId: '8001',
        customFieldValues: { zone: 'A1' },
        topUpPackage: fazerPackageRecord()
      }
    ],
    ...overrides
  };
}

describe('TopUpService', () => {
  let service: TopUpService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearSupportCacheForTests();
    service = new TopUpService(mockPrisma as unknown as PrismaClient);
    mockPrisma.topUpGameConfig.findUnique.mockResolvedValue(null);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('createCustomerTopUpOrder', () => {
    it('rejects a repeated idempotency key', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'existing-order',
        userId: 'someone-else',
        items: [{ topUpPackageId: 'pkg-1', target: null, serverId: null }]
      });

      const result = await service.createCustomerTopUpOrder('user-1', {
        packageId: 'pkg-1',
        idempotencyKey: 'topup-key-1'
      });

      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects inactive or missing packages', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord({ isActive: false }));

      const result = await service.createCustomerTopUpOrder('user-1', { packageId: 'pkg-1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Top-up package not found');
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects provider-linked packages whose provider is disabled', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRecord({ providerId: 'prov-1', providerServiceId: 'svc-1', provider: { id: 'prov-1', status: 'DISABLED' } })
      );

      const result = await service.createCustomerTopUpOrder('user-1', { packageId: 'pkg-1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Top-up provider is not available');
    });

    it('rejects provider-linked packages without a provider service ID', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRecord({ providerId: 'prov-1', providerServiceId: null, provider: { id: 'prov-1', status: 'ACTIVE' } })
      );

      const result = await service.createCustomerTopUpOrder('user-1', { packageId: 'pkg-1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Top-up package is missing a provider service ID');
    });

    it('requires a player ID for provider-linked packages', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRecord({
          providerId: 'prov-1',
          providerServiceId: 'svc-1',
          providerService: { id: 'svc-1', providerId: 'prov-1', status: 'ACTIVE', providerServiceId: 'free_fire_sg' },
          provider: { id: 'prov-1', status: 'ACTIVE' }
        })
      );

      const result = await service.createCustomerTopUpOrder('user-1', { packageId: 'pkg-1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player ID is required for this package');
    });

    it('rejects player IDs longer than 500 characters', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord());
      const tooLong = 'x'.repeat(501);

      const result = await service.createCustomerTopUpOrder('user-1', { packageId: 'pkg-1', target: tooLong });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid player ID');
    });

    it('creates a DRAFT order using the authoritative database price', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord({ price: { toString: () => '2.60' } }));
      mockPrisma.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 59,
        status: 'DRAFT',
        currency: 'USD',
        total: { toString: () => '2.60' },
        items: [{ id: 'item-1' }]
      });

      const result = await service.createCustomerTopUpOrder('user-1', { packageId: 'pkg-1' });

      expect(result.success).toBe(true);
      expect(result.order?.total).toBe('2.60');
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            status: 'DRAFT',
            subtotal: expect.objectContaining({ toString: expect.any(Function) }),
            total: expect.objectContaining({ toString: expect.any(Function) }),
            items: expect.objectContaining({
              create: expect.objectContaining({
                productId: null,
                topUpPackageId: 'pkg-1',
                deliveryTypeSnapshot: 'TOPUP',
                quantitySnapshot: 1,
                target: null
              })
            })
          })
        })
      );
    });

    it('snapshots the provider service ID and trimmed player ID for provider-linked packages', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRecord({
          providerId: 'prov-1',
          providerServiceId: 'svc-9',
          providerService: { id: 'svc-9', providerId: 'prov-1', status: 'ACTIVE', providerServiceId: 'free_fire_sg' },
          provider: {
            id: 'prov-1',
            name: 'FazerCards',
            status: 'ACTIVE',
            apiUrl: 'https://api.fzr.cards/api/v2',
            encryptedApiKey: encryptInventoryValue('secret-key')
          },
          game: { id: 'game-1', gameConfig: { allowUnverifiedPurchase: true } }
        })
      );
      // The live validation catalog does not list this category; the game
      // config explicitly allows unverified purchase, so ordering proceeds.
      fetchMock.mockImplementation(async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith('/topups/validate-id')) {
          const body = { ok: true, kind: 'topup', items: [], meta: { total: 0, has_more: false } };
          return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body), json: async () => body };
        }
        throw new Error(`unexpected fetch: ${u}`);
      });
      mockPrisma.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 60,
        status: 'DRAFT',
        currency: 'USD',
        total: { toString: () => '1.50' },
        items: [{ id: 'item-1' }]
      });

      const result = await service.createCustomerTopUpOrder('user-1', {
        packageId: 'pkg-1',
        target: '  987654  '
      });

      expect(result.success).toBe(true);
      const createCall = mockPrisma.order.create.mock.calls[0]?.[0] as { data: { items: { create: Record<string, unknown> } } };
      expect(createCall.data.items.create.providerServiceIdSnapshot).toBe('svc-9');
      expect(createCall.data.items.create.target).toBe('987654');
    });

    it('requires the server ID when the game config requires it', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue({
        game: 'Mobile Legends',
        requirePlayerId: true,
        requireServerId: true,
        customerNote: null,
        customFields: null
      });

      const missing = await service.createCustomerTopUpOrder('user-1', { packageId: 'pkg-1', target: '123' });

      expect(missing.success).toBe(false);
      expect(missing.error).toBe('Server ID is required for this package');
      expect(mockPrisma.order.create).not.toHaveBeenCalled();

      const tooLong = await service.createCustomerTopUpOrder('user-1', {
        packageId: 'pkg-1',
        target: '123',
        serverId: 'x'.repeat(101)
      });

      expect(tooLong.success).toBe(false);
      expect(tooLong.error).toBe('Invalid server ID');
    });

    it('stores the server ID with the order when required and provided', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue({
        game: 'Mobile Legends',
        requirePlayerId: true,
        requireServerId: true,
        customerNote: null,
        customFields: null
      });
      mockPrisma.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 61,
        status: 'DRAFT',
        currency: 'USD',
        total: { toString: () => '0.99' },
        items: [{ id: 'item-1' }]
      });

      const result = await service.createCustomerTopUpOrder('user-1', {
        packageId: 'pkg-1',
        target: '123',
        serverId: ' 8001  '
      });

      expect(result.success).toBe(true);
      const createCall = mockPrisma.order.create.mock.calls[0]?.[0] as { data: { items: { create: Record<string, unknown> } } };
      expect(createCall.data.items.create.serverId).toBe('8001');
    });

    it('does not require the player ID when the game config disables it', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue({
        game: 'Free Fire',
        requirePlayerId: false,
        requireServerId: false,
        customerNote: null,
        customFields: null
      });
      mockPrisma.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 62,
        status: 'DRAFT',
        currency: 'USD',
        total: { toString: () => '0.99' },
        items: [{ id: 'item-1' }]
      });

      const result = await service.createCustomerTopUpOrder('user-1', { packageId: 'pkg-1' });

      expect(result.success).toBe(true);
      const createCall = mockPrisma.order.create.mock.calls[0]?.[0] as { data: { items: { create: Record<string, unknown> } } };
      expect(createCall.data.items.create.target).toBeNull();
    });

    it('rejects arbitrary custom fields not configured by the admin', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue({
        game: 'Mobile Legends',
        requirePlayerId: true,
        requireServerId: false,
        customerNote: null,
        customFields: [{ key: 'zone', label: 'Zone', required: true }]
      });

      const result = await service.createCustomerTopUpOrder('user-1', {
        packageId: 'pkg-1',
        target: '123',
        customFields: { zone: 'A1', hacker_key: 'x' }
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid custom field');
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('validates required custom fields and stores only configured values', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue({
        game: 'Mobile Legends',
        requirePlayerId: true,
        requireServerId: false,
        customerNote: 'Deliveries take up to 10 minutes',
        customFields: [{ key: 'zone', label: 'Zone', required: true }, { key: 'nickname', label: 'Nickname', required: false }]
      });

      const missing = await service.createCustomerTopUpOrder('user-1', { packageId: 'pkg-1', target: '123' });
      expect(missing.success).toBe(false);
      expect(missing.error).toBe("'Zone' is required");

      mockPrisma.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 63,
        status: 'DRAFT',
        currency: 'USD',
        total: { toString: () => '0.99' },
        items: [{ id: 'item-1' }]
      });

      const result = await service.createCustomerTopUpOrder('user-1', {
        packageId: 'pkg-1',
        target: '123',
        customFields: { zone: ' A1 ', hacker_key: 'x' }
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid custom field');

      const ok = await service.createCustomerTopUpOrder('user-1', {
        packageId: 'pkg-1',
        target: '123',
        customFields: { zone: ' A1 ' }
      });

      expect(ok.success).toBe(true);
      const createCall = mockPrisma.order.create.mock.calls[0]?.[0] as { data: { items: { create: Record<string, unknown> } } };
      expect(createCall.data.items.create.customFieldValues).toEqual({ zone: 'A1' });
    });
  });

  describe('createTopUpOrder', () => {
    it('never submits the same order twice', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue({
        id: 'topup-order-1',
        providerOrderId: 'external-1'
      });

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(true);
      expect(result.order?.providerOrderId).toBe('external-1');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockPrisma.topUpOrder.create).not.toHaveBeenCalled();
    });

    it('rejects orders that do not belong to the user', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(orderRecord({ userId: 'someone-else' }));

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order does not belong to user');
    });

    it('rejects unpaid orders', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(orderRecord({ status: 'DRAFT' }));

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order must be paid before creating top-up order');
    });

    it('rejects orders without a top-up item', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(orderRecord({ items: [{ id: 'item-1', deliveryTypeSnapshot: 'SMM' }] }));

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No top-up item found in order');
    });

    it('rejects packages without a provider configured', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(
        orderRecord({ items: [{ id: 'item-1', deliveryTypeSnapshot: 'TOPUP', topUpPackage: packageRecord() }] })
      );

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Top-up package has no provider configured');
    });

    it('rejects disabled providers', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(
        orderRecord({ items: [{ id: 'item-1', deliveryTypeSnapshot: 'TOPUP', topUpPackage: packageRecord({ providerId: 'prov-1', provider: { id: 'prov-1', status: 'DISABLED' } }) }] })
      );

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Top-up provider is disabled');
    });

    it('rejects orders whose package has no valid external provider service', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(
        orderRecord({ items: [{ id: 'item-1', deliveryTypeSnapshot: 'TOPUP', target: '1', topUpPackage: fazerPackageRecord({ providerService: null }) }] })
      );

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('service unavailable');
      expect(result.error).toContain('preserved');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockPrisma.topUpOrder.create).not.toHaveBeenCalled();
    });

    it('rejects orders whose package is not linked to a provider offer', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(
        orderRecord({ items: [{ id: 'item-1', deliveryTypeSnapshot: 'TOPUP', target: '1', topUpPackage: fazerPackageRecord({ providerOfferId: null }) }] })
      );

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('offer unavailable');
      expect(result.error).toContain('preserved');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockPrisma.topUpOrder.create).not.toHaveBeenCalled();
    });

    it('surfaces provider failures without creating a top-up order', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(orderRecord());
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'boom'
      });

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('FazerCards API request failed');
      expect(mockPrisma.topUpOrder.create).not.toHaveBeenCalled();
    });

    it('creates the provider order and records the external order ID', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(orderRecord());
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, order_id: 'external-77' })
      });
      mockPrisma.topUpOrder.create.mockResolvedValue({
        id: 'topup-order-1',
        providerOrderId: 'external-77'
      });

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(true);
      expect(result.order?.providerOrderId).toBe('external-77');
      expect(mockPrisma.topUpOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order-1',
            topUpPackageId: 'pkg-1',
            providerId: 'prov-1',
            providerOrderId: 'external-77',
            status: 'PENDING'
          })
        })
      );
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSING' }) })
      );
    });

    it('sends the EXTERNAL category/offer IDs and the fields object to FazerCards — never internal UUIDs', async () => {
      mockPrisma.topUpOrder.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(orderRecord());
      // First fetch: offer metadata (field-key filtering). Second: the order.
      const okJson = (body: unknown) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(body),
        json: async () => body
      });
      fetchMock
        .mockImplementation(async (url: string | URL, init?: { method?: string; body?: string }) => {
          const u = String(url);
          if (u.endsWith('/topups/order') && init?.method === 'POST') {
            return okJson({ ok: true, order_id: 'external-88' });
          }
          if (u.includes('/topups/offers?')) {
            return okJson({
              ok: true,
              category_id: 'free_fire_my_sg',
              name: 'Free Fire (MY/SG)',
              offers: [{ offer_id: '25_diamonds', name: '25 Diamonds', price_usd: '0.23' }],
              fields: [{ key: 'player_id', label: 'Player ID' }, { key: 'server_id', label: 'Server ID' }]
            });
          }
          throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${u}`);
        });
      mockPrisma.topUpOrder.create.mockResolvedValue({
        id: 'topup-order-2',
        providerOrderId: 'external-88'
      });

      const result = await service.createTopUpOrder('user-1', 'order-1');

      expect(result.success).toBe(true);
      const postCall = fetchMock.mock.calls.find(([, init]) => (init as { method?: string }).method === 'POST') as [string, { body: string }];
      expect(postCall[0]).toBe('https://api.fzr.cards/api/v2/topups/order');
      const body = JSON.parse(postCall[1].body) as Record<string, unknown>;
      // External identifiers only:
      expect(body.category_id).toBe('free_fire_my_sg');
      expect(body.offer_id).toBe('25_diamonds');
      expect(body.service_id).toBeUndefined();
      // Player/server inputs land in the fields object…
      const fields = body.fields as Record<string, string>;
      expect(fields.player_id).toBe('12345678');
      expect(fields.server_id).toBe('8001');
      // …and verification-only extras NOT declared by the category's offers
      // are filtered out of the supplier payload (they stay in our records).
      expect(fields.zone).toBeUndefined();
      expect(mockPrisma.topUpOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            target: '12345678',
            serverId: '8001',
            customFieldValues: { zone: 'A1' }
          })
        })
      );
    });
  });
});