import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from './app.js';
import { hashAdminToken } from './middleware/admin-auth.js';

vi.mock('./infrastructure/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    admin: {
      findUnique: vi.fn()
    },
    banner: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    },
    $transaction: vi.fn().mockResolvedValue([]),
    telegramNotificationTarget: {
      findMany: vi.fn().mockResolvedValue([])
    },
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

const mockTelegramUser = {
  id: 123456789,
  first_name: 'John',
  last_name: 'Doe',
  username: 'johndoe',
  language_code: 'en',
  photo_url: 'https://example.com/photo.jpg'
};

const mockDbUser = {
  id: 'user-1',
  telegramId: BigInt(123456789),
  username: 'johndoe',
  firstName: 'John',
  lastName: 'Doe',
  photoUrl: 'https://example.com/photo.jpg',
  languageCode: 'en',
  status: 'ACTIVE'
};

function generateInitData(botToken: string, user: typeof mockTelegramUser): string {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(user));
  params.set('auth_date', authDate);
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const BANNER_MUTATIONS = ['create', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'] as const;

function expectNoBannerMutations(): void {
  for (const method of BANNER_MUTATIONS) {
    expect(prisma.banner[method]).not.toHaveBeenCalled();
  }
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
}

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
          { permission: { key: 'categories:delete' } }
        ]
      }
    }
  ]
};

const adminHeaders = { authorization: `Bearer ${hashAdminToken('admin-token-for-tests')}` };

const STORED_CLOUDINARY_URL =
  'https://res.cloudinary.com/dtz0urit6/image/upload/q_auto:best,f_jpg/cloudinary-tools-uploads/nzdfix8ycc0spfiowfoi';

function pastDate(msAgo: number): Date {
  return new Date(Date.now() - msAgo);
}

function futureDate(msAhead: number): Date {
  return new Date(Date.now() + msAhead);
}

const ACTIVE_WINDOW_BANNER = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'MLBB biner',
  subtitle: null,
  imageUrl: STORED_CLOUDINARY_URL,
  buttonText: null,
  buttonDestination: null,
  targetType: 'HOME',
  targetCategoryId: null,
  targetProductId: null,
  targetPage: null
};

