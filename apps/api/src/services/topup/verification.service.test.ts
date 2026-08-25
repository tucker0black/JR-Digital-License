import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { TopUpVerificationService, clearSupportCacheForTests } from './verification.service.js';
import { encryptInventoryValue } from '../../utils/encryption.js';

process.env.INVENTORY_ENCRYPTION_KEY = 'test-inventory-encryption-key-0123456789abcdef';
process.env.TOPUP_VERIFICATION_TTL_MINUTES = '10';

const mockPrisma = {
  topUpPackage: { findUnique: vi.fn() },
  topUpProvider: { findUnique: vi.fn() },
  topUpProviderService: { findUnique: vi.fn() },
  topUpVerification: { updateMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() }
};

const PROVIDER_ROW = {
  id: 'prov-1',
  name: 'FazerCards',
  apiUrl: 'https://api.fzr.cards/api/v2',
  encryptedApiKey: encryptInventoryValue('secret-key'),
  status: 'ACTIVE'
};

function packageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pkg-1',
    gameId: 'game-1',
    providerId: 'prov-1',
    providerServiceId: 'svc-internal',
    game: { id: 'game-1', gameConfig: null },
    providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'free_fire_sg' },
    provider: { id: 'prov-1', name: 'FazerCards', status: 'ACTIVE' },
    ...overrides
  };
}

