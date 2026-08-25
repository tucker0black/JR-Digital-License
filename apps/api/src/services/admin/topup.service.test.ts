import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AdminTopUpService } from './topup.service.js';
import { encryptInventoryValue } from '../../utils/encryption.js';

process.env.INVENTORY_ENCRYPTION_KEY = 'test-inventory-encryption-key-0123456789abcdef';

const mockPrisma = {
  topUpProvider: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  topUpPackage: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  topUpGame: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  topUpOrder: { count: vi.fn() },
  topUpGameConfig: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  topUpProviderService: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
};

function providerRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prov-1',
    name: 'FazerCards',
    apiUrl: 'https://panel.example.com/api/v2',
    encryptedApiKey: encryptInventoryValue('secret-key'),
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides
  };
}

function gameRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'game-1',
    name: 'Mobile Legends',
    imageUrl: null,
    providerId: null,
    providerServiceId: null,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    provider: null,
    _count: { packages: 0 },
    gameConfig: null,
    ...overrides
  };
}

function packageRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pkg-1',
    gameId: 'game-1',
    name: '86 Diamonds',
    diamondAmount: 86,
    price: { toString: () => '0.99' },
    currency: 'USD',
    providerId: null,
    providerServiceId: null,
    providerCost: null,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    game: { id: 'game-1', name: 'Mobile Legends', providerId: null, providerServiceId: null },
    provider: null,
    ...overrides
  };
}

function gameConfigRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    gameId: 'game-1',
    requirePlayerId: true,
    requireServerId: false,
    customerNote: null,
    customFields: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides
  };
}

