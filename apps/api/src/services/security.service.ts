import type { PrismaClient } from '@prisma/client';
import { SecurityEventSeverity } from '@prisma/client';

export type SecurityEventType =
  | 'AUTH_INVALID_INIT_DATA'
  | 'AUTH_SUSPENDED_ACCOUNT'
  | 'UNAUTHORIZED_ORDER_ACCESS'
  | 'UNAUTHORIZED_PAYMENT_ACCESS'
  | 'PAYMENT_REPLAY';

export interface RecordSecurityEventInput {
  eventType: SecurityEventType;
  severity?: SecurityEventSeverity;
  ip?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
}

const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_THRESHOLD = 4;

export class SecurityService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Records a security event server-side. Repeated identical events from the
   * same IP within a short window are escalated to HIGH severity so admins can
   * spot automated abuse. Only the server-provided request IP is used.
   */
  async record(input: RecordSecurityEventInput): Promise<{ id: string; escalated: boolean }> {
    const ip = input.ip ?? null;

    const recentCount = ip
      ? await this.prisma.securityEvent.count({
          where: {
            eventType: input.eventType,
            ipAddress: ip,
            ...(input.userId ? { userId: input.userId } : {}),
            createdAt: { gte: new Date(Date.now() - BURST_WINDOW_MS) }
          }
        })
      : 0;

    const escalated = recentCount + 1 >= BURST_THRESHOLD;
    const severity: SecurityEventSeverity = escalated
      ? SecurityEventSeverity.CRITICAL
      : (input.severity ?? SecurityEventSeverity.WARNING);

    const event = await this.prisma.securityEvent.create({
      data: {
        eventType: input.eventType,
        severity,
        ipAddress: ip,
        userId: input.userId ?? null,
        metadata: {
          ...(input.metadata ?? {}),
          occurrence: recentCount + 1
        }
      }
    });

    return { id: event.id, escalated };
  }

  async getEvents(filters: {
    eventType?: string;
    severity?: SecurityEventSeverity;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const pageNum = Math.max(1, filters.page ?? 1);
    const pageSizeNum = Math.min(100, Math.max(1, filters.pageSize ?? 50));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (filters.eventType) {
      where.eventType = filters.eventType;
    }

    if (filters.severity) {
      where.severity = filters.severity;
    }

    if (filters.search) {
      const search = filters.search.trim();
      where.OR = [
        { ipAddress: { contains: search, mode: 'insensitive' } },
        { user: { telegramId: /^\d+$/.test(search) ? { equals: BigInt(search) } : { equals: -1n } } }
      ];
    }

    const [events, total] = await Promise.all([
      this.prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSizeNum,
        include: {
          user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true } }
        }
      }),
      this.prisma.securityEvent.count({ where })
    ]);

    return {
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        severity: event.severity,
        ipAddress: event.ipAddress,
        userId: event.userId,
        user: event.user
          ? {
              id: event.user.id,
              telegramId: event.user.telegramId.toString(),
              firstName: event.user.firstName,
              lastName: event.user.lastName,
              username: event.user.username
            }
          : null,
        metadata: event.metadata,
        createdAt: event.createdAt
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }
}