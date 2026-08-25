import type { PrismaClient } from '@prisma/client';
import { defaultLanguage, normalizeSupportedLanguage, type SupportedLanguage } from '@jr/shared';
import { tOrderNotification } from './order-notification.i18n.js';

export interface OrderNotificationItem {
  productName: string;
  quantity: number;
}

export interface OrderNotificationInfo {
  orderNumber: number;
  items: OrderNotificationItem[];
  total: string;
  currency: string;
}

export interface SendTestResult {
  success: boolean;
  error: string | null;
}

export class TelegramNotificationService {
  private botToken: string;
  private adminGroupId: string;
  private prisma?: PrismaClient;

  constructor(botToken?: string, adminGroupId?: string, prisma?: PrismaClient) {
    this.botToken = botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
    this.adminGroupId = adminGroupId ?? process.env.TELEGRAM_ADMIN_GROUP_ID ?? '';
    this.prisma = prisma;
  }

  get enabled(): boolean {
    return Boolean(this.botToken && this.adminGroupId);
  }

  /**
   * Resolves the customer's persisted UI language (User.language) at the
   * moment a notification is sent, so a language change made AFTER an order
   * was created still governs later asynchronous messages.
   *
   * For customer chats the Telegram chatId IS the customer's telegramId.
   * On any lookup failure the project-wide default language ('km') is used,
   * matching the bot's own fallback behavior — an existing Khmer customer is
   * never silently downgraded to English by a transient error.
   */
  private async resolveCustomerLanguage(chatId: string | number): Promise<SupportedLanguage> {
    try {
      const user = await this.prisma?.user.findUnique({
        where: { telegramId: BigInt(chatId) },
        select: { language: true }
      });
      return normalizeSupportedLanguage(user?.language) ?? defaultLanguage;
    } catch {
      return defaultLanguage;
    }
  }

  private async sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
    if (!this.botToken) {
      return false;
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(chatId), text, disable_web_page_preview: true })
      });
      return response.ok;
    } catch (error) {
      console.error('Failed to send Telegram message.', error);
      return false;
    }
  }

  /**
   * Resolves the chat IDs that should receive an event of the given type.
   * Database-configured targets (when prisma is available) take precedence;
   * the legacy admin group from TELEGRAM_ADMIN_GROUP_ID is still included
   * for backward compatibility unless it is already present as a target.
   */
  private async getTargetChatIds(eventType: string): Promise<string[]> {
    const chatIds = new Set<string>();

    if (this.prisma) {
      const targets = await this.prisma.telegramNotificationTarget.findMany({
        where: { isActive: true },
        select: { chatId: true, eventTypes: true }
      });
      for (const target of targets) {
        const applies = target.eventTypes.length === 0 || target.eventTypes.includes(eventType);
        if (applies) {
          chatIds.add(target.chatId.toString());
        }
      }
    }

    if (this.adminGroupId) {
      chatIds.add(this.adminGroupId);
    }

    return [...chatIds];
  }

  async sendNewOrderNotification(info: OrderNotificationInfo): Promise<boolean> {
    if (!this.botToken) {
      return false;
    }

    const chatIds = await this.getTargetChatIds('NEW_PAID_ORDER');
    if (chatIds.length === 0) {
      return false;
    }

    const productLines = info.items
      .map((item) => `• ${item.productName}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`)
      .join('\n');

    const text = [
      '🎉 NEW ORDER',
      '',
      `🆔 Order: #${info.orderNumber}`,
      '',
      '📦 Product:',
      productLines,
      '',
      `💰 Amount: ${info.currency} ${Number(info.total).toFixed(2)}`,
      '',
      '✅ Payment Confirmed'
    ].join('\n');

    const results = await Promise.all(chatIds.map((chatId) => this.sendTelegramMessage(chatId, text)));
    return results.some(Boolean);
  }

  async sendHandDeliveryOrderNotification(info: OrderNotificationInfo & { customerUsername?: string | null; customerFirstName?: string | null }): Promise<boolean> {
    if (!this.botToken) {
      return false;
    }

    const chatIds = await this.getTargetChatIds('NEW_HAND_DELIVERY_ORDER');
    if (chatIds.length === 0) {
      return false;
    }

    const productLines = info.items
      .map((item) => `• ${item.productName}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`)
      .join('\n');

    const customerName = info.customerFirstName
      ? `${info.customerFirstName}${info.customerUsername ? ` (@${info.customerUsername})` : ''}`
      : info.customerUsername
        ? `@${info.customerUsername}`
        : 'Unknown';

    const text = [
      '🔔 New Hand Delivery Order',
      '',
      `Order: #${info.orderNumber}`,
      '',
      'Product:',
      productLines,
      '',
      `Customer: ${customerName}`,
      '',
      `Amount: ${info.currency} ${Number(info.total).toFixed(2)}`,
      '',
      '⚠️ Waiting for manual delivery.'
    ].join('\n');

    const results = await Promise.all(chatIds.map((chatId) => this.sendTelegramMessage(chatId, text)));
    return results.some(Boolean);
  }

  async sendOrderDeliveredMessage(info: OrderNotificationInfo & { chatId: string | number }): Promise<boolean> {
    if (!this.botToken) {
      return false;
    }

    const language = await this.resolveCustomerLanguage(info.chatId);

    const productLines = info.items
      .map((item) => `• ${item.productName}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`)
      .join('\n');

    const text = [
      tOrderNotification(language, 'payment_successful'),
      '',
      `${tOrderNotification(language, 'order_label')}: #${info.orderNumber}`,
      '',
      tOrderNotification(language, 'product_label'),
      productLines,
      '',
      `${tOrderNotification(language, 'total_label')} ${info.currency} ${Number(info.total).toFixed(2)}`,
      '',
      tOrderNotification(language, 'order_products_delivered'),
      tOrderNotification(language, 'open_order_in_mini_app')
    ].join('\n');

    return this.sendTelegramMessage(info.chatId, text);
  }

  async sendHandDeliveryCompletedNotification(info: OrderNotificationInfo & { chatId: string | number }): Promise<boolean> {
    if (!this.botToken) {
      return false;
    }

    const language = await this.resolveCustomerLanguage(info.chatId);

    const text = [
      tOrderNotification(language, 'order_delivered'),
      '',
      `${tOrderNotification(language, 'order_label')}: #${info.orderNumber}`,
      '',
      tOrderNotification(language, 'open_order_in_mini_app')
    ].join('\n');

    return this.sendTelegramMessage(info.chatId, text);
  }

  /**
   * Sends a real Telegram test message to a target chat so admins can verify
   * that the bot can reach the configured chat. Errors are returned to the
   * caller with the bot token redacted.
   */
  async sendTestMessage(chatId: string | number): Promise<SendTestResult> {
    if (!this.botToken) {
      return { success: false, error: 'Bot token is not configured' };
    }

    const text = [
      '✅ JR Digital license — test notification',
      '',
      'Your notification target is configured correctly.',
      'This message was sent from the Admin Dashboard.'
    ].join('\n');

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(chatId), text, disable_web_page_preview: true })
      });

      const data = (await response.json().catch(() => null)) as { description?: string; ok?: boolean } | null;

      if (!response.ok) {
        const description = data?.description ?? `Telegram API error (HTTP ${response.status})`;
        return { success: false, error: this.redactToken(description) };
      }

      return { success: true, error: null };
    } catch {
      return { success: false, error: 'Telegram is unreachable' };
    }
  }

  private redactToken(value: string): string {
    return this.botToken ? value.split(this.botToken).join('[redacted]') : value;
  }
}