describe('AdminTopUpService', () => {
  let service: AdminTopUpService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AdminTopUpService(mockPrisma as unknown as PrismaClient);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(mockPrisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('providers', () => {
    it('never returns API key material', async () => {
      mockPrisma.topUpProvider.findMany.mockResolvedValue([
        { ...providerRecord(), _count: { packages: 2 } }
      ]);

      const result = await service.getProviders();

      expect(result.providers[0]).not.toHaveProperty('encryptedApiKey');
      expect(JSON.stringify(result.providers)).not.toContain('secret-key');
      expect(result.providers[0]).toMatchObject({ name: 'FazerCards', packageCount: 2 });
    });

    it('encrypts the API key and records an audit log on create', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue(null);
      mockPrisma.topUpProvider.create.mockResolvedValue(providerRecord());

      const result = await service.createProvider(
        { name: 'FazerCards', apiUrl: 'https://panel.example.com/api/v2', apiKey: 'secret-key' },
        'admin-1'
      );

      const createData = mockPrisma.topUpProvider.create.mock.calls[0]?.[0] as { data: { encryptedApiKey: string } };
      expect(createData.data.encryptedApiKey).not.toBe('secret-key');
      expect(result).not.toHaveProperty('encryptedApiKey');
      expect(JSON.stringify(result)).not.toContain('secret-key');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: 'admin-1',
            entityType: 'TopUpProvider',
            action: 'CREATE'
          })
        })
      );
    });

    it('refuses duplicate provider names', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue(providerRecord());

      await expect(
        service.createProvider({ name: 'FazerCards', apiUrl: 'https://x.com', apiKey: 'k' }, 'admin-1')
      ).rejects.toThrow('already exists');
    });

    it('re-encrypts only when a new API key is supplied', async () => {
      mockPrisma.topUpProvider.findUnique
        .mockResolvedValueOnce({ ...providerRecord(), _count: { packages: 0 } })
        .mockResolvedValueOnce({ ...providerRecord(), _count: { packages: 0 } });
      mockPrisma.topUpProvider.update.mockResolvedValue(providerRecord({ apiUrl: 'https://new.example.com' }));

      await service.updateProvider('prov-1', { apiUrl: 'https://new.example.com' }, 'admin-1');
      const updateCall = mockPrisma.topUpProvider.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateCall.data.encryptedApiKey).toBeUndefined();

      await service.updateProvider('prov-1', { apiKey: 'new-secret' }, 'admin-1');
      const secondCall = mockPrisma.topUpProvider.update.mock.calls[1]?.[0] as { data: { encryptedApiKey: string } };
      expect(secondCall.data.encryptedApiKey).not.toBe('new-secret');
    });

    it('records STATUS_CHANGED audit entries', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue({ ...providerRecord(), _count: { packages: 0 } });
      mockPrisma.topUpProvider.update.mockResolvedValue(providerRecord({ status: 'DISABLED' }));

      await service.setProviderStatus('prov-1', 'DISABLED', 'admin-1');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'STATUS_CHANGED',
            oldValue: { status: 'ACTIVE' },
            newValue: { status: 'DISABLED' }
          })
        })
      );
    });

    it('refuses to delete a provider that still has linked packages', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue({ ...providerRecord(), _count: { packages: 3 } });

      await expect(service.deleteProvider('prov-1', 'admin-1')).rejects.toThrow('linked packages');
      expect(mockPrisma.topUpProvider.delete).not.toHaveBeenCalled();
    });

    it('deletes a provider with no packages and audits the action', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue({ ...providerRecord(), _count: { packages: 0 } });
      mockPrisma.topUpProvider.delete.mockResolvedValue({});

      const result = await service.deleteProvider('prov-1', 'admin-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.topUpProvider.delete).toHaveBeenCalledWith({ where: { id: 'prov-1' } });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'DELETE' }) })
      );
    });

    it('reports failed connection tests with the real error', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue(providerRecord());
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'invalid token'
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.testProviderConnection('prov-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
      vi.unstubAllGlobals();
    });
  });

  describe('games', () => {
    it('creates a game with defaults and audits the action', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(null);
      mockPrisma.topUpGame.create.mockResolvedValue(gameRecord());

      const result = await service.createGame({ name: 'Mobile Legends' }, 'admin-1');

      expect(result).toMatchObject({ name: 'Mobile Legends', isActive: true, sortOrder: 0 });
      const createCall = mockPrisma.topUpGame.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(createCall.data.isActive).toBe(true);
      expect(createCall.data.sortOrder).toBe(0);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: 'admin-1',
            entityType: 'TopUpGame',
            action: 'CREATE'
          })
        })
      );
    });

    it('refuses duplicate game names', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());

      await expect(
        service.createGame({ name: 'Mobile Legends' }, 'admin-1')
      ).rejects.toThrow('already exists');
    });

    it('updates an existing game with the configured fields', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());
      mockPrisma.topUpGame.update.mockResolvedValue(
        gameRecord({ providerId: 'prov-1', providerServiceId: 'svc-1', isActive: false })
      );

      const result = await service.updateGame('game-1', {
        providerId: 'prov-1',
        providerServiceId: 'svc-1',
        isActive: false
      }, 'admin-1');

      expect(result.providerId).toBe('prov-1');
      expect(result.providerServiceId).toBe('svc-1');
      expect(result.isActive).toBe(false);
      const updateCall = mockPrisma.topUpGame.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateCall.data.providerId).toBe('prov-1');
      expect(updateCall.data.providerServiceId).toBe('svc-1');
      expect(updateCall.data.isActive).toBe(false);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'UPDATE' }) })
      );
    });

    it('records STATUS_CHANGED audit entries', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue({ ...gameRecord(), _count: { packages: 0 } });
      mockPrisma.topUpGame.update.mockResolvedValue(gameRecord({ isActive: false }));

      await service.setGameStatus('game-1', false, 'admin-1');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DISABLE',
            oldValue: { isActive: true },
            newValue: { isActive: false }
          })
        })
      );
    });

    it('refuses to delete a game that still has packages', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue({ ...gameRecord(), _count: { packages: 3 } });

      await expect(service.deleteGame('game-1', 'admin-1')).rejects.toThrow('still has packages');
      expect(mockPrisma.topUpGame.delete).not.toHaveBeenCalled();
    });

    it('deletes a game with no packages and audits the action', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue({ ...gameRecord(), _count: { packages: 0 } });
      mockPrisma.topUpGame.delete.mockResolvedValue({});

      const result = await service.deleteGame('game-1', 'admin-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.topUpGame.delete).toHaveBeenCalledWith({ where: { id: 'game-1' } });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'DELETE' }) })
      );
    });
  });

  describe('packages', () => {
    it('requires a provider service ID when a provider is selected', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord({ providerId: 'prov-1' }));
      mockPrisma.topUpProvider.findUnique.mockResolvedValue(providerRecord());

      await expect(
        service.createPackage(
          { gameId: 'game-1', name: '86 Diamonds', diamondAmount: 86, price: '0.99', providerId: 'prov-1' },
          'admin-1'
        )
      ).rejects.toThrow('Provider service ID is required');
    });

    it('rejects non-positive prices', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());

      await expect(
        service.createPackage({ gameId: 'game-1', name: '86 Diamonds', diamondAmount: 86, price: '0' }, 'admin-1')
      ).rejects.toThrow('Price must be a positive number');
    });

    it('creates a package without a provider when none is selected', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());
      mockPrisma.topUpPackage.create.mockResolvedValue(packageRecord());

      const result = await service.createPackage(
        { gameId: 'game-1', name: '86 Diamonds', diamondAmount: 86, price: '0.99' },
        'admin-1'
      );

      expect(result).toMatchObject({ game: 'Mobile Legends', provider: null });
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('stores text-only package content and derives a legacy numeric fallback', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());
      mockPrisma.topUpPackage.create.mockResolvedValue(
        packageRecord({ name: 'Prime (1 Month)', content: 'Prime (1 Month)', diamondAmount: 0 })
      );

      const result = await service.createPackage(
        { gameId: 'game-1', name: 'Prime (1 Month)', content: ' Prime (1 Month) ', price: '1.50' },
        'admin-1'
      );

      const createData = mockPrisma.topUpPackage.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(createData.data.content).toBe('Prime (1 Month)');
      expect(createData.data.diamondAmount).toBe(0);
      expect(result).toMatchObject({ content: 'Prime (1 Month)', diamondAmount: 0 });
    });

    it('updates generic package content without requiring or changing diamondAmount', async () => {
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord({ content: null }));
      mockPrisma.topUpPackage.update.mockResolvedValue(packageRecord({ content: 'Elite Pass LV1-100' }));

      await service.updatePackage('pkg-1', { content: ' Elite Pass LV1-100 ' }, 'admin-1');

      const updateData = mockPrisma.topUpPackage.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateData.data.content).toBe('Elite Pass LV1-100');
      expect(updateData.data.diamondAmount).toBeUndefined();
    });

    it('stores provider binding and cost on create', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord({ providerId: 'prov-1', providerServiceId: 'svc-1' }));
      mockPrisma.topUpProvider.findUnique.mockResolvedValue(providerRecord());
      mockPrisma.topUpPackage.create.mockResolvedValue(
        packageRecord({ providerId: 'prov-1', providerServiceId: 'svc-1', providerCost: { toString: () => '0.50' } })
      );

      const result = await service.createPackage(
        { gameId: 'game-1', name: '86 Diamonds', diamondAmount: 86, price: '0.99', providerCost: '0.50' },
        'admin-1'
      );

      const createData = mockPrisma.topUpPackage.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(createData.data.providerId).toBe('prov-1');
      expect(createData.data.providerServiceId).toBe('svc-1');
      expect(createData.data.providerCost).not.toBeNull();
      expect(result.providerCost).toBe('0.50');
    });

    it('clears provider binding when game is changed to one without provider', async () => {
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRecord({ gameId: 'game-1', providerId: 'prov-1', providerServiceId: 'svc-1', providerCost: { toString: () => '0.50' } })
      );
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord({ providerId: null }));
      mockPrisma.topUpPackage.update.mockResolvedValue(packageRecord());

      await service.updatePackage('pkg-1', { gameId: 'game-2' }, 'admin-1');

      const updateData = mockPrisma.topUpPackage.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateData.data.providerId).toBeNull();
      expect(updateData.data.providerServiceId).toBeNull();
      expect(updateData.data.providerCost).toBeNull();
    });

    it('clears provider binding when providerId is removed', async () => {
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRecord({ providerId: 'prov-1', providerServiceId: 'svc-1', providerCost: { toString: () => '0.50' } })
      );
      mockPrisma.topUpPackage.update.mockResolvedValue(packageRecord());

      await service.updatePackage('pkg-1', { providerId: null }, 'admin-1');

      const updateData = mockPrisma.topUpPackage.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateData.data.providerId).toBeNull();
      expect(updateData.data.providerServiceId).toBeNull();
      expect(updateData.data.providerCost).toBeNull();
    });

    it('refuses to delete a package that has historical orders', async () => {
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord());
      mockPrisma.topUpOrder.count.mockResolvedValue(1);

      await expect(service.deletePackage('pkg-1', 'admin-1')).rejects.toThrow('historical orders');
      expect(mockPrisma.topUpPackage.delete).not.toHaveBeenCalled();
    });

    it('deletes a package with no orders and audits the action', async () => {
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRecord());
      mockPrisma.topUpOrder.count.mockResolvedValue(0);
      mockPrisma.topUpPackage.delete.mockResolvedValue({});

      const result = await service.deletePackage('pkg-1', 'admin-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.topUpPackage.delete).toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'DELETE' }) })
      );
    });
  });

  describe('live provider catalog (Fetch Services / Fetch Offers)', () => {
    function jsonResponse(body: unknown, status = 200) {
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: 'OK',
        text: async () => JSON.stringify(body),
        json: async () => body
      };
    }

    it('fetches all catalog pages and warns about stored services missing from the live account — without mutating anything', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue({
        ...providerRecord(),
        services: [
          { id: 'svc-live', name: 'Free Fire (SG)', providerServiceId: 'free_fire_sg' },
          { id: 'svc-stale', name: 'FreeFire', providerServiceId: 'fc_f4b0574484f125da5580fe99' }
        ]
      });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({
          ok: true,
          items: [{ category_id: 'free_fire_sg', name: 'Free Fire (SG)', note: 'Region: Singapore\nFree Fire top-up.' }],
          meta: { total: 2, limit: 1, next_cursor: 'CUR-1', has_more: true }
        }))
        .mockResolvedValueOnce(jsonResponse({
          ok: true,
          items: [{ category_id: 'pubg_mobile_auto', name: 'PUBG Mobile (Auto)', note: 'Region: Global' }],
          meta: { total: 2, next_cursor: null, has_more: false }
        }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.fetchRemoteCategories('prov-1');

      expect(result.categories).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.categories[0].region).toBe('Singapore');
      // The stale stored service is reported as a warning…
      expect(result.warnings).toEqual([
        { id: 'svc-stale', name: 'FreeFire', providerServiceId: 'fc_f4b0574484f125da5580fe99' }
      ]);
      // …and NOTHING was mutated in the database:
      expect(mockPrisma.topUpProviderService.update).not.toHaveBeenCalled();
      expect(mockPrisma.topUpProviderService.delete).not.toHaveBeenCalled();
      expect(mockPrisma.topUpProviderService.create).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('resolves an internal service UUID to the external category id before fetching offers', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue(providerRecord());
      mockPrisma.topUpProviderService.findFirst.mockResolvedValue({ providerServiceId: 'free_fire_sg' });
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        ok: true,
        category_id: 'free_fire_sg',
        name: 'Free Fire (SG)',
        offers: [{ offer_id: '25_diamonds', name: '25 Diamonds', price_usd: '0.2300' }],
        fields: [{ key: 'player_id', label: 'Player ID' }],
        note: null
      }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.fetchRemoteOffers('prov-1', '8e88d0aa-1111-4222-8333-444444444444');

      expect(mockPrisma.topUpProviderService.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: '8e88d0aa-1111-4222-8333-444444444444', providerId: 'prov-1' } })
      );
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('category_id=free_fire_sg');
      // Internal UUID must never reach the provider:
      expect(url).not.toContain('8e88d0aa');
      expect(result.offers).toHaveLength(1);
      expect(result.offers[0]).toMatchObject({ offer_id: '25_diamonds', offer_name: '25 Diamonds', price_usd: 0.23 });
      expect(result.fields.map((f) => f.key)).toEqual(['player_id']);
      vi.unstubAllGlobals();
    });

    it('reports a preserved configuration when the live offers request fails', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue(providerRecord());
      mockPrisma.topUpProviderService.findFirst.mockResolvedValue(null);

      await expect(service.fetchRemoteOffers('prov-1', '8e88d0aa-1111-4222-8333-444444444444'))
        .rejects.toThrow(/service unavailable.*preserved/s);
      // No database changes were attempted:
      expect(mockPrisma.topUpProviderService.update).not.toHaveBeenCalled();
      expect(mockPrisma.topUpProviderService.delete).not.toHaveBeenCalled();
    });

    it('reports a preserved configuration when the provider rejects the offers request', async () => {
      mockPrisma.topUpProvider.findUnique.mockResolvedValue(providerRecord());
      mockPrisma.topUpProviderService.findFirst.mockResolvedValue(null);
      const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
      vi.stubGlobal('fetch', fetchSpy);

      await expect(service.fetchRemoteOffers('prov-1', 'unknown_category')).rejects.toThrow('preserved');
      vi.unstubAllGlobals();
    });
  });

  describe('provider offer linking and key switching safety', () => {
    it('linkPackageOffer updates only the offer binding and cost — never price, name or status', async () => {
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRecord({
          providerId: 'prov-1',
          price: { toString: () => '0.99' },
          providerCost: { toString: () => '0.29' }
        })
      );
      mockPrisma.topUpPackage.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
        packageRecord({
          providerId: 'prov-1',
          providerOfferId: data.providerOfferId as string,
          providerCost: { toString: () => String(data.providerCost) },
          price: { toString: () => '0.99' }
        })
      );

      const result = await service.linkPackageOffer(
        'pkg-1',
        { providerOfferId: '25_diamonds', providerCost: '0.23' },
        'admin-1'
      );

      const updateCall = mockPrisma.topUpPackage.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateCall.data).toEqual({ providerOfferId: '25_diamonds', providerCost: expect.anything() });
      expect(Object.keys(updateCall.data)).not.toContain('price');
      expect(Object.keys(updateCall.data)).not.toContain('name');
      expect(Object.keys(updateCall.data)).not.toContain('isActive');
      expect(result.providerOfferId).toBe('25_diamonds');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'PROVIDER_OFFER_LINKED', entityType: 'TopUpPackage' })
        })
      );
    });

    it('changing the provider API key does not delete or disable services, games or packages', async () => {
      mockPrisma.topUpProvider.findUnique
        .mockResolvedValueOnce({ ...providerRecord(), _count: { packages: 5 } });
      mockPrisma.topUpProvider.update.mockResolvedValue(providerRecord());

      await service.updateProvider('prov-1', { apiKey: 'brand-new-key' }, 'admin-1');

      const updateCall = mockPrisma.topUpProvider.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      // Only credentials changed:
      expect(updateCall.data.encryptedApiKey).toBeDefined();
      expect(updateCall.data.status).toBeUndefined();
      expect(updateCall.data.name).toBeUndefined();
      // Nothing was deleted anywhere:
      expect(mockPrisma.topUpProvider.delete).not.toHaveBeenCalled();
      expect(mockPrisma.topUpProviderService.delete).not.toHaveBeenCalled();
      expect(mockPrisma.topUpGame.delete).not.toHaveBeenCalled();
      expect(mockPrisma.topUpPackage.delete).not.toHaveBeenCalled();
      // No packages were disabled either:
      expect(mockPrisma.topUpPackage.update).not.toHaveBeenCalled();
      // Audit records that the key was rotated:
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ newValue: expect.objectContaining({ apiKeyChanged: true }) })
        })
      );
    });
  });

  describe('game input configuration', () => {
    it('creates a config with defaults and audits the action', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue(null);
      mockPrisma.topUpGameConfig.create.mockResolvedValue(gameConfigRecord());

      const result = await service.upsertGameConfig({ gameId: 'game-1' }, 'admin-1');

      expect(result).toMatchObject({ game: 'game-1', requirePlayerId: true, requireServerId: false });
      const createCall = mockPrisma.topUpGameConfig.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(createCall.data.requirePlayerId).toBe(true);
      expect(createCall.data.requireServerId).toBe(false);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entityType: 'TopUpGameConfig', action: 'CREATE' }) })
      );
    });

    it('updates an existing config with the configured fields', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue(gameConfigRecord());
      mockPrisma.topUpGameConfig.update.mockResolvedValue(
        gameConfigRecord({ requireServerId: true, customFields: [{ key: 'zone', label: 'Zone', required: true }] })
      );

      const result = await service.upsertGameConfig(
        {
          gameId: 'game-1',
          requirePlayerId: true,
          requireServerId: true,
          customerNote: 'Deliveries may take a few minutes',
          customFields: [{ key: 'zone', label: 'Zone', required: true }]
        },
        'admin-1'
      );

      expect(result.requireServerId).toBe(true);
      expect(result.customFields).toEqual([{ key: 'zone', label: 'Zone', required: true, placeholder: undefined }]);
      const updateCall = mockPrisma.topUpGameConfig.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateCall.data.customFields).toEqual([{ key: 'zone', label: 'Zone', required: true, placeholder: undefined }]);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'UPDATE' }) })
      );
    });

    it('rejects invalid custom field keys', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertGameConfig(
          { gameId: 'game-1', customFields: [{ key: 'zone id!', label: 'Zone', required: false }] },
          'admin-1'
        )
      ).rejects.toThrow('Custom field keys must contain only letters, numbers, and underscores');
      expect(mockPrisma.topUpGameConfig.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate custom field keys', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertGameConfig(
          {
            gameId: 'game-1',
            customFields: [
              { key: 'zone', label: 'Zone', required: false },
              { key: 'zone', label: 'Zone 2', required: false }
            ]
          },
          'admin-1'
        )
      ).rejects.toThrow('Custom field keys must be unique');
    });

    it('deletes a config and audits the action', async () => {
      mockPrisma.topUpGame.findUnique.mockResolvedValue(gameRecord());
      mockPrisma.topUpGameConfig.findUnique.mockResolvedValue(gameConfigRecord());
      mockPrisma.topUpGameConfig.delete.mockResolvedValue({});

      const result = await service.deleteGameConfig('game-1', 'admin-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.topUpGameConfig.delete).toHaveBeenCalledWith({ where: { id: 'cfg-1' } });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'DELETE' }) })
      );
    });
  });
});
