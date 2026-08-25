import type { PrismaClient, SupportTicketStatus } from '@prisma/client';
import { customerIdFromTelegramId } from '@jr/shared';

export interface TicketFilters {
  search?: string;
  status?: SupportTicketStatus;
  userId?: string;
  page?: number;
  pageSize?: number;
}

interface TicketUser {
  id: string;
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
}

function serializeUser(user: TicketUser) {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    customerId: customerIdFromTelegramId(user.telegramId),
    username: user.username,
    displayName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || null,
    usernameHandle: user.username ? `@${user.username}` : null,
    firstName: user.firstName,
    lastName: user.lastName
  };
}

function serializeMessage(message: {
  id: string;
  ticketId: string;
  userId: string | null;
  adminId: string | null;
  sender: string;
  body: string;
  createdAt: Date;
  admin: { id: string; firstName: string; lastName: string | null } | null;
}) {
  return {
    id: message.id,
    ticketId: message.ticketId,
    userId: message.userId,
    adminId: message.adminId,
    sender: message.sender,
    body: message.body,
    createdAt: message.createdAt,
    fromAdmin: message.adminId !== null,
    adminName: message.admin
      ? [message.admin.firstName, message.admin.lastName].filter(Boolean).join(' ') || 'Support'
      : null
  };
}

export class AdminTicketService {
  constructor(private prisma: PrismaClient) {}

  async getUnreadCount() {
    const unreadCount = await this.prisma.supportMessage.count({
      where: {
        sender: 'USER',
        adminReadAt: null
      }
    });

    return { unreadCount };
  }

  async getTickets(filters: TicketFilters = {}) {
    const {
      search,
      status,
      userId,
      page = 1,
      pageSize = 20
    } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(100, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { user: { username: { contains: search, mode: 'insensitive' } } }
      ];
    }

    if (status) {
      where.status = status;
    }

    if (userId) {
      where.userId = userId;
    }

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: pageSizeNum,
        orderBy: { updatedAt: 'desc' },
        include: {
          user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } },
          order: { select: { id: true, orderNumber: true } },
          _count: { select: { messages: true } }
        }
      }),
      this.prisma.supportTicket.count({ where })
    ]);

    const ticketIds = tickets.map(ticket => ticket.id);
    const unreadGroups = ticketIds.length > 0
      ? await this.prisma.supportMessage.groupBy({
          by: ['ticketId'],
          where: {
            ticketId: { in: ticketIds },
            sender: 'USER',
            adminReadAt: null
          },
          _count: { _all: true }
        })
      : [];
    const unreadByTicket = new Map(unreadGroups.map(group => [group.ticketId, group._count._all]));

    return {
      tickets: tickets.map(ticket => ({
        id: ticket.id,
        number: ticket.number,
        userId: ticket.userId,
        orderId: ticket.orderId,
        subject: ticket.subject,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        user: ticket.user ? serializeUser(ticket.user) : null,
        order: ticket.order,
        messageCount: ticket._count.messages,
        unreadCount: unreadByTicket.get(ticket.id) ?? 0
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async getTicketById(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!ticket) return null;

    await this.prisma.supportMessage.updateMany({
      where: {
        ticketId: id,
        sender: 'USER',
        adminReadAt: null
      },
      data: { adminReadAt: new Date() }
    });

    const detail = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, telegramId: true, username: true, firstName: true, lastName: true } },
        order: { select: { id: true, orderNumber: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            admin: { select: { id: true, firstName: true, lastName: true } }
          }
        },
        _count: { select: { messages: true } }
      }
    });

    if (!detail) return null;

    return {
      id: detail.id,
      number: detail.number,
      userId: detail.userId,
      orderId: detail.orderId,
      subject: detail.subject,
      status: detail.status,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      user: serializeUser(detail.user),
      order: detail.order,
      messageCount: detail._count.messages,
      messages: detail.messages.map(serializeMessage)
    };
  }

  async replyToTicket(ticketId: string, adminId: string, body: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId }
    });

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    if (ticket.status === 'CLOSED') {
      throw new Error('Cannot reply to a closed ticket');
    }

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.create({
        data: {
          ticketId,
          adminId,
          sender: 'ADMIN',
          body,
          customerReadAt: null,
          adminReadAt: new Date()
        }
      });

      const updated = await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'IN_PROGRESS' }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'SupportTicket',
          entityId: ticketId,
          action: 'REPLY',
          newValue: { messageId: message.id, status: updated.status }
        }
      });

      return {
        id: message.id,
        ticketId: message.ticketId,
        userId: message.userId,
        adminId: message.adminId,
        sender: message.sender,
        body: message.body,
        createdAt: message.createdAt,
        fromAdmin: true,
        status: updated.status
      };
    });
  }

  async updateTicketStatus(ticketId: string, status: SupportTicketStatus, adminId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId }
    });

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    if (ticket.status === status) {
      throw new Error(`Ticket is already ${status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'SupportTicket',
          entityId: ticketId,
          action: 'STATUS_CHANGED',
          oldValue: { status: ticket.status },
          newValue: { status }
        }
      });

      return {
        id: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt
      };
    });
  }
}