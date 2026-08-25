import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { hashAdminToken } from './middleware/admin-auth.js';

vi.mock('./infrastructure/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    admin: { findUnique: vi.fn() },
    banner: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn()
    },
    topUpGame: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn()
    },
    topUpProvider: { findUnique: vi.fn() },
    category: { count: vi.fn().mockResolvedValue(0) },
    product: { count: vi.fn().mockResolvedValue(0) },
    topUpPackage: { count: vi.fn().mockResolvedValue(0) },
    mediaAsset: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      delete: vi.fn()
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
    telegramNotificationTarget: { findMany: vi.fn().mockResolvedValue([]) },
    securityEvent: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'security-event-1' })
    }
  }
}));

const { prisma } = await import('./infrastructure/prisma.js');

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
});

const adminHeaders = { authorization: `Bearer ${hashAdminToken('admin-token-for-tests')}` };

const ADMIN_ROW = {
  id: 'admin-1',
  telegramId: BigInt(1),
  username: 'admin',
  firstName: 'Admin',
  lastName: null,
  status: 'ACTIVE',
  roles: [
    {
      role: {
        key: 'SUPER_ADMIN',
        permissions: [
          { permission: { key: 'categories:read' } },
          { permission: { key: 'categories:create' } },
          { permission: { key: 'categories:update' } },
          { permission: { key: 'categories:delete' } },
          { permission: { key: 'wallet:read' } },
          { permission: { key: 'wallet:manage' } }
        ]
      }
    }
  ]
};

/** Minimal valid PNG (1×1 transparent pixel). */
function pngBase64(): string {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
}

let storageDir: string;

