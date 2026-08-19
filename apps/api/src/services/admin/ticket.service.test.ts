import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AdminTicketService } from './ticket.service.js';

function makeMockPrisma() {
  const prisma = {
    supportTicket: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn()
    },
    supportMessage: {
      create: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    }
  };

  prisma.supportTicket.$transaction = undefined as never;
  (prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(prisma)
  );

  return prisma as unknown as PrismaClient;
}

const USER_ROW = {
  id: 'user-1',
  telegramId: BigInt(123456789),
  username: 'rothajim',
  firstName: 'Rotha',
  lastName: 'Jim'
};

const ORDER_ROW = { id: 'order-1', orderNumber: 11 };

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    number: 5,
    userId: 'user-1',
    orderId: 'order-1',
    subject: 'Payment problem',
    status: 'IN_PROGRESS',
    createdAt: new Date('2026-08-18T10:00:00Z'),
    updatedAt: new Date('2026-08-18T11:00:00Z'),
    user: USER_ROW,
    order: ORDER_ROW,
    messages: [
      {
        id: 'msg-1',
        ticketId: 'ticket-1',
        userId: 'user-1',
        adminId: null,
        sender: 'SYSTEM',
        body: 'Welcome',
        createdAt: new Date('2026-08-18T10:00:01Z'),
        admin: null
      },
      {
        id: 'msg-2',
        ticketId: 'ticket-1',
        userId: 'user-1',
        adminId: null,
        sender: 'USER',
        body: 'Need help',
        createdAt: new Date('2026-08-18T10:00:02Z'),
        admin: null
      },
      {
        id: 'msg-3',
        ticketId: 'ticket-1',
        userId: null,
        adminId: 'admin-1',
        sender: 'ADMIN',
        body: 'We are checking this',
        createdAt: new Date('2026-08-18T10:30:00Z'),
        admin: { id: 'admin-1', firstName: 'Jane', lastName: 'Staff' }
      }
    ],
    _count: { messages: 3 },
    ...overrides
  };
}

