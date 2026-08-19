import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  wallet: {
    upsert: vi.fn()
  },
  walletTransaction: {
    findMany: vi.fn()
  },
  orderItem: {
    findMany: vi.fn()
  },
  order: {
    count: vi.fn()
  }
}));

vi.mock('./infrastructure/prisma.js', () => ({ prisma: mockPrisma }));

import { buildApp } from './app.js';

const BOT_TOKEN = 'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface TelegramUserPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

function generateInitData(user: TelegramUserPayload): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user)
  });
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'internal-jim',
    telegramId: BigInt(111111111),
    username: 'jimrotha',
    firstName: 'Jim',
    lastName: 'Rotha',
    photoUrl: 'https://example.com/jim.jpg',
    languageCode: 'en',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  };
}

describe('customer account identity endpoint', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.NODE_ENV = 'test';
    vi.clearAllMocks();
    mockPrisma.wallet.upsert.mockResolvedValue({
      id: 'wallet-jim',
      balance: { toString: () => '7.50' },
      currency: 'USD'
    });
    mockPrisma.walletTransaction.findMany.mockResolvedValue([]);
    mockPrisma.orderItem.findMany.mockResolvedValue([]);
    mockPrisma.order.count.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('binds a first Telegram opening to the created database user', async () => {
    const createdUser = makeUser({ lastSeenAt: new Date('2026-08-18T00:00:00Z') });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue(createdUser);

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: {
        'x-telegram-init-data': generateInitData({
          id: 111111111,
          first_name: 'Jim',
          last_name: 'Rotha',
          username: 'jimrotha',
          photo_url: 'https://example.com/jim.jpg'
        })
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: {
        id: 'internal-jim',
        telegramId: '111111111',
        firstName: 'Jim',
        lastName: 'Rotha',
        username: 'jimrotha',
        photoUrl: 'https://example.com/jim.jpg',
        accountStatus: 'NEW'
      }
    });
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ telegramId: BigInt(111111111), lastSeenAt: expect.any(Date) })
    });

    await app.close();
  });

  it('returns EXISTING and the refreshed Telegram profile for an existing database user', async () => {
    const storedUser = makeUser({ firstName: 'Old', lastName: null, username: 'old_name' });
    const refreshedUser = makeUser({
      firstName: 'Rayut',
      lastName: 'User',
      username: 'rayut',
      photoUrl: 'https://example.com/rayut.jpg'
    });
    mockPrisma.user.findUnique.mockResolvedValue(storedUser);
    mockPrisma.user.update.mockResolvedValue(refreshedUser);

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: {
        'x-telegram-init-data': generateInitData({
          id: 111111111,
          first_name: 'Rayut',
          last_name: 'User',
          username: 'rayut',
          photo_url: 'https://example.com/rayut.jpg'
        })
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: {
        firstName: 'Rayut',
        lastName: 'User',
        username: 'rayut',
        photoUrl: 'https://example.com/rayut.jpg',
        accountStatus: 'EXISTING'
      }
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'internal-jim' } })
    );

    await app.close();
  });
});
