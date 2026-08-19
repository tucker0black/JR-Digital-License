import { appName } from '@jr/shared';
import { Bot, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';

const messages = {
  welcome: `👋 Welcome to ${appName}!\n\n🛍 Buy digital products and SMM services directly through our Mini App.`,
  openStoreButton: '🛍 Open JR Digital License',
  menuButton: '🛍 Open Mini App',
  balanceFallback: '💰 Balance is temporarily unavailable. Please try again later.',
  ordersFallback: '📦 Orders are temporarily unavailable. Please try again later.',
  help: `ℹ️ Use the button below to open ${appName}.\n\n💰 Check your balance with /balance\n📦 View your orders with /orders\n💬 Contact support with /support`,
  support: `💬 Need help?\n\nOpen ${appName} and go to the Support section to create a ticket, or send a message here and our team will get back to you.`
} as const;

export function isTelegramWebAppUrl(url: string): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (parsedUrl.protocol !== 'https:') {
      return false;
    }

    return !(
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

function canRenderWebAppButton(miniAppUrl: string): boolean {
  if (!miniAppUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(miniAppUrl);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createMainMenu(miniAppUrl: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (canRenderWebAppButton(miniAppUrl)) {
    keyboard.webApp(messages.openStoreButton, miniAppUrl).row();
  }

  return keyboard
    .text('💰 Balance', 'balance')
    .text('📦 Orders', 'orders')
    .row()
    .text('💬 Support', 'support');
}

interface BotApiClient {
  get<T>(path: string): Promise<T | null>;
}

function createBotApiClient(apiUrl: string, apiSecret: string): BotApiClient {
  return {
    async get<T>(path: string): Promise<T | null> {
      if (!apiSecret) {
        return null;
      }
      try {
        const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
          headers: { 'x-bot-secret': apiSecret }
        });
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as T;
      } catch {
        return null;
      }
    }
  };
}

interface BalanceResponse {
  balance: string;
  currency: string;
}

interface OrderSummary {
  orderNumber: number;
  status: string;
  total: string;
  currency: string;
  createdAt: string;
}

interface OrdersResponse {
  orders: OrderSummary[];
}

function formatOrderList(orders: OrderSummary[]): string {
  if (orders.length === 0) {
    return '📦 You have no orders yet.\n\nOpen the store and make your first purchase!';
  }

  const lines = orders.map((order) => {
    const date = new Date(order.createdAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric'
    });
    return `#${order.orderNumber} · ${order.status} · ${order.total} ${order.currency} · ${date}`;
  });

  return `📦 Your recent orders:\n\n${lines.join('\n')}`;
}

export function createBot(token: string, miniAppUrl: string, apiUrl: string, apiSecret: string): Bot {
  const bot = new Bot(token);
  const menu = createMainMenu(miniAppUrl);
  const api = createBotApiClient(apiUrl, apiSecret);

  const showBalance = async (context: Context) => {
    const telegramId = context.from?.id;
    if (!telegramId) {
      await context.reply(messages.balanceFallback, { reply_markup: menu });
      return;
    }

    const balance = await api.get<BalanceResponse>(`/api/internal/bot/${telegramId}/balance`);
    if (!balance) {
      await context.reply(messages.balanceFallback, { reply_markup: menu });
      return;
    }

    await context.reply(
      `💰 Your balance:\n\n${balance.currency} ${Number(balance.balance).toFixed(2)}`,
      { reply_markup: menu }
    );
  };

  const showOrders = async (context: Context) => {
    const telegramId = context.from?.id;
    if (!telegramId) {
      await context.reply(messages.ordersFallback, { reply_markup: menu });
      return;
    }

    const result = await api.get<OrdersResponse>(`/api/internal/bot/${telegramId}/orders`);
    if (!result) {
      await context.reply(messages.ordersFallback, { reply_markup: menu });
      return;
    }

    await context.reply(formatOrderList(result.orders), { reply_markup: menu });
  };

  bot.command('start', async (context) => {
    await context.reply(messages.welcome, { reply_markup: menu });
  });

  bot.command('balance', showBalance);

  bot.command('orders', showOrders);

  bot.command('help', async (context) => {
    await context.reply(messages.help, { reply_markup: menu });
  });

  bot.command('support', async (context) => {
    await context.reply(messages.support, { reply_markup: menu });
  });

  bot.callbackQuery('balance', async (context) => {
    await context.answerCallbackQuery();
    await showBalance(context);
  });

  bot.callbackQuery('orders', async (context) => {
    await context.answerCallbackQuery();
    await showOrders(context);
  });

  bot.callbackQuery('support', async (context) => {
    await context.answerCallbackQuery();
    await context.reply(messages.support, { reply_markup: menu });
  });

  bot.catch((error) => {
    console.error(`Telegram update ${error.ctx.update.update_id} failed.`, error.error);
  });

  return bot;
}

export const botCommands = [
  { command: 'start', description: 'Open JR Digital license' },
  { command: 'balance', description: 'View your balance' },
  { command: 'orders', description: 'View your orders' },
  { command: 'help', description: 'Get help' },
  { command: 'support', description: 'Contact support' }
] as const;