describe('AdminTicketService', () => {
  let prisma: PrismaClient;
  let service: AdminTicketService;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();

    prisma = makeMockPrisma();
    service = new AdminTicketService(prisma);
    vi.mocked(prisma.supportTicket.findUnique).mockResolvedValue(ticketRow());
    vi.mocked(prisma.supportTicket.findMany).mockResolvedValue([ticketRow()]);
    vi.mocked(prisma.supportTicket.count).mockResolvedValue(1);
    vi.mocked(prisma.supportTicket.update).mockResolvedValue({
      id: 'ticket-1',
      status: 'IN_PROGRESS',
      updatedAt: new Date()
    });
    vi.mocked(prisma.supportMessage.create).mockResolvedValue({
      id: 'msg-4',
      ticketId: 'ticket-1',
      userId: null,
      adminId: 'admin-1',
      sender: 'ADMIN',
      body: 'Reply',
      createdAt: new Date()
    });
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-1' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('shows the customer display name, Telegram username, Telegram user ID, and internal ID', async () => {
    const ticket = await service.getTicketById('ticket-1');

    expect(ticket.user).toMatchObject({
      id: 'user-1',
      telegramId: '123456789',
      displayName: 'Rotha Jim',
      usernameHandle: '@rothajim',
      username: 'rothajim'
    });
  });

  it('shows the linked order and the ticket number', async () => {
    const ticket = await service.getTicketById('ticket-1');

    expect(ticket.number).toBe(5);
    expect(ticket.order).toEqual({ id: 'order-1', orderNumber: 11 });
    expect(ticket.status).toBe('IN_PROGRESS');
  });

  it('shows the welcome message as a SYSTEM message', async () => {
    const ticket = await service.getTicketById('ticket-1');

    expect(ticket.messages[0].sender).toBe('SYSTEM');
    expect(ticket.messages[0].fromAdmin).toBe(false);
  });

  it('shows the admin name on admin replies', async () => {
    const ticket = await service.getTicketById('ticket-1');

    expect(ticket.messages[2].sender).toBe('ADMIN');
    expect(ticket.messages[2].fromAdmin).toBe(true);
    expect(ticket.messages[2].adminName).toBe('Jane Staff');
  });

  it('shows a real Telegram username alongside a fallback display name', async () => {
    vi.mocked(prisma.supportTicket.findUnique).mockResolvedValue(
      ticketRow({
        user: {
          id: 'user-1',
          telegramId: BigInt(123456789),
          username: 'rothajim',
          firstName: 'Dev User',
          lastName: null
        }
      })
    );

    const ticket = await service.getTicketById('ticket-1');

    expect(ticket.user.displayName).toBe('Dev User');
    expect(ticket.user.usernameHandle).toBe('@rothajim');
  });

  it('returns null when the ticket does not exist', async () => {
    vi.mocked(prisma.supportTicket.findUnique).mockResolvedValue(null);

    const ticket = await service.getTicketById('missing');

    expect(ticket).toBeNull();
  });

  it('does not expose bot tokens, init data, or credentials in ticket payloads', async () => {
    const ticket = await service.getTicketById('ticket-1');
    const serialized = JSON.stringify(ticket);

    expect(serialized).not.toContain('WebAppData');
    expect(serialized).not.toContain('initData');
    expect(serialized).not.toContain('auth_date');
    expect(serialized).not.toContain('hash=');
    expect(serialized).not.toContain('Bot Token');
    expect(serialized).not.toContain('password');
  });

  it('creates an admin reply marked as ADMIN with an audit record', async () => {
    const result = await service.replyToTicket('ticket-1', 'admin-1', 'We are checking this');

    expect(prisma.supportMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: 'ticket-1', adminId: 'admin-1', sender: 'ADMIN' })
      })
    );
    expect(result.sender).toBe('ADMIN');
    expect(result.fromAdmin).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityType: 'SupportTicket', action: 'REPLY' }) })
    );
  });

  it('cannot reply to a closed ticket', async () => {
    vi.mocked(prisma.supportTicket.findUnique).mockResolvedValue(ticketRow({ status: 'CLOSED' }));

    await expect(service.replyToTicket('ticket-1', 'admin-1', 'Hi')).rejects.toThrow(
      'Cannot reply to a closed ticket'
    );
  });

  it('creates admin replies as unread for the customer but read for the admin', async () => {
    await service.replyToTicket('ticket-1', 'admin-1', 'We are checking this');

    expect(prisma.supportMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sender: 'ADMIN',
          customerReadAt: null,
          adminReadAt: expect.any(Date)
        })
      })
    );
  });

  it('marks customer messages as admin-read when the admin opens the ticket', async () => {
    vi.mocked(prisma.supportTicket.findUnique)
      .mockResolvedValueOnce({ id: 'ticket-1' })
      .mockResolvedValue(ticketRow());

    await service.getTicketById('ticket-1');

    expect(prisma.supportMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ticketId: 'ticket-1',
          sender: 'USER',
          adminReadAt: null
        },
        data: expect.objectContaining({ adminReadAt: expect.any(Date) })
      })
    );
  });

  it('counts unread customer messages for the admin across all tickets', async () => {
    vi.mocked(prisma.supportMessage.count).mockResolvedValue(4);

    const result = await service.getUnreadCount();

    expect(result.unreadCount).toBe(4);
    expect(prisma.supportMessage.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sender: 'USER',
          adminReadAt: null
        }
      })
    );
  });

  it('returns the per-ticket unread customer-message count in the list', async () => {
    vi.mocked(prisma.supportTicket.findMany).mockResolvedValue([
      ticketRow({ _count: { messages: 3 } })
    ]);
    vi.mocked(prisma.supportTicket.count).mockResolvedValue(1);
    vi.mocked(prisma.supportMessage.groupBy).mockResolvedValue([
      { ticketId: 'ticket-1', _count: { _all: 2 } }
    ]);

    const result = await service.getTickets({ page: 1, pageSize: 20 });

    expect(result.tickets[0].unreadCount).toBe(2);
    expect(result.tickets[0].messageCount).toBe(3);
    expect(prisma.supportMessage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['ticketId'],
        where: expect.objectContaining({
          ticketId: { in: ['ticket-1'] },
          sender: 'USER',
          adminReadAt: null
        })
      })
    );
  });
});