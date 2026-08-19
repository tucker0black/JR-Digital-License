import type { PrismaClient, Prisma } from '@prisma/client';

export interface AuditLogFilters {
  adminId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
}

export interface AuditLogEntry {
  id: string;
  adminId: string | null;
  admin: { username: string | null; firstName: string; lastName: string | null } | null;
  entityType: string;
  entityId: string | null;
  action: string;
  oldValue: Prisma.JsonValue | null;
  newValue: Prisma.JsonValue | null;
  ipAddress: string | null;
  createdAt: Date;
}

export class AuditService {
  constructor(private prisma: PrismaClient) {}

  async getAuditLogs(filters: AuditLogFilters = {}) {
    const {
      adminId,
      entityType,
      entityId,
      action,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 50
    } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(200, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (adminId) where.adminId = adminId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (action) where.action = action;
    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = dateFrom;
      if (dateTo) createdAt.lte = dateTo;
      where.createdAt = createdAt;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: Math.min(200, Math.max(1, 50)),
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, username: true, firstName: true, lastName: true } }
        }
      }),
      this.prisma.auditLog.count({ where })
    ]);

    return {
      logs: logs.map(log => ({
        ...log,
        admin: log.admin ? {
          username: log.admin.username,
          firstName: log.admin.firstName,
          lastName: log.admin.lastName
        } : null
      })),
      total,
      page: Math.max(1, page),
      pageSize: Math.min(200, Math.max(1, 50))
    };
  }

  async getAuditLogById(id: string) {
    const log = await this.prisma.auditLog.findUnique({
      where: { id },
      include: {
        admin: { select: { id: true, username: true, firstName: true, lastName: true } }
      }
    });

    if (!log) return null;

    return {
      ...log,
      admin: log.admin ? {
        username: log.admin.username,
        firstName: log.admin.firstName,
        lastName: log.admin.lastName
      } : null
    };
  }

  async getEntityHistory(entityType: string, entityId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        admin: { select: { id: true, username: true, firstName: true, lastName: true } }
      }
    });

    return logs.map(log => ({
      ...log,
      admin: log.admin ? {
        username: log.admin.username,
        firstName: log.admin.firstName,
        lastName: log.admin.lastName
      } : null
    }));
  }

  async getAdminActivity(adminId: string, limit: number = 50) {
    const logs = await this.prisma.auditLog.findMany({
      where: { adminId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        admin: { select: { id: true, username: true, firstName: true, lastName: true } }
      }
    });

    return logs.map(log => ({
      ...log,
      admin: log.admin ? {
        username: log.admin.username,
        firstName: log.admin.firstName,
        lastName: log.admin.lastName
      } : null
    }));
  }

  async getActionSummary(dateFrom?: Date, dateTo?: Date) {
    const where: Record<string, unknown> = {};
    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = dateFrom;
      if (dateTo) createdAt.lte = dateTo;
      where.createdAt = createdAt;
    }

    const [byAction, byEntity, byAdmin] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['action'], where, _count: { action: true } }),
      this.prisma.auditLog.groupBy({ by: ['entityType'], where, _count: { entityType: true } }),
      this.prisma.auditLog.groupBy({ by: ['adminId'], where, _count: { adminId: true } })
    ]);

    return {
      byAction: byAction.reduce((acc, item) => { acc[item.action] = item._count.action; return acc; }, {} as Record<string, number>),
      byEntity: byEntity.reduce((acc, item) => { acc[item.entityType] = item._count.entityType; return acc; }, {} as Record<string, number>),
      byAdmin: byAdmin.reduce((acc, item) => { 
        if (item.adminId) acc[item.adminId] = item._count.adminId; 
        return acc; 
      }, {} as Record<string, number>)
    };
  }
}