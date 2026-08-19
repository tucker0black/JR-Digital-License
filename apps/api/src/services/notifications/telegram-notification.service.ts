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

export class TelegramNotificationService {
  private botToken: string;
  private adminGroupId: string;

  constructor(botToken?: string, adminGroupId?: string) {
    this.botToken = botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
    this.adminGroupId = adminGroupId ?? process.env.TELEGRAM_ADMIN_GROUP_ID ?? '';
  }

  get enabled(): boolean {
    return Boolean(this.botToken && this.adminGroupId);
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

  async sendNewOrderNotification(info: OrderNotificationInfo): Promise<boolean> {
    if (!this.enabled) {
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

    return this.sendTelegramMessage(this.adminGroupId, text);
  }

  async sendOrderDeliveredMessage(info: OrderNotificationInfo & { chatId: string | number }): Promise<boolean> {
    if (!this.botToken) {
      return false;
    }

    const productLines = info.items
      .map((item) => `• ${item.productName}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`)
      .join('\n');

    const text = [
      '✅ Payment Successful',
      '',
      `Order: #${info.orderNumber}`,
      '',
      '📦 Product:',
      productLines,
      '',
      `💰 Total: ${info.currency} ${Number(info.total).toFixed(2)}`,
      '',
      'Your products have been delivered.',
      'Open your order in the Mini App to view your delivery.'
    ].join('\n');

    return this.sendTelegramMessage(info.chatId, text);
  }
}