describe('Banner persistence contract', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  describe('GET /api/banners is strictly read-only', () => {
    it('serves banners without creating, updating, deleting or rewriting any record (repeated polling included)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.banner.findMany.mockResolvedValue([ACTIVE_WINDOW_BANNER]);

      for (let poll = 0; poll < 3; poll += 1) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/banners?targetType=HOME',
          headers: { 'x-telegram-init-data': generateInitData(process.env.TELEGRAM_BOT_TOKEN!, mockTelegramUser) }
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().banners).toHaveLength(1);
        // The stored Cloudinary URL reaches the client byte-for-byte.
        expect(response.json().banners[0].imageUrl).toBe(STORED_CLOUDINARY_URL);
      }

      expect(prisma.banner.findMany).toHaveBeenCalledTimes(3);
      expectNoBannerMutations();
    });

    it('normalizes legacy Google Drive share URLs at serve-time only — the stored value is never written back', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.banner.findMany.mockResolvedValue([
        { ...ACTIVE_WINDOW_BANNER, imageUrl: 'https://drive.google.com/file/d/DRIVEID123/view?usp=sharing' }
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/banners',
        headers: { 'x-telegram-init-data': generateInitData(process.env.TELEGRAM_BOT_TOKEN!, mockTelegramUser) }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().banners[0].imageUrl).toBe('https://drive.google.com/thumbnail?id=DRIVEID123&sz=w1600');
      expectNoBannerMutations();
    });
  });

  describe('Scheduling controls visibility through the query only — never through data changes', () => {
    it('requires isActive=true and an active startsAt window', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.banner.findMany.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/api/banners',
        headers: { 'x-telegram-init-data': generateInitData(process.env.TELEGRAM_BOT_TOKEN!, mockTelegramUser) }
      });

      const where = prisma.banner.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(true);
      expect(where.OR).toEqual([{ startsAt: null }, { startsAt: { lte: expect.any(Date) } }]);
      // Contract: visible while now < endsAt (endsAt itself is excluded).
      expect(where.AND[0].OR).toEqual([{ endsAt: null }, { endsAt: { gt: expect.any(Date) } }]);
      expectNoBannerMutations();
    });

    it('a banner inside its window is served unchanged on every request until endsAt', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      prisma.banner.findMany.mockResolvedValue([ACTIVE_WINDOW_BANNER]);

      const first = await app.inject({
        method: 'GET',
        url: '/api/banners',
        headers: { 'x-telegram-init-data': generateInitData(process.env.TELEGRAM_BOT_TOKEN!, mockTelegramUser) }
      });
      const second = await app.inject({
        method: 'GET',
        url: '/api/banners',
        headers: { 'x-telegram-init-data': generateInitData(process.env.TELEGRAM_BOT_TOKEN!, mockTelegramUser) }
      });

      expect(first.json()).toEqual(second.json());
      expectNoBannerMutations();
    });

    it('after endAt the banner stops being served by the where clause alone — the row itself stays untouched', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);

      const waitingBanner = { ...ACTIVE_WINDOW_BANNER, id: 'banner-waiting', startsAt: futureDate(60_000), endsAt: futureDate(120_000) };
      const liveBanner = { ...ACTIVE_WINDOW_BANNER, id: 'banner-live', startsAt: pastDate(60_000), endsAt: futureDate(3_600_000) };
      const expiredBanner = { ...ACTIVE_WINDOW_BANNER, id: 'banner-expired', startsAt: pastDate(7_200_000), endsAt: pastDate(3_600_000) };

      // Evaluate rows against the exact visibility predicate the route sent,
      // so this test proves endAt governs SERVING only.
      prisma.banner.findMany.mockImplementation(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        if (!where || where.isActive !== true) return [];
        const lte = (where.OR as Array<{ startsAt: { lte: Date } }>)[1]?.startsAt.lte;
        const gt = ((where.AND as Array<{ OR: Array<{ endsAt: { gt: Date } }> }>)[0]).OR[1].endsAt.gt;
        return [waitingBanner, liveBanner, expiredBanner].filter((banner) => {
          const startOk = banner.startsAt === null || banner.startsAt.getTime() <= lte.getTime();
          // Contract: visible while endsAt > now (endsAt instant itself excluded).
          const endOk = banner.endsAt === null || banner.endsAt.getTime() > gt.getTime();
          return startOk && endOk;
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/banners',
        headers: { 'x-telegram-init-data': generateInitData(process.env.TELEGRAM_BOT_TOKEN!, mockTelegramUser) }
      });

      expect(response.statusCode).toBe(200);
      const servedIds = response.json().banners.map((b: { id: string }) => b.id);
      expect(servedIds).toEqual(['banner-live']);
      expectNoBannerMutations();
    });
  });

  describe('Admin banner management is the only mutation path', () => {
    it('admin list and detail endpoints are read-only and do NOT filter by schedule or isActive', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN_ROW);
      prisma.banner.findMany.mockResolvedValue([
        { ...ACTIVE_WINDOW_BANNER, isActive: false, endsAt: new Date(Date.now() - 86_400_000).toISOString() }
      ]);
      prisma.banner.count.mockResolvedValue(1);
      prisma.banner.findUnique.mockResolvedValue({ ...ACTIVE_WINDOW_BANNER, isActive: false });

      const list = await app.inject({ method: 'GET', url: '/api/admin/banners', headers: adminHeaders });
      expect(list.statusCode).toBe(200);
      // Expired/disabled banners remain manageable: no implicit visibility filter.
      expect(list.json().banners).toHaveLength(1);

      const detail = await app.inject({ method: 'GET', url: '/api/admin/banners/banner-1', headers: adminHeaders });
      expect(detail.statusCode).toBe(200);

      expect(prisma.banner.findUnique).toHaveBeenCalled();
      expectNoBannerMutations();
    });

    it('editing only the title leaves imageUrl, isActive and schedule untouched', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN_ROW);
      prisma.banner.findUnique.mockResolvedValue(ACTIVE_WINDOW_BANNER);
      prisma.banner.update.mockResolvedValue({ ...ACTIVE_WINDOW_BANNER, title: 'New title' });
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/banners/11111111-1111-4111-8111-111111111111',
        headers: adminHeaders,
        payload: { title: 'New title' }
      });

      expect(response.statusCode).toBe(200);
      expect(prisma.banner.update).toHaveBeenCalledTimes(1);
      const call = prisma.banner.update.mock.calls[0][0];
      expect(call.data).toEqual({ title: 'New title' });
      expect(Object.keys(call.data)).not.toContain('imageUrl');
      expect(Object.keys(call.data)).not.toContain('isActive');
      expect(Object.keys(call.data)).not.toContain('startsAt');
      expect(Object.keys(call.data)).not.toContain('endsAt');
      // Exactly one audit entry records the manual action.
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('Disable (deactivate) is a manual action that sets isActive=false and audits it', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN_ROW);
      prisma.banner.update.mockResolvedValue({ ...ACTIVE_WINDOW_BANNER, isActive: false });
      prisma.auditLog.create.mockResolvedValue({ id: 'log-2' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/banners/11111111-1111-4111-8111-111111111111/deactivate',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(prisma.banner.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'BANNER_DEACTIVATED' }) })
      );
    });

    it('Enable (activate) is a manual action that sets isActive=true and audits it', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN_ROW);
      prisma.banner.update.mockResolvedValue({ ...ACTIVE_WINDOW_BANNER, isActive: true });
      prisma.auditLog.create.mockResolvedValue({ id: 'log-3' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/banners/11111111-1111-4111-8111-111111111111/activate',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(prisma.banner.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: true } })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'BANNER_ACTIVATED' }) })
      );
    });

    it('Delete is a manual action that removes exactly one banner row and audits it', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN_ROW);
      prisma.banner.findUnique.mockResolvedValue(ACTIVE_WINDOW_BANNER);
      prisma.banner.delete.mockResolvedValue(ACTIVE_WINDOW_BANNER);
      prisma.auditLog.create.mockResolvedValue({ id: 'log-4' });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/banners/11111111-1111-4111-8111-111111111111',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(prisma.banner.delete).toHaveBeenCalledWith({ where: { id: '11111111-1111-4111-8111-111111111111' } });
      expect(prisma.banner.delete).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'BANNER_DELETED' }) })
      );
    });

    it('reordering mutates sortOrder only — never imageUrl, isActive or schedules', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN_ROW);
      prisma.banner.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({ id: 'log-5' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/banners/reorder',
        headers: adminHeaders,
        payload: [
          { id: 'banner-a', sortOrder: 2 },
          { id: 'banner-b', sortOrder: 5 }
        ]
      });

      expect(response.statusCode).toBe(200);
      expect(prisma.banner.update).toHaveBeenCalledTimes(2);
      expect(prisma.banner.update.mock.calls[0][0].data).toEqual({ sortOrder: 2 });
      expect(prisma.banner.update.mock.calls[1][0].data).toEqual({ sortOrder: 5 });
    });
  });

  describe('Image host failures never mutate banner data', () => {
    it('the customer endpoint keeps returning the stored URL even when the asset 404s upstream', async () => {
      prisma.user.findUnique.mockResolvedValue(mockDbUser);
      // The stored URL currently returns HTTP 404 at the image host. The API
      // layer must neither notice nor care: it serves the stored value.
      prisma.banner.findMany.mockResolvedValue([ACTIVE_WINDOW_BANNER]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/banners',
        headers: { 'x-telegram-init-data': generateInitData(process.env.TELEGRAM_BOT_TOKEN!, mockTelegramUser) }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().banners[0]).toMatchObject({
        id: ACTIVE_WINDOW_BANNER.id,
        imageUrl: STORED_CLOUDINARY_URL,
        title: ACTIVE_WINDOW_BANNER.title
      });
      expectNoBannerMutations();
    });
  });
});