describe('Owned media pipeline + image persistence contract', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-media-test-'));
    process.env.MEDIA_STORAGE_DIR = storageDir;
    vi.clearAllMocks();
    // clearAllMocks wipes the module-level default resolved values above; restore them.
    prisma.banner.findMany.mockResolvedValue([]);
    prisma.banner.count.mockResolvedValue(0);
    prisma.topUpGame.count.mockResolvedValue(0);
    prisma.category.count.mockResolvedValue(0);
    prisma.product.count.mockResolvedValue(0);
    prisma.topUpPackage.count.mockResolvedValue(0);
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    prisma.mediaAsset.count.mockResolvedValue(0);
    prisma.$transaction.mockResolvedValue([]);
    prisma.telegramNotificationTarget.findMany.mockResolvedValue([]);
    prisma.securityEvent.count.mockResolvedValue(0);
    prisma.securityEvent.create.mockResolvedValue({ id: 'security-event-1' });
    prisma.admin.findUnique.mockResolvedValue(ADMIN_ROW);
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
    delete process.env.MEDIA_STORAGE_DIR;
  });

  describe('upload → permanent asset → serve', () => {
    it('stores an upload permanently and serves the exact bytes with immutable caching', async () => {
      prisma.mediaAsset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'asset-1',
        createdAt: new Date(),
        ...data
      }));

      const upload = await app.inject({
        method: 'POST',
        url: '/api/admin/media',
        headers: adminHeaders,
        payload: { dataBase64: pngBase64().toString('base64') }
      });
      expect(upload.statusCode).toBe(201);
      const asset = upload.json().asset;
      expect(asset.url).toMatch(/^\/api\/media\/[0-9a-f-]{36}\.png$/);
      expect(asset.mimeType).toBe('image/png');
      // The file really exists on disk.
      await expect(fsp.readFile(path.join(storageDir, asset.filename))).resolves.toEqual(pngBase64());

      // Registry lookup mirrors what was persisted.
      prisma.mediaAsset.findUnique.mockResolvedValue({
        id: asset.id,
        filename: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        createdByAdminId: null,
        createdAt: new Date()
      });

      const served = await app.inject({ method: 'GET', url: asset.url });
      expect(served.statusCode).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['cache-control']).toContain('immutable');
      expect(served.rawPayload).toEqual(pngBase64());

      // Serving is strictly read-only.
      expect(prisma.mediaAsset.create).toHaveBeenCalledTimes(1);
      expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
    });

    it('rejects payloads that are not images (magic-byte sniffing)', async () => {
      const upload = await app.inject({
        method: 'POST',
        url: '/api/admin/media',
        headers: adminHeaders,
        payload: { dataBase64: Buffer.from('<html>not an image</html>').toString('base64') }
      });
      expect(upload.statusCode).toBe(400);
      expect(upload.json().error).toMatch(/unsupported image/i);
    });

    it('404s unknown or hostile filenames without touching the filesystem outside storage', async () => {
      for (const filename of ['nope.png', '../../.env', '%2e%2e%2f%2e%2e%2f.env', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png']) {
        const res = await app.inject({ method: 'GET', url: `/api/media/${encodeURIComponent(filename)}` });
        expect(res.statusCode).toBe(404);
      }
    });
  });

  describe('GAME image persistence (nothing clears imageUrl — ever)', () => {
    const GAME_ROW = {
      id: 'game-1',
      name: 'Free Fire',
      // Simulates an externally-hosted asset whose host returns HTTP 404:
      // the DB row must not care and must not change.
      imageUrl: 'https://res.cloudinary.com/dtz0urit6/image/upload/q_auto:best,f_jpg/cloudinary-tools-uploads/deadbeef',
      providerId: null,
      providerServiceId: null,
      isActive: true,
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      provider: null,
      _count: { packages: 3 }
    };

    it('repeated GETs return the identical imageUrl with zero writes, even while the host 404s', async () => {
      prisma.topUpGame.findMany.mockResolvedValue([GAME_ROW]);

      for (let poll = 0; poll < 3; poll += 1) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/admin/topup/games',
          headers: adminHeaders
        });
        expect(res.statusCode).toBe(200);
        const game = res.json().games[0];
        expect(game.imageUrl).toBe(GAME_ROW.imageUrl); // byte-for-byte
        expect(game.isActive).toBe(true); // availability never affects status
      }

      expect(prisma.topUpGame.findMany).toHaveBeenCalledTimes(3);
      // No mutation of any kind happened because an image failed to load.
      expect(prisma.topUpGame.create).not.toHaveBeenCalled();
      expect(prisma.topUpGame.update).not.toHaveBeenCalled();
      expect(prisma.topUpGame.updateMany).not.toHaveBeenCalled();
      expect(prisma.topUpGame.delete).not.toHaveBeenCalled();
    });

    it('manual replace stores the new URL and only the new URL', async () => {
      prisma.topUpGame.findUnique.mockResolvedValue(GAME_ROW);
      prisma.topUpProvider.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          topUpGame: {
            update: vi.fn().mockResolvedValue({ ...GAME_ROW, imageUrl: '/api/media/replaced.png' })
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) }
        })
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/topup/games/game-1',
        headers: adminHeaders,
        payload: { name: GAME_ROW.name, imageUrl: '/api/media/replaced.png' }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().game.imageUrl).toBe('/api/media/replaced.png');
    });
  });

  describe('explicit media deletion is the ONLY deletion path', () => {
    it('refuses while a record still references the file (409) and keeps everything intact', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue({
        id: 'asset-1',
        filename: '11111111-1111-4111-8111-111111111111.png',
        mimeType: 'image/png',
        sizeBytes: pngBase64().length,
        sha256: 'x',
        createdByAdminId: null,
        createdAt: new Date()
      });
      fs.writeFileSync(path.join(storageDir, '11111111-1111-4111-8111-111111111111.png'), pngBase64());
      // A game still uses this image:
      prisma.topUpGame.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/media/asset-1',
        headers: adminHeaders
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/still in use/i);
      // File AND registry row remain untouched.
      expect(fs.existsSync(path.join(storageDir, '11111111-1111-4111-8111-111111111111.png'))).toBe(true);
      expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('deletes only on an explicit unreferenced delete (file removed, audited)', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue({
        id: 'asset-2',
        filename: '22222222-2222-4222-8222-222222222222.png',
        mimeType: 'image/png',
        sizeBytes: pngBase64().length,
        sha256: 'y',
        createdByAdminId: null,
        createdAt: new Date()
      });
      fs.writeFileSync(path.join(storageDir, '22222222-2222-4222-8222-222222222222.png'), pngBase64());
      // All referencing tables report zero usage.
      prisma.auditLog.create.mockResolvedValue({});

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/media/asset-2',
        headers: adminHeaders
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(fs.existsSync(path.join(storageDir, '22222222-2222-4222-8222-222222222222.png'))).toBe(false);
      expect(prisma.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: 'asset-2' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'MEDIA_ASSET_DELETED' }) })
      );
    });
  });

  describe('restart resilience', () => {
    it('serves assets from disk through a brand-new app instance (simulated restart)', async () => {
      prisma.mediaAsset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'asset-r',
        createdAt: new Date(),
        ...data
      }));

      const first = buildApp();
      const upload = await first.inject({
        method: 'POST',
        url: '/api/admin/media',
        headers: adminHeaders,
        payload: { dataBase64: pngBase64().toString('base64') }
      });
      expect(upload.statusCode).toBe(201);
      const asset = upload.json().asset;
      await first.close();

      // "Restart": fresh instance, same storage dir, registry still resolves
      // the SAME server-generated filename.
      prisma.mediaAsset.findUnique.mockResolvedValue({
        id: 'asset-r',
        filename: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        createdByAdminId: null,
        createdAt: new Date()
      });
      const second = buildApp();
      const served = await second.inject({ method: 'GET', url: asset.url });
      expect(served.statusCode).toBe(200);
      expect(served.rawPayload).toEqual(pngBase64());
      await second.close();
    });
  });
});
