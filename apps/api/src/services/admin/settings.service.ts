import type { PrismaClient, NotificationChannel, Prisma } from '@prisma/client';

export interface NotificationTargetInput {
  chatId: bigint | string | number;
  name: string;
  channel?: NotificationChannel;
  eventTypes?: string[];
  isActive?: boolean;
}

export class AdminSettingsService {
  constructor(private prisma: PrismaClient) {}

  async getSettings() {
    const settings = await this.prisma.applicationSetting.findMany({
      orderBy: { key: 'asc' }
    });

    // Secret values are never returned to any client, including admins.
    return {
      settings: settings
        .filter(setting => !setting.isSecret)
        .map(setting => ({
          key: setting.key,
          value: setting.value,
          description: setting.description,
          updatedAt: setting.updatedAt
        }))
    };
  }

  async updateSetting(key: string, value: unknown, adminId: string) {
    const setting = await this.prisma.applicationSetting.findUnique({
      where: { key }
    });

    if (!setting) {
      throw new Error('Setting not found');
    }

    // Secret settings (payment/SMM/Telegram credentials) cannot be changed through the API.
    if (setting.isSecret) {
      throw new Error('Setting is protected and cannot be updated through the API');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.applicationSetting.update({
        where: { key },
        data: { value: value as never }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'ApplicationSetting',
          entityId: key,
          action: 'UPDATE',
          oldValue: { value: setting.value },
          newValue: { value: value as Prisma.JsonValue }
        }
      });

      return {
        key: updated.key,
        value: updated.value,
        description: updated.description,
        updatedAt: updated.updatedAt
      };
    });
  }

  async getNotificationTargets() {
    const targets = await this.prisma.telegramNotificationTarget.findMany({
      orderBy: { createdAt: 'asc' }
    });

    return {
      targets: targets.map(target => ({
        id: target.id,
        chatId: target.chatId.toString(),
        name: target.name,
        channel: target.channel,
        eventTypes: target.eventTypes,
        isActive: target.isActive,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt
      }))
    };
  }

  async createNotificationTarget(input: NotificationTargetInput, adminId: string) {
    const chatId = typeof input.chatId === 'bigint'
      ? input.chatId
      : BigInt(input.chatId.toString());

    const existing = await this.prisma.telegramNotificationTarget.findUnique({
      where: { chatId }
    });

    if (existing) {
      throw new Error('A notification target with this chat ID already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.telegramNotificationTarget.create({
        data: {
          chatId,
          name: input.name,
          channel: input.channel ?? 'TELEGRAM_GROUP',
          eventTypes: input.eventTypes ?? [],
          isActive: input.isActive !== false
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TelegramNotificationTarget',
          entityId: target.id,
          action: 'CREATE',
          newValue: {
            chatId: target.chatId.toString(),
            name: target.name,
            channel: target.channel,
            eventTypes: target.eventTypes,
            isActive: target.isActive
          }
        }
      });

      return serializeTarget(target);
    });
  }

  async updateNotificationTarget(id: string, input: {
    name?: string;
    channel?: NotificationChannel;
    eventTypes?: string[];
    isActive?: boolean;
  }, adminId: string) {
    const existing = await this.prisma.telegramNotificationTarget.findUnique({
      where: { id }
    });

    if (!existing) {
      throw new Error('Notification target not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.telegramNotificationTarget.update({
        where: { id },
        data: {
          name: input.name,
          channel: input.channel,
          eventTypes: input.eventTypes,
          isActive: input.isActive
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TelegramNotificationTarget',
          entityId: id,
          action: 'UPDATE',
          oldValue: {
            name: existing.name,
            channel: existing.channel,
            eventTypes: existing.eventTypes,
            isActive: existing.isActive
          },
          newValue: {
            name: target.name,
            channel: target.channel,
            eventTypes: target.eventTypes,
            isActive: target.isActive
          }
        }
      });

      return serializeTarget(target);
    });
  }

  async deleteNotificationTarget(id: string, adminId: string) {
    const existing = await this.prisma.telegramNotificationTarget.findUnique({
      where: { id }
    });

    if (!existing) {
      throw new Error('Notification target not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.telegramNotificationTarget.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TelegramNotificationTarget',
          entityId: id,
          action: 'DELETE',
          oldValue: { name: existing.name, chatId: existing.chatId.toString() }
        }
      });
    });
  }
}

function serializeTarget(target: {
  id: string;
  chatId: bigint;
  name: string;
  channel: string;
  eventTypes: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: target.id,
    chatId: target.chatId.toString(),
    name: target.name,
    channel: target.channel,
    eventTypes: target.eventTypes,
    isActive: target.isActive,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt
  };
}