/** GET /topups/validate-id response builder Ã¢â‚¬â€ mirrors the live envelope. */
function supportResponse(items: Array<{ category_id: string; name: string; fields: Array<{ key: string; label: string; type?: string }> }>) {
  return jsonResponse({ ok: true, kind: 'topup', items, meta: { total: items.length, has_more: false } });
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

describe('TopUpVerificationService (generic, provider-driven)', () => {
  let service: TopUpVerificationService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearSupportCacheForTests();
    vi.clearAllMocks();
    service = new TopUpVerificationService(mockPrisma as unknown as PrismaClient);
    mockPrisma.topUpProvider.findUnique.mockResolvedValue(PROVIDER_ROW);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Catalog fixture: exactly what FazerCards returns Ã¢â‚¬â€ no game names in code. */
  function stubCatalog(categories: Array<{ category_id: string; name: string; fields: Array<{ key: string; label: string }> }>) {
    fetchMock.mockImplementation(async (url: string | URL, init?: { method?: string }) => {
      const u = String(url);
      if (u.endsWith('/topups/validate-id') && (!init?.method || init.method === 'GET')) {
        return supportResponse(categories);
      }
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${u}`);
    });
  }

  describe('dynamic field configurations (TEST A/B/C)', () => {
    const cases: Array<{
      name: string;
      catalogFields: Array<{ key: string; label: string }>;
      submitted: Record<string, string>;
      expectedBodyFields: Record<string, string>;
    }> = [
      {
        name: 'TEST A: one required field (player_id)',
        catalogFields: [{ key: 'player_id', label: 'Player ID' }],
        submitted: { player_id: '123456789' },
        expectedBodyFields: { player_id: '123456789' }
      },
      {
        name: 'TEST B: two required fields (player_id + server_id)',
        catalogFields: [
          { key: 'player_id', label: 'Player ID' },
          { key: 'server_id', label: 'Server ID' }
        ],
        submitted: { player_id: '123456789', server_id: '1234' },
        expectedBodyFields: { player_id: '123456789', server_id: '1234' }
      },
      {
        name: 'TEST C: three+ dynamic future fields (uid/zone/nickname)',
        catalogFields: [
          { key: 'uid', label: 'UID' },
          { key: 'zone', label: 'Zone' },
          { key: 'nickname', label: 'Nickname' }
        ],
        submitted: { uid: '987654321', zone: 'EU', nickname: 'JR' },
        expectedBodyFields: { uid: '987654321', zone: 'EU', nickname: 'JR' }
      }
    ];

    for (const c of cases) {
    it(c.name, async () => {
      stubCatalog([{ category_id: 'some_future_game', name: 'Some Future Game', fields: c.catalogFields }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRow({ providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'some_future_game' } })
      );
      // POST validate-id
      fetchMock.mockImplementation(async (url: string | URL, init?: { method?: string; body?: string }) => {
        const u = String(url);
        if (u.endsWith('/topups/validate-id') && init?.method === 'POST') {
          return jsonResponse({ ok: true, category_id: 'some_future_game', valid: true, player_name: 'MetaDriven' });
        }
        return supportResponse([{ category_id: 'some_future_game', name: 'Some Future Game', fields: c.catalogFields }]);
      });
      mockPrisma.topUpVerification.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.topUpVerification.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'ver-1', ...data
      }));

        const result = await service.verifyPlayer('user-1', 'pkg-1', c.submitted);

        expect(result.valid).toBe(true);
        expect(result.playerName).toBe('MetaDriven');
        expect(result.verificationToken).toBe('ver-1');

        const postCall = fetchMock.mock.calls.find(([, init]) => (init as { method?: string }).method === 'POST');
        const body = JSON.parse((postCall?.[1] as { body: string }).body);
        expect(Object.keys(body).sort()).toEqual(['category_id', 'fields']);
        expect(body.category_id).toBe('some_future_game');
        expect(body.fields).toEqual(c.expectedBodyFields);

        // Persisted verification stores the same dynamic map + hash.
        const createData = mockPrisma.topUpVerification.create.mock.calls[0][0].data;
        expect(createData.fields).toEqual(c.expectedBodyFields);
        expect(createData.expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    }

    it('resolves REGIONAL category ids to their GENERIC validation family (metadata-driven, no game names)', async () => {
      // Provider validate-id lists only the generic familyâ€¦
      stubCatalog([
        { category_id: 'mobile_legends', name: 'Mobile Legends', fields: [{ key: 'player_id', label: 'Player ID' }, { key: 'zone_id', label: 'Zone ID' }] }
      ]);
      // â€¦while the store package is configured with the regional ordering id.
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRow({ providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'mobile_legends_singapore' } })
      );
      fetchMock.mockImplementation(async (url: string | URL, init?: { method?: string }) => {
        if (String(url).endsWith('/topups/validate-id') && init?.method === 'POST') {
          return jsonResponse({ ok: true, category_id: 'mobile_legends', valid: true, player_name: 'Zoner' });
        }
        return supportResponse([{ category_id: 'mobile_legends', name: 'Mobile Legends', fields: [{ key: 'player_id', label: 'Player ID' }, { key: 'zone_id', label: 'Zone ID' }] }]);
      });
      mockPrisma.topUpVerification.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.topUpVerification.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'tok-z', ...data }));

      const info = await service.getVerificationInfo('pkg-1');
      expect(info.verificationAvailable).toBe(true);
      expect(info.categoryId).toBe('mobile_legends'); // family used for validation
      expect(info.fields.map((f) => f.key)).toEqual(['player_id', 'zone_id']);

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '123', zone_id: '2401' });
      expect(result.valid).toBe(true);
      const postCall = fetchMock.mock.calls.find(([, init]) => (init as { method?: string }).method === 'POST');
      const body = JSON.parse((postCall?.[1] as { body: string }).body);
      expect(body.category_id).toBe('mobile_legends');
      expect(body.fields).toEqual({ player_id: '123', zone_id: '2401' });
    });

    it('LIVE SHAPE: free_fire_sg resolves to the free_fire validation family and reports available', async () => {
      // Exact live GET /topups/validate-id payload (FazerCards, Aug 2026).
      stubCatalog([
        { category_id: 'pubg_mobile', name: 'PUBG Mobile', fields: [{ key: 'player_id', label: 'Player ID' }] },
        { category_id: 'free_fire', name: 'Free Fire', fields: [{ key: 'player_id', label: 'Player ID' }] },
        { category_id: 'mobile_legends', name: 'Mobile Legends', fields: [{ key: 'player_id', label: 'User ID' }, { key: 'zone_id', label: 'Zone ID' }] }
      ]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRow({ providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'free_fire_sg' } })
      );

      const info = await service.getVerificationInfo('pkg-1');

      expect(info.applicable).toBe(true);
      expect(info.verificationAvailable).toBe(true);
      expect(info.categoryId).toBe('free_fire'); // FAMILY id used for POST /topups/validate-id
      expect(info.fields).toEqual([{ key: 'player_id', label: 'Player ID', type: undefined }]);
      expect(info.providerId).toBe('prov-1');
    });

    it('uses the admin-pinned verification provider/service override when configured', async () => {
      // Ordering category is NOT in the support list…
      stubCatalog([
        { category_id: 'free_fire', name: 'Free Fire', fields: [{ key: 'player_id', label: 'Player ID' }] }
      ]);
      // …but the game config pins an explicit verification service whose
      // external id IS listed. Resolution must follow the override.
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRow({
          game: {
            id: 'game-1',
            gameConfig: {
              allowUnverifiedPurchase: false,
              verificationProviderId: 'prov-1',
              verificationServiceId: 'svc-verify'
            }
          },
          providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'some_other_game_global' }
        })
      );
      mockPrisma.topUpProviderService.findUnique.mockResolvedValue({
        id: 'svc-verify',
        providerId: 'prov-1',
        providerServiceId: 'free_fire',
        status: 'ACTIVE'
      });
      fetchMock.mockImplementation(async (url: string | URL, init?: { method?: string; body?: string }) => {
        if (String(url).endsWith('/topups/validate-id') && init?.method === 'POST') {
          return jsonResponse({ ok: true, category_id: 'free_fire', valid: true, player_name: 'OverrideNick' });
        }
        return supportResponse([{ category_id: 'free_fire', name: 'Free Fire', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      });
      mockPrisma.topUpVerification.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.topUpVerification.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'tok-o', ...data }));

      const info = await service.getVerificationInfo('pkg-1');
      expect(info.verificationAvailable).toBe(true);
      expect(info.categoryId).toBe('free_fire');

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '42' });
      expect(result.valid).toBe(true);
      expect(result.playerName).toBe('OverrideNick');
      const postCall = fetchMock.mock.calls.find(([, init]) => (init as { method?: string }).method === 'POST');
      expect(JSON.parse((postCall?.[1] as { body: string }).body).category_id).toBe('free_fire');

      // The persisted record reflects the OVERRIDE service, not the ordering one.
      const createData = mockPrisma.topUpVerification.create.mock.calls[0][0].data;
      expect(createData.providerServiceId).toBe('svc-verify');
    });

    it('falls back to the ordering category when the pinned override is misconfigured', async () => {
      stubCatalog([
        { category_id: 'free_fire', name: 'Free Fire', fields: [{ key: 'player_id', label: 'Player ID' }] }
      ]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRow({
          game: {
            id: 'game-1',
            gameConfig: {
              allowUnverifiedPurchase: false,
              verificationProviderId: 'prov-1',
              verificationServiceId: 'svc-broken'
            }
          },
          providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'free_fire_sg' }
        })
      );
      // Override row does not exist / wrong provider / disabled.
      mockPrisma.topUpProviderService.findUnique.mockResolvedValue(null);

      const info = await service.getVerificationInfo('pkg-1');
      expect(info.verificationAvailable).toBe(true); // via free_fire_sg prefix rule
      expect(info.categoryId).toBe('free_fire');
    });

    it('rejects a missing dynamic field before calling the provider', async () => {
      stubCatalog([
        {
          category_id: 'mlbb_sg',
          name: 'MLBB SG',
          fields: [
            { key: 'player_id', label: 'Player ID' },
            { key: 'server_id', label: 'Server ID' }
          ]
        }
      ]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRow({ providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'mlbb_sg' } })
      );

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '123456789' });

      expect(result.reason).toBe('MISSING_FIELDS');
      expect(fetchMock.mock.calls.filter(([, init]) => (init as { method?: string }).method === 'POST')).toHaveLength(0);
    });

    it('rejects unknown fields not declared by the provider', async () => {
      stubCatalog([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '1', hacker_key: 'x' });

      expect(result.reason).toBe('UNKNOWN_FIELD');
    });
  });

  describe('validation support detection (TEST D/E)', () => {
    it('TEST D: supported category verifies and returns a token', async () => {
      stubCatalog([{ category_id: 'free_fire_sg', name: 'Free Fire (SG)', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());
      fetchMock.mockImplementation(async (url: string | URL, init?: { method?: string }) => {
        if (String(url).endsWith('/topups/validate-id') && init?.method === 'POST') {
          return jsonResponse({ ok: true, category_id: 'free_fire_sg', valid: true, player_name: 'JimRotha' });
        }
        return supportResponse([{ category_id: 'free_fire_sg', name: 'Free Fire (SG)', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      });
      mockPrisma.topUpVerification.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.topUpVerification.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'tok-1', ...data }));

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '555' });

      expect(result).toMatchObject({ valid: true, verified: true, playerName: 'JimRotha', verificationToken: 'tok-1' });
    });

    it('TEST E: category NOT in the live list returns VALIDATION_NOT_SUPPORTED and never calls POST /topups/validate-id', async () => {
      // Live list contains only an unrelated category.
      stubCatalog([{ category_id: 'pubg_mobile_auto', name: 'PUBG Mobile (Auto)', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow()); // free_fire_sg

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '555' });

      expect(result.valid).toBeUndefined();
      expect(result.verified ?? false).toBe(false);
      expect(result.reason).toBe('VALIDATION_NOT_SUPPORTED');
      expect(result.verificationAvailable).toBe(false);
      expect(result.allowUnverifiedPurchase).toBe(false);
      // No POST was attempted with a guessed category id.
      expect(fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === 'POST')).toHaveLength(0);
    });
  });

  describe('provider answers (TEST F/G)', () => {
    beforeEach(() => {
      stubCatalog([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());
    });

    it('TEST F: surfaces the real player_name from the provider', async () => {
      fetchMock.mockImplementation(async (_url: string | URL, init?: { method?: string }) =>
        init?.method === 'POST'
          ? jsonResponse({ ok: true, valid: true, player_name: 'RealNick99' })
          : supportResponse([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }])
      );
      mockPrisma.topUpVerification.create.mockResolvedValue({ id: 'tok-2' });

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '111222333' });
      expect(result.playerName).toBe('RealNick99');
    });

    it('TEST G: invalid account returns PLAYER_NOT_FOUND without storing anything', async () => {
      fetchMock.mockImplementation(async (_url: string | URL, init?: { method?: string }) =>
        init?.method === 'POST'
          ? jsonResponse({ ok: true, valid: false })
          : supportResponse([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }])
      );

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '000000000' });

      expect(result.valid).toBeUndefined();
      expect(result.reason).toBe('PLAYER_NOT_FOUND');
      expect(mockPrisma.topUpVerification.create).not.toHaveBeenCalled();
    });
  });

  describe('order-time enforcement (TEST H/I/J + bypass attempts)', () => {
    const ORDER_INPUTS = { target: '123456789', serverId: '1234' };
    const REQUIRED_FIELDS = [
      { key: 'player_id', label: 'Player ID' },
      { key: 'server_id', label: 'Server ID' }
    ];

    function stubInfoAndRow(row: Record<string, unknown> | null) {
      stubCatalog([{ category_id: 'mobile_legends_singapore', name: 'MLBB SG', fields: REQUIRED_FIELDS }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow({
        providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'mobile_legends_singapore' }
      }));
      mockPrisma.topUpVerification.findFirst.mockResolvedValue(row);
    }

    it('allows the order when a matching unexpired VALID verification exists', async () => {
      stubInfoAndRow({ id: 'ver-match', status: 'VALID' });
      mockPrisma.topUpVerification.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.assertVerifiedForOrder({ userId: 'user-1', packageId: 'pkg-1', ...ORDER_INPUTS })).resolves.toBeUndefined();
      expect(mockPrisma.topUpVerification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'ver-match',
            userId: 'user-1',
            packageId: 'pkg-1',
            status: 'VALID'
          }),
          data: { status: 'CONSUMED', orderId: null }
        })
      );
    });

    it('rejects the order when a concurrent request consumed the verification first (race safety)', async () => {
      stubInfoAndRow({ id: 'ver-match', status: 'VALID' });
      // The conditional consume matched 0 rows: another request already set
      // CONSUMED between findFirst and updateMany.
      mockPrisma.topUpVerification.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.assertVerifiedForOrder({ userId: 'user-1', packageId: 'pkg-1', ...ORDER_INPUTS })
      ).rejects.toThrow(/verification required/i);
    });

    it('TEST H: rejects when the customer changed one field after verifying', async () => {
      stubInfoAndRow(null); // hash of changed values matches nothing
      await expect(
        service.assertVerifiedForOrder({ userId: 'user-1', packageId: 'pkg-1', ...ORDER_INPUTS, target: '999999999' })
      ).rejects.toThrow(/verification required/i);
    });

    it('TEST I: rejects when the customer changed the package after verifying', async () => {
      stubInfoAndRow(null);
      await expect(
        service.assertVerifiedForOrder({ userId: 'user-1', packageId: 'OTHER-package', ...ORDER_INPUTS })
      ).rejects.toThrow(/verification required/i);
    });

    it('TEST J: rejects an expired verification', async () => {
      stubInfoAndRow(null); // expiresAt filter (gt: now) excludes the expired row
      await expect(
        service.assertVerifiedForOrder({ userId: 'user-1', packageId: 'pkg-1', ...ORDER_INPUTS })
      ).rejects.toThrow(/verification required/i);
    });

    it('rejects another customerÃ¢â‚¬â„¢s verification (userId bound)', async () => {
      stubInfoAndRow(null);
      await expect(
        service.assertVerifiedForOrder({ userId: 'someone-else', packageId: 'pkg-1', ...ORDER_INPUTS })
      ).rejects.toThrow(/verification required/i);
    });

    it('blocks direct order attempts that skip verification entirely', async () => {
      stubInfoAndRow(null);
      await expect(
        service.assertVerifiedForOrder({ userId: 'user-1', packageId: 'pkg-1', ...ORDER_INPUTS })
      ).rejects.toThrow(/verification required/i);
    });

    it('unsupported category: allows only when allowUnverifiedPurchase is explicitly configured', async () => {
      // Not in the live support list; config allows unverified purchase.
      stubCatalog([{ category_id: 'unrelated_game', name: 'Other Game', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRow({ game: { id: 'game-1', gameConfig: { allowUnverifiedPurchase: true } } })
      );
      await expect(
        service.assertVerifiedForOrder({ userId: 'user-1', packageId: 'pkg-1', target: '42' })
      ).resolves.toBeUndefined();
    });

    it('unsupported category: blocks when allowUnverifiedPurchase is not enabled (no silent bypass)', async () => {
      stubCatalog([{ category_id: 'unrelated_game', name: 'Other Game', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());
      await expect(
        service.assertVerifiedForOrder({ userId: 'user-1', packageId: 'pkg-1', target: '42' })
      ).rejects.toThrow(/not available for this game/);
    });
  });

  describe('availability handling', () => {
    it('maps timeout/5xx to VERIFICATION_UNAVAILABLE with a retry hint, never a fake result', async () => {
      stubCatalog([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());
      fetchMock.mockImplementation(async (_url: string | URL, init?: { method?: string }) => {
        if (init?.method === 'POST') {
          return jsonResponse({ ok: false, error: 'upstream exploded' }, 500);
        }
        return supportResponse([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      });

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '1' });

      expect(result.reason).toBe('VERIFICATION_UNAVAILABLE');
      expect(result.error).toMatch(/temporarily unavailable/i);
      expect(mockPrisma.topUpVerification.create).not.toHaveBeenCalled();
    });

    it('treats HTTP 429 from the provider as temporary', async () => {
      stubCatalog([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());
      fetchMock.mockImplementation(async (_url: string | URL, init?: { method?: string }) => {
        if (init?.method === 'POST') return jsonResponse({ ok: false, error: 'rate limited' }, 429);
        return supportResponse([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      });

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '1' });
      expect(result.reason).toBe('VERIFICATION_UNAVAILABLE');
    });

    it('maps the live HTTP 422 answer to PLAYER_NOT_FOUND (CASE 2)', async () => {
      stubCatalog([{ category_id: 'free_fire', name: 'Free Fire', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRow({ providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'free_fire_sg' } })
      );
      fetchMock.mockImplementation(async (_url: string | URL, init?: { method?: string }) => {
        if (init?.method === 'POST') {
          return jsonResponse({ ok: false, error: 'We could not validate this Player ID.' }, 422);
        }
        return supportResponse([{ category_id: 'free_fire', name: 'Free Fire', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      });

      const r422 = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '99999999999' });
      expect(r422.verified ?? false).toBe(false);
      expect(r422.reason).toBe('PLAYER_NOT_FOUND');
      expect(r422.error).toBe('Player ID not found.');
      expect(mockPrisma.topUpVerification.create).not.toHaveBeenCalled();
    });

    it('maps HTTP 400 field rejection to a check-inputs message without raw provider text', async () => {
      stubCatalog([{ category_id: 'mobile_legends', name: 'MLBB', fields: [{ key: 'player_id', label: 'Player ID' }, { key: 'zone_id', label: 'Zone ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(
        packageRow({ providerService: { id: 'svc-internal', providerId: 'prov-1', providerServiceId: 'mobile_legends_singapore' } })
      );
      fetchMock.mockImplementation(async (_url: string | URL, init?: { method?: string }) => {
        if (init?.method === 'POST') {
          return jsonResponse({ ok: false, error: 'Missing or invalid fields for this category' }, 400);
        }
        return supportResponse([{ category_id: 'mobile_legends', name: 'MLBB', fields: [{ key: 'player_id', label: 'Player ID' }, { key: 'zone_id', label: 'Zone ID' }] }]);
      });

      const r400 = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '123', zone_id: '99999' });
      expect(r400.reason).toBe('MISSING_FIELDS');
      expect(r400.error).toMatch(/check your account details/i);
    });
  });

  describe('supplier-error sanitization (customer responses NEVER leak supplier details)', () => {
    /** Every string that must NEVER appear in any customer-facing response. */
    const FORBIDDEN = [
      /fazercards/i,
      /fzr\.cards/i,
      /subscription/i,
      /renew/i,
      /x-api-key/i,
      /api[- ]?key/i,
      /https?:\/\//i,
      /\(40\d\)/,
      /\(42\d\)/,
      /\(5\d\d\)/
    ];

    function expectNoSupplierLeak(result: Record<string, unknown>): void {
      const serialized = JSON.stringify(result).toLowerCase();
      for (const pattern of FORBIDDEN) {
        expect(serialized).not.toMatch(pattern);
      }
    }

    function stubPostFailure(status: number, body: unknown) {
      stubCatalog([{ category_id: 'free_fire_sg', name: 'Free Fire (SG)', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());
      fetchMock.mockImplementation(async (_url: string | URL, init?: { method?: string }) => {
        if (init?.method === 'POST') return jsonResponse(body, status);
        return supportResponse([{ category_id: 'free_fire_sg', name: 'Free Fire (SG)', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      });
    }

    it('THE SCREENSHOT BUG: provider 403/subscription-inactive becomes generic VERIFICATION_UNAVAILABLE with zero leakage', async () => {
      stubPostFailure(403, { ok: false, error: 'Subscription is not active. Renew it to use this feature.' });

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '123456789' });

      expect(result.valid).toBeUndefined();
      expect(result.verified ?? false).toBe(false);
      expect(result.reason).toBe('VERIFICATION_UNAVAILABLE');
      expect(result.error).toBe('Account verification is temporarily unavailable. Please try again later.');
      expectNoSupplierLeak(result as unknown as Record<string, unknown>);
      expect(mockPrisma.topUpVerification.create).not.toHaveBeenCalled(); // never pretend success
    });

    it('provider 401 (auth failure) is sanitized identically — supplier-blind by construction', async () => {
      stubPostFailure(401, { ok: false, error: 'Invalid API credentials for X-API-Key principal' });

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '123456789' });

      expect(result.reason).toBe('VERIFICATION_UNAVAILABLE');
      expect(result.error).toBe('Account verification is temporarily unavailable. Please try again later.');
      expectNoSupplierLeak(result as unknown as Record<string, unknown>);
    });

    it('network timeout during validation is sanitized (no retry storms, no details)', async () => {
      stubCatalog([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());
      fetchMock.mockImplementation(async (_url: string | URL, init?: { method?: string }) => {
        if (init?.method === 'POST') throw new Error('This operation was aborted');
        return supportResponse([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      });

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '123456789' });

      expect(result.reason).toBe('VERIFICATION_UNAVAILABLE');
      expectNoSupplierLeak(result as unknown as Record<string, unknown>);
    });

    it('support-catalog outage reports VERIFICATION_UNAVAILABLE — NOT "not available for this game"', async () => {
      // Catalog GET fails entirely; nothing is known about support.
      fetchMock.mockImplementation(async () => {
        throw new Error('getaddrinfo ENOTFOUND api.fzr.cards');
      });
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());

      const info = await service.getVerificationInfo('pkg-1');
      expect(info.applicable).toBe(true);
      expect(info.verificationAvailable).toBe(false);
      expect(info.availabilityKnown).toBe(false);

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '123456789' });
      expect(result.reason).toBe('VERIFICATION_UNAVAILABLE');
      expect(result.error).toMatch(/temporarily unavailable/i);
      expectNoSupplierLeak(result as unknown as Record<string, unknown>);
      // No POST validation was attempted against an unchecked category.
      expect(fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === 'POST')).toHaveLength(0);
    });

    it('genuinely unsupported game still says VALIDATION_NOT_SUPPORTED (generic copy, no supplier info)', async () => {
      stubCatalog([{ category_id: 'some_other_game', name: 'Other Game', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '123456789' });

      expect(result.reason).toBe('VALIDATION_NOT_SUPPORTED');
      expect(result.error).toBe('Player ID verification is not available for this game.');
      expectNoSupplierLeak(result as unknown as Record<string, unknown>);
    });

    it('successful verification keeps returning the real player name and nothing sensitive', async () => {
      stubCatalog([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      mockPrisma.topUpPackage.findUnique.mockResolvedValue(packageRow());
      fetchMock.mockImplementation(async (_url: string | URL, init?: { method?: string }) => {
        if (init?.method === 'POST') {
          return jsonResponse({ ok: true, valid: true, player_name: 'ExampleName' });
        }
        return supportResponse([{ category_id: 'free_fire_sg', name: 'FF SG', fields: [{ key: 'player_id', label: 'Player ID' }] }]);
      });
      mockPrisma.topUpVerification.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.topUpVerification.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'tok-ok', ...data }));

      const result = await service.verifyPlayer('user-1', 'pkg-1', { player_id: '555000111' });

      expect(result.valid).toBe(true);
      expect(result.playerName).toBe('ExampleName');
      expectNoSupplierLeak(result as unknown as Record<string, unknown>);
    });

    it('logs the real supplier failure server-side without exposing it in the result', async () => {
      const warnSpy = vi.fn();
      const loggingService = new TopUpVerificationService(mockPrisma as unknown as PrismaClient, { warn: warnSpy });
      stubPostFailure(403, { ok: false, error: 'Subscription is not active. Renew it to use this feature.' });

      const result = await loggingService.verifyPlayer('user-1', 'pkg-1', { player_id: '1' });

      expect(result.reason).toBe('VERIFICATION_UNAVAILABLE');
      // Diagnostics ARE available server-side:
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warnSpy.mock.calls[0]);
      expect(logged).toMatch(/Subscription is not active/);
      expect(logged).toMatch(/403/);
    });
  });
});
