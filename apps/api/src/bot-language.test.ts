import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('./infrastructure/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    },
    securityEvent: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'security-event-1' })
    }
  }
}));

const { prisma } = await import('./infrastructure/prisma.js');
const { buildApp } = await import('./app.js');

const BOT_SECRET = 'test-bot-secret';
const SECRET_HEADER = { 'x-bot-secret': BOT_SECRET };

const existingUser = { id: 'user-1', telegramId: BigInt(777000111), language: null };

function upsertEcho(args: {
  where: { telegramId: bigint };
  update: { language?: string };
  create: { telegramId: bigint; language?: string };
}) {
  const language = args.update?.language ?? args.create?.language ?? null;
  return Promise.resolve({ id: 'user-x', telegramId: args.where.telegramId, language });
}

let app: FastifyInstance;

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  process.env.SUPPORT_OPEN_TIME = '00:00';
  process.env.SUPPORT_CLOSE_TIME = '23:59';
  process.env.SUPPORT_TIMEZONE_OFFSET_MINUTES = '0';
  process.env.BOT_SECRET = BOT_SECRET;
});

beforeEach(async () => {
  vi.clearAllMocks();
  app = buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/internal/bot/:telegramId/language', () => {
  it('rejects requests without the bot secret', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/internal/bot/123/language' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an invalid telegram id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/internal/bot/not-a-number/language',
      headers: SECRET_HEADER
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when the customer has no account yet', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const response = await app.inject({
      method: 'GET',
      url: '/api/internal/bot/123456/language',
      headers: SECRET_HEADER
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns null while no language has been chosen yet', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser as never);
    const response = await app.inject({
      method: 'GET',
      url: '/api/internal/bot/777000111/language',
      headers: SECRET_HEADER
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ language: null });
  });

  it('returns the saved Khmer preference (persists across bot restarts)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...existingUser,
      language: 'km'
    } as never);
    const response = await app.inject({
      method: 'GET',
      url: '/api/internal/bot/777000111/language',
      headers: SECRET_HEADER
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ language: 'km' });
  });

  it('returns the saved English preference', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...existingUser,
      language: 'en'
    } as never);
    const response = await app.inject({
      method: 'GET',
      url: '/api/internal/bot/777000111/language',
      headers: SECRET_HEADER
    });
    expect(response.json()).toEqual({ language: 'en' });
  });
});

describe('POST /api/internal/bot/:telegramId/language', () => {
  it('rejects requests without the bot secret', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/bot/123/language',
      payload: { language: 'km' }
    });
    expect(response.statusCode).toBe(401);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('rejects unsupported languages without touching the database', async () => {
    for (const language of ['fr', '', 'KHM', 'khm', 42, undefined]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/bot/123/language',
        headers: SECRET_HEADER,
        payload: { language }
      });
      expect(response.statusCode).toBe(400);
    }
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('saves Khmer on the existing account row (no duplicate accounts)', async () => {
    vi.mocked(prisma.user.upsert).mockImplementation(upsertEcho as never);
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/bot/777000111/language',
      headers: SECRET_HEADER,
      payload: { language: 'km', firstName: 'Jim', username: 'jimrotha' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ language: 'km' });
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { telegramId: BigInt(777000111) },
        update: { language: 'km' }
      })
    );
  });

  it('saves English and normalizes Telegram-style codes', async () => {
    vi.mocked(prisma.user.upsert).mockImplementation(upsertEcho as never);
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/bot/777000111/language',
      headers: SECRET_HEADER,
      payload: { language: 'en-US' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ language: 'en' });
  });

  it('creates the single customer account for a bot-only customer', async () => {
    vi.mocked(prisma.user.upsert).mockImplementation(upsertEcho as never);
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/bot/555000999/language',
      headers: SECRET_HEADER,
      payload: {
        language: 'en',
        firstName: 'New',
        lastName: 'Customer',
        username: 'new_customer',
        languageCode: 'en'
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ language: 'en' });
    const call = vi.mocked(prisma.user.upsert).mock.calls[0][0];
    expect(call.create).toMatchObject({
      telegramId: BigInt(555000999),
      firstName: 'New',
      lastName: 'Customer',
      username: 'new_customer',
      languageCode: 'en',
      language: 'en',
      status: 'ACTIVE'
    });
  });

  it('keeps the saved value readable afterwards (restart persistence)', async () => {
    vi.mocked(prisma.user.upsert).mockImplementation(upsertEcho as never);
    await app.inject({
      method: 'POST',
      url: '/api/internal/bot/777000111/language',
      headers: SECRET_HEADER,
      payload: { language: 'km' }
    });

    // Simulate the state after a full bot/API restart.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...existingUser,
      language: 'km'
    } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/api/internal/bot/777000111/language',
      headers: SECRET_HEADER
    });
    expect(response.json()).toEqual({ language: 'km' });
  });
});
