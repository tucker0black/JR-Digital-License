import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { SecurityService } from './security.service.js';

function makeMockPrisma() {
  const prisma = {
    securityEvent: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      findMany: vi.fn().mockResolvedValue([])
    }
  };
  return prisma as unknown as PrismaClient & {
    securityEvent: {
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
}

describe('SecurityService', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: SecurityService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new SecurityService(prisma);
  });

  it('records a security event with the server-provided IP', async () => {
    const result = await service.record({
      eventType: 'AUTH_INVALID_INIT_DATA',
      ip: '203.0.113.7',
      userId: 'user-1',
      metadata: { detail: 'bad hash' }
    });

    expect(result).toEqual({ id: 'event-1', escalated: false });
    expect(prisma.securityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'AUTH_INVALID_INIT_DATA',
        severity: 'WARNING',
        ipAddress: '203.0.113.7',
        userId: 'user-1',
        metadata: expect.objectContaining({ detail: 'bad hash', occurrence: 1 })
      })
    });
  });

  it('escalates repeated identical events from the same IP to CRITICAL', async () => {
    prisma.securityEvent.count.mockResolvedValue(4);

    const result = await service.record({
      eventType: 'PAYMENT_REPLAY',
      ip: '203.0.113.9'
    });

    expect(result.escalated).toBe(true);
    expect(prisma.securityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'PAYMENT_REPLAY',
        severity: 'CRITICAL',
        metadata: expect.objectContaining({ occurrence: 5 })
      })
    });
  });

  it('keeps the explicit severity when there is no repeated pattern', async () => {
    await service.record({
      eventType: 'UNAUTHORIZED_ORDER_ACCESS',
      severity: 'INFO',
      ip: '203.0.113.10'
    });

    expect(prisma.securityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: 'INFO' })
    });
  });

  it('searches events by IP address', async () => {
    await service.getEvents({ search: '203.0.113' });

    expect(prisma.securityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ ipAddress: { contains: '203.0.113', mode: 'insensitive' } }, expect.anything()]
        })
      })
    );
  });

  it('searches events by numeric Telegram ID', async () => {
    await service.getEvents({ search: '123456789' });

    expect(prisma.securityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [expect.anything(), { user: { telegramId: { equals: BigInt(123456789) } } }]
        })
      })
    );
  });

  it('does not match non-numeric searches against telegramId', async () => {
    await service.getEvents({ search: 'whatever' });

    expect(prisma.securityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [expect.anything(), { user: { telegramId: { equals: -1n } } }]
        })
      })
    );
  });
});