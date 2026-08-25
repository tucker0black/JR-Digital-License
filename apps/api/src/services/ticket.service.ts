import type { PrismaClient, SupportMessageSender } from '@prisma/client';
import { SupportAvailabilityService } from './support-hours.service.js';

function getUserDisplayName(user: { firstName: string; lastName: string | null; username: string | null }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || 'there';
}

function buildWelcomeMessageBody(customerName: string, ticketNumber: number): string {
  return [
    `👋 Welcome, ${customerName}!`,
    '',
    'Thank you for contacting JR Digital license support.',
    'Your support request has been received. Our support team will reply as soon as possible.',
    '',
    `Ticket: #${ticketNumber}`
  ].join('\n');
}

export class CustomerTicketService {
  constructor(
    private prisma: PrismaClient,
    private supportHours: SupportAvailabilityService = new SupportAvailabilityService()
  ) {}

  async getUnreadCount(userId: string) {
    const unreadCount = await this.prisma.supportMessage.count({
      where: {
        sender: 'ADMIN',
        customerReadAt: null,
        ticket: { userId }
      }
    });

    return { unreadCount };
  }

  async getTickets(userId: string, page = 1, pageSize = 20) {
    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(50, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    await this.markAllRead(userId);

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: { userId },
        skip,
        take: pageSizeNum,
        orderBy: { updatedAt: 'desc' },
        include: {
          order: { select: { id: true, orderNumber: true } },
          _count: { select: { messages: true } }
        }
      }),
      this.prisma.supportTicket.count({ where: { userId } })
    ]);

    return {
      tickets: tickets.map(ticket => ({
        id: ticket.id,
        number: ticket.number,
        subject: ticket.subject,
        status: ticket.status,
        orderId: ticket.orderId,
        order: ticket.order,
        messageCount: ticket._count.messages,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async createTicket(userId: string, subject: string, body: string, orderId?: string | null) {
    if (!this.supportHours.isOpen()) {
      const pendingThread = await this.prisma.supportTicket.findFirst({
        where: {
          userId,
          messages: { some: { sender: 'USER' }, none: { sender: 'ADMIN' } }
        },
        select: { id: true }
      });
      if (pendingThread) {
        throw new Error(this.supportHours.buildBlockedMessage());
      }
    }

    const ticket = await this.prisma.$transaction(async (tx) => {
      if (orderId) {
        const order = await tx.order.findFirst({
          where: { id: orderId, userId }
        });
        if (!order) {
          throw new Error('Linked order not found');
        }
      }

      const created = await tx.supportTicket.create({
        data: {
          userId,
          orderId: orderId ?? null,
          subject,
          status: 'OPEN'
        }
      });

      await tx.supportMessage.create({
        data: {
          ticketId: created.id,
          userId,
          sender: 'USER',
          body,
          customerReadAt: new Date(),
          adminReadAt: null
        }
      });

      return created;
    });

    await this.ensureWelcomeMessage(ticket.id, ticket.number, userId);

    return ticket;
  }

  async markAllRead(userId: string) {
    await this.prisma.supportMessage.updateMany({
      where: {
        sender: 'ADMIN',
        customerReadAt: null,
        ticket: { userId }
      },
      data: { customerReadAt: new Date() }
    });
  }

  async markTicketRead(ticketId: string, userId: string) {
    await this.prisma.supportMessage.updateMany({
      where: {
        ticketId,
        sender: 'ADMIN',
        customerReadAt: null,
        ticket: { userId }
      },
      data: { customerReadAt: new Date() }
    });
  }

  async ensureWelcomeMessage(ticketId: string, ticketNumber: number, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, username: true }
    });

    if (!user) {
      return;
    }

    try {
      const existing = await this.prisma.supportMessage.count({
        where: { ticketId, sender: 'SYSTEM' as SupportMessageSender }
      });

      if (existing > 0) {
        return;
      }

      await this.prisma.supportMessage.create({
        data: {
          ticketId,
          sender: 'SYSTEM',
          body: buildWelcomeMessageBody(getUserDisplayName(user), ticketNumber),
          customerReadAt: new Date(),
          adminReadAt: new Date()
        }
      });
    } catch (error) {
      console.error('Failed to create ticket welcome message', error);
    }
  }

  async getTicketById(ticketId: string, userId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { userId: true }
    });

    if (!ticket || ticket.userId !== userId) {
      return null;
    }

    await this.markTicketRead(ticketId, userId);

    const detail = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        order: { select: { id: true, orderNumber: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            admin: { select: { id: true, firstName: true, lastName: true } }
          }
        }
      }
    });

    if (!detail) {
      return null;
    }

    return {
      id: detail.id,
      number: detail.number,
      subject: detail.subject,
      status: detail.status,
      orderId: detail.orderId,
      order: detail.order,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      messages: detail.messages.map(message => ({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt,
        sender: message.sender,
        fromAdmin: message.adminId !== null,
        adminName: message.admin
          ? [message.admin.firstName, message.admin.lastName].filter(Boolean).join(' ') || 'Support'
          : null
      }))
    };
  }

  async replyToTicket(ticketId: string, userId: string, body: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId }
    });

    if (!ticket || ticket.userId !== userId) {
      throw new Error('Ticket not found');
    }

    if (ticket.status === 'CLOSED') {
      throw new Error('Ticket is closed');
    }

    if (!this.supportHours.isOpen()) {
      const [adminMessages, userMessages] = await Promise.all([
        this.prisma.supportMessage.count({ where: { ticketId, sender: 'ADMIN' } }),
        this.prisma.supportMessage.count({ where: { ticketId, sender: 'USER' } })
      ]);
      if (adminMessages === 0 && userMessages >= 1) {
        throw new Error(this.supportHours.buildBlockedMessage());
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.create({
        data: {
          ticketId,
          userId,
          sender: 'USER',
          body,
          customerReadAt: new Date(),
          adminReadAt: null
        }
      });

      const updated = await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'OPEN' }
      });

      return {
        id: message.id,
        body: message.body,
        createdAt: message.createdAt,
        sender: message.sender,
        fromAdmin: false,
        status: updated.status
      };
    });
  }
}