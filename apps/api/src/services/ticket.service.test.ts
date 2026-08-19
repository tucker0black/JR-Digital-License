import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { CustomerTicketService } from './ticket.service.js';

function makeMockPrisma() {
  const prisma = {
    user: { findUnique: vi.fn() },
    order: { findFirst: vi.fn() },
    supportTicket: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn()
    },
    supportMessage: {
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn()
    }
  };

  prisma.supportTicket.$transaction = undefined as never;
  (prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(prisma)
  );

  return prisma as unknown as PrismaClient & {
    supportTicket: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    supportMessage: { create: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn> };
    order: { findFirst: ReturnType<typeof vi.fn> };
  };
}

const TICKET_ROW = {
  id: 'ticket-1',
  number: 5,
  userId: 'user-1',
  orderId: 'order-1',
  subject: 'Payment problem',
  status: 'OPEN',
  createdAt: new Date('2026-08-18T10:00:00Z'),
  updatedAt: new Date('2026-08-18T10:00:00Z')
};

describe('CustomerTicketService', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let service: CustomerTicketService;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();

    prisma = makeMockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe'
    });
    prisma.order.findFirst.mockResolvedValue({ id: 'order-1', userId: 'user-1' });
    prisma.supportTicket.create.mockResolvedValue({ ...TICKET_ROW });
    prisma.supportTicket.findUnique.mockResolvedValue({ ...TICKET_ROW });
    prisma.supportTicket.update.mockResolvedValue({ id: 'ticket-1', status: 'OPEN' });
    prisma.supportMessage.create.mockResolvedValue({
      id: 'msg-1',
      ticketId: 'ticket-1',
      sender: 'USER',
      body: 'Help',
      createdAt: new Date()
    });
    prisma.supportMessage.count.mockResolvedValue(0);
    service = new CustomerTicketService(prisma);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('creates a ticket bound to the authenticated user identity', async () => {
    const ticket = await service.createTicket('user-1', 'Payment problem', 'Need help', 'order-1');

    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1', userId: 'user-1' } })
    );
    expect(prisma.supportTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1' }) })
    );
    expect(ticket.id).toBe('ticket-1');
  });

  it('creates exactly ONE system welcome message with the customer display name on the first message', async () => {
    await service.createTicket('user-1', 'Payment problem', 'Need help', 'order-1');

    const welcomeCreates = prisma.supportMessage.create.mock.calls.filter(
      (call) => call[0]?.data?.sender === 'SYSTEM'
    );
    expect(welcomeCreates).toHaveLength(1);
    expect(welcomeCreates[0][0].data.ticketId).toBe('ticket-1');
    expect(welcomeCreates[0][0].data.body).toContain('Welcome, John Doe');
    expect(welcomeCreates[0][0].data.body).toContain('Ticket: #5');
    expect(prisma.supportMessage.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ticketId: 'ticket-1', sender: 'SYSTEM' } })
    );
  });

  it('uses the real Telegram display name in the welcome message', async () => {
    prisma.user.findUnique.mockResolvedValue({
      firstName: 'Rotha',
      lastName: 'Jim',
      username: 'rothajim'
    });

    await service.createTicket('user-1', 'Payment problem', 'Need help');

    const welcome = prisma.supportMessage.create.mock.calls.find(
      (call) => call[0]?.data?.sender === 'SYSTEM'
    );
    expect(welcome[0].data.body).toContain('Welcome, Rotha Jim');
  });

  it('falls back to the username in the welcome message when there is no name', async () => {
    prisma.user.findUnique.mockResolvedValue({
      firstName: '',
      lastName: null,
      username: 'rothajim'
    });

    await service.createTicket('user-1', 'Payment problem', 'Need help');

    const welcome = prisma.supportMessage.create.mock.calls.find(
      (call) => call[0]?.data?.sender === 'SYSTEM'
    );
    expect(welcome[0].data.body).toContain('Welcome, rothajim');
  });

  it('does not create another welcome message when the customer sends additional messages', async () => {
    await service.createTicket('user-1', 'Payment problem', 'Need help');
    await service.replyToTicket('ticket-1', 'user-1', 'More details');

    const welcomeCreates = prisma.supportMessage.create.mock.calls.filter(
      (call) => call[0]?.data?.sender === 'SYSTEM'
    );
    expect(welcomeCreates).toHaveLength(1);
    const userCreates = prisma.supportMessage.create.mock.calls.filter(
      (call) => call[0]?.data?.sender === 'USER'
    );
    expect(userCreates).toHaveLength(2);
  });

  it('does not duplicate the welcome message when the welcome step is retried', async () => {
    prisma.supportMessage.count
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1);

    await service.ensureWelcomeMessage('ticket-1', 5, 'user-1');
    await service.ensureWelcomeMessage('ticket-1', 5, 'user-1');

    expect(prisma.supportMessage.count).toHaveBeenCalledTimes(2);
    expect(prisma.supportMessage.count).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { ticketId: 'ticket-1', sender: 'SYSTEM' } })
    );
    const welcomeCreates = prisma.supportMessage.create.mock.calls.filter(
      (call) => call[0]?.data?.sender === 'SYSTEM'
    );
    expect(welcomeCreates).toHaveLength(1);
  });

  it('does not duplicate the welcome message when the first-message request is retried', async () => {
    prisma.supportMessage.count.mockResolvedValue(1);

    await service.createTicket('user-1', 'Payment problem', 'Need help');
    await service.ensureWelcomeMessage('ticket-1', 5, 'user-1');

    const welcomeCreates = prisma.supportMessage.create.mock.calls.filter(
      (call) => call[0]?.data?.sender === 'SYSTEM'
    );
    expect(welcomeCreates).toHaveLength(0);
  });

  it('saves the customer message even when welcome-message creation fails', async () => {
    prisma.supportMessage.create.mockImplementation((args: { data?: { sender?: string } }) => {
      if (args?.data?.sender === 'SYSTEM') {
        return Promise.reject(new Error('database unavailable'));
      }
      return Promise.resolve({ id: 'msg-1', sender: 'USER', body: 'Need help', createdAt: new Date() });
    });

    const ticket = await service.createTicket('user-1', 'Payment problem', 'Need help', 'order-1');

    expect(ticket.id).toBe('ticket-1');
    const userCreates = prisma.supportMessage.create.mock.calls.filter(
      (call) => call[0]?.data?.sender === 'USER'
    );
    expect(userCreates).toHaveLength(1);
    expect(userCreates[0][0].data.body).toBe('Need help');
  });

  it('returns null when a customer reads another customer ticket', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({ ...TICKET_ROW, userId: 'user-2' });

    const result = await service.getTicketById('ticket-1', 'user-1');

    expect(result).toBeNull();
  });

  it('rejects a reply from a customer who does not own the ticket', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({ ...TICKET_ROW, userId: 'user-2' });

    await expect(service.replyToTicket('ticket-1', 'user-1', 'Hi')).rejects.toThrow('Ticket not found');
  });

  it('rejects a reply to a closed ticket', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({ ...TICKET_ROW, status: 'CLOSED' });

    await expect(service.replyToTicket('ticket-1', 'user-1', 'Hi')).rejects.toThrow('Ticket is closed');
  });

  it('counts only unread ADMIN messages across all tickets of the customer', async () => {
    prisma.supportMessage.count.mockResolvedValue(5);

    const result = await service.getUnreadCount('user-1');

    expect(result.unreadCount).toBe(5);
    expect(prisma.supportMessage.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sender: 'ADMIN',
          customerReadAt: null,
          ticket: { userId: 'user-1' }
        }
      })
    );
  });

  it('counts zero when only USER and SYSTEM messages exist', async () => {
    prisma.supportMessage.count.mockResolvedValue(0);

    const result = await service.getUnreadCount('user-1');

    expect(result.unreadCount).toBe(0);
    const where = prisma.supportMessage.count.mock.calls[0][0].where as { sender: string };
    expect(where.sender).toBe('ADMIN');
  });

  it('marks only the opened ticket read when the customer opens it', async () => {
    prisma.supportTicket.findUnique
      .mockResolvedValueOnce({ id: 'ticket-1', userId: 'user-1' })
      .mockResolvedValue({ ...TICKET_ROW, order: null, messages: [] });

    await service.getTicketById('ticket-1', 'user-1');

    expect(prisma.supportMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ticketId: 'ticket-1',
          sender: 'ADMIN',
          customerReadAt: null,
          ticket: { userId: 'user-1' }
        },
        data: expect.objectContaining({ customerReadAt: expect.any(Date) })
      })
    );
  });

  it('marks every ticket read when the customer opens the support list', async () => {
    prisma.supportTicket.findMany.mockResolvedValue([]);
    prisma.supportTicket.count.mockResolvedValue(0);

    await service.getTickets('user-1');

    expect(prisma.supportMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sender: 'ADMIN',
          customerReadAt: null,
          ticket: { userId: 'user-1' }
        },
        data: expect.objectContaining({ customerReadAt: expect.any(Date) })
      })
    );
  });

  it('never marks messages read for a ticket the customer does not own', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({ ...TICKET_ROW, userId: 'user-2' });

    const result = await service.getTicketById('ticket-1', 'user-1');

    expect(result).toBeNull();
    expect(prisma.supportMessage.updateMany).not.toHaveBeenCalled();
  });

  it('does not create unread messages for the customer from their own messages', async () => {
    await service.createTicket('user-1', 'Payment problem', 'Need help', 'order-1');
    await service.replyToTicket('ticket-1', 'user-1', 'More details');

    const userCreates = prisma.supportMessage.create.mock.calls.filter(
      (call) => call[0]?.data?.sender === 'USER'
    );
    for (const call of userCreates) {
      expect(call[0].data.customerReadAt).toEqual(expect.any(Date));
      expect(call[0].data.adminReadAt).toBeNull();
    }
  });

  it('marks the SYSTEM welcome message as read for both sides', async () => {
    await service.createTicket('user-1', 'Payment problem', 'Need help');

    const welcome = prisma.supportMessage.create.mock.calls.find(
      (call) => call[0]?.data?.sender === 'SYSTEM'
    );
    expect(welcome[0].data.customerReadAt).toEqual(expect.any(Date));
    expect(welcome[0].data.adminReadAt).toEqual(expect.any(Date));
  });

  it('keeps marking idempotent: messages already read are not re-marked', async () => {
    await service.markTicketRead('ticket-1', 'user-1');

    expect(prisma.supportMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerReadAt: null })
      })
    );
  });
});