import { appName, normalizeSupportedLanguage, type SupportedLanguage } from '@jr/shared';
import { Bot, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import {
  defaultLanguage,
  localizedCommands,
  t,
  translateOrderStatus,
  type TranslationParams
} from './i18n/index.js';

export const CALLBACK_BALANCE = 'balance';
export const CALLBACK_ORDERS = 'orders';
export const CALLBACK_SUPPORT = 'support';
export const CALLBACK_CHANGE_LANGUAGE = 'change_language';
export const CALLBACK_LANGUAGE_BACK = 'language_back';
const CALLBACK_SET_LANGUAGE_PREFIX = 'set_language:';

export function setLanguageCallbackData(language: SupportedLanguage): string {
  return `${CALLBACK_SET_LANGUAGE_PREFIX}${language}`;
}

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

/**
 * Append the customer's saved language to the Mini App URL so it opens in the
 * same language as the bot (?lang=km|en). The base URL and all of its existing
 * parameters are preserved untouched.
 */
export function buildMiniAppUrl(
  miniAppUrl: string,
  language?: SupportedLanguage
): string {
  if (!language) {
    return miniAppUrl;
  }
  try {
    const parsedUrl = new URL(miniAppUrl);
    parsedUrl.searchParams.set('lang', language);
    return parsedUrl.toString();
  } catch {
    return miniAppUrl;
  }
}

/**
 * Main menu keyboard for the given language. Called without a language it
 * keeps the original English labels (backwards compatibility).
 */
export function createMainMenu(
  miniAppUrl: string,
  language: SupportedLanguage = 'en'
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (canRenderWebAppButton(miniAppUrl)) {
    keyboard.webApp(t(language, 'open_mini_app'), buildMiniAppUrl(miniAppUrl, language)).row();
  }

  return keyboard
    .text(t(language, 'balance_button'), CALLBACK_BALANCE)
    .text(t(language, 'orders_button'), CALLBACK_ORDERS)
    .row()
    .text(t(language, 'support_button'), CALLBACK_SUPPORT)
    .text(t(language, 'change_language_button'), CALLBACK_CHANGE_LANGUAGE);
}

/**
 * Language selection keyboard: 🇰🇭 Khmer / 🇬🇧 English.
 * The two option labels are intentionally identical in both languages (they
 * ARE the languages); every other label follows the customer's current
 * language. The back button appears when opened through "Change Language"
 * but not on the very first prompt.
 */
export function createLanguageKeyboard(
  includeBack: boolean,
  language: SupportedLanguage = 'km'
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(t('km', 'language_km'), setLanguageCallbackData('km'))
    .row()
    .text(t('en', 'language_en'), setLanguageCallbackData('en'));

  if (includeBack) {
    keyboard.row().text(t(language, 'back_button'), CALLBACK_LANGUAGE_BACK);
  }

  return keyboard;
}

interface BotApiClient {
  get<T>(path: string): Promise<T | null>;
  post<T>(path: string, body: unknown): Promise<T | null>;
}

function createBotApiClient(apiUrl: string, apiSecret: string): BotApiClient {
  async function request<T>(path: string, method: string, body?: unknown): Promise<T | null> {
    if (!apiSecret) {
      return null;
    }
    try {
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'x-bot-secret': apiSecret,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      if (!response.ok) {
        // Sanitized diagnostic: status + endpoint only. Never log secrets.
        console.warn(
          `[bot-api] ${method} ${path} -> ${response.status}; check BOT_SECRET parity and API reachability`
        );
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      console.warn(`[bot-api] ${method} ${path} failed (${errorClass}); is NEXT_PUBLIC_API_URL correct?`);
      return null;
    }
  }

  return {
    get<T>(path: string): Promise<T | null> {
      return request<T>(path, 'GET');
    },
    post<T>(path: string, body: unknown): Promise<T | null> {
      return request<T>(path, 'POST', body ?? {});
    }
  };
}

export interface BalanceResponse {
  balance: string;
  currency: string;
}

export interface OrderSummary {
  orderNumber: number;
  status: string;
  total: string;
  currency: string;
  createdAt: string;
}

interface OrdersResponse {
  orders: OrderSummary[];
}

interface LanguageResponse {
  language: string | null;
}

interface TelegramProfileInfo {
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}

export function formatBalanceMessage(
  balance: BalanceResponse,
  language: SupportedLanguage = 'en'
): string {
  const amount = `${balance.currency} ${Number(balance.balance).toFixed(2)}`;
  return t(language, 'balance_message', { amount });
}

export function formatOrderList(
  orders: OrderSummary[],
  language: SupportedLanguage = 'en'
): string {
  if (orders.length === 0) {
    return t(language, 'orders_empty');
  }

  const locale = language === 'km' ? 'km-KH' : 'en-US';
  const lines = orders.map((order) => {
    let date: string;
    try {
      date = new Date(order.createdAt).toLocaleString(locale, {
        month: 'short',
        day: 'numeric'
      });
    } catch {
      date = new Date(order.createdAt).toISOString().slice(0, 10);
    }
    const status = translateOrderStatus(language, order.status);
    return `#${order.orderNumber} · ${status} · ${order.total} ${order.currency} · ${date}`;
  });

  return t(language, 'orders_list', { list: lines.join('\n') });
}

export interface StartView {
  text: string;
  replyMarkup: InlineKeyboard;
  /** Present when the customer still needs to pick a language first. */
  pendingLanguageSelection: boolean;
}

/** Pure view model for /start — exported for tests. */
export function getStartView(language: SupportedLanguage | null): StartView {
  if (!language) {
    return {
      text: t(defaultLanguage, 'select_language'),
      replyMarkup: createLanguageKeyboard(false),
      pendingLanguageSelection: true
    };
  }
  return {
    text: t(language, 'welcome', { app: appName }),
    replyMarkup: createMainMenu('', language),
    pendingLanguageSelection: false
  };
}

export function createBot(token: string, miniAppUrl: string, apiUrl: string, apiSecret: string): Bot {
  const bot = new Bot(token);
  const api = createBotApiClient(apiUrl, apiSecret);

  /**
   * Last language seen for each Telegram user inside this bot process.
   * This is ONLY a resilience layer so an internal-API hiccup can never flip
   * a customer back to the wrong language mid-session. The persisted
   * PostgreSQL preference (User.language) is always the source of truth and
   * is re-read on every interaction.
   */
  const sessionLanguages = new Map<number, SupportedLanguage>();

  const paramsWithApp = (): TranslationParams => ({ app: appName });

  /**
   * THE single language resolver for every customer-facing handler.
   *
   * 1. Reads the user's persisted preference from the database (via the
   *    internal API) — never a stale menu context or previous message.
   * 2. Falls back to the last language selected/seen in this process when the
   *    lookup fails, so an API hiccup cannot leak English into a Khmer session.
   * 3. Defaults to Khmer ('km') for brand-new customers with no preference.
   *
   * Never creates users; read-only against the existing account record.
   */
  const getUserLanguage = async (context: Context): Promise<SupportedLanguage> => {
    const telegramId = context.from?.id;
    if (telegramId !== undefined) {
      const result = await api.get<LanguageResponse>(`/api/internal/bot/${telegramId}/language`);
      const saved = normalizeSupportedLanguage(result?.language);
      if (saved) {
        sessionLanguages.set(telegramId, saved);
        return saved;
      }
      const cached = sessionLanguages.get(telegramId);
      if (cached) {
        return cached;
      }
    }
    return defaultLanguage;
  };

  /**
   * Persisted preference only — null means "show the language selection".
   * The session cache counts as known here too: if the customer already picked
   * a language but the API is momentarily down, we must NOT ask them again.
   */
  const resolveSavedLanguage = async (context: Context): Promise<SupportedLanguage | null> => {
    const telegramId = context.from?.id;
    if (telegramId === undefined) {
      return null;
    }
    const result = await api.get<LanguageResponse>(`/api/internal/bot/${telegramId}/language`);
    const saved = normalizeSupportedLanguage(result?.language);
    if (saved) {
      sessionLanguages.set(telegramId, saved);
      return saved;
    }
    return sessionLanguages.get(telegramId) ?? null;
  };

  const showWelcomeMenu = async (context: Context, language: SupportedLanguage) => {
    await context.reply(t(language, 'welcome', paramsWithApp()), {
      reply_markup: createMainMenu(miniAppUrl, language)
    });
  };

  /** Localized language-selection screen (prompt + option labels + Back). */
  const showLanguageSelection = async (context: Context, includeBack: boolean) => {
    const language = await getUserLanguage(context);
    await context.reply(t(language, 'select_language'), {
      reply_markup: createLanguageKeyboard(includeBack, language)
    });
  };

  const saveLanguage = async (
    telegramId: number,
    language: SupportedLanguage,
    profile: TelegramProfileInfo | undefined
  ): Promise<void> => {
    await api.post(`/api/internal/bot/${telegramId}/language`, {
      language,
      firstName: profile?.firstName,
      lastName: profile?.lastName,
      username: profile?.username,
      languageCode: profile?.languageCode
    });
  };

  const showBalance = async (context: Context) => {
    const telegramId = context.from?.id;
    const language = await getUserLanguage(context);

    if (!telegramId) {
      await context.reply(t(language, 'balance_unavailable'), {
        reply_markup: createMainMenu(miniAppUrl, language)
      });
      return;
    }

    const balance = await api.get<BalanceResponse>(`/api/internal/bot/${telegramId}/balance`);
    if (!balance) {
      await context.reply(t(language, 'balance_unavailable'), {
        reply_markup: createMainMenu(miniAppUrl, language)
      });
      return;
    }

    await context.reply(formatBalanceMessage(balance, language), {
      reply_markup: createMainMenu(miniAppUrl, language)
    });
  };

  const showOrders = async (context: Context) => {
    const telegramId = context.from?.id;
    const language = await getUserLanguage(context);

    if (!telegramId) {
      await context.reply(t(language, 'orders_unavailable'), {
        reply_markup: createMainMenu(miniAppUrl, language)
      });
      return;
    }

    const result = await api.get<OrdersResponse>(`/api/internal/bot/${telegramId}/orders`);
    if (!result) {
      await context.reply(t(language, 'orders_unavailable'), {
        reply_markup: createMainMenu(miniAppUrl, language)
      });
      return;
    }

    await context.reply(formatOrderList(result.orders, language), {
      reply_markup: createMainMenu(miniAppUrl, language)
    });
  };

  bot.command('start', async (context) => {
    const saved = await resolveSavedLanguage(context);
    if (!saved) {
      await showLanguageSelection(context, false);
      return;
    }
    await showWelcomeMenu(context, saved);
  });

  bot.command('balance', showBalance);

  bot.command('orders', showOrders);

  bot.command('help', async (context) => {
    const language = await getUserLanguage(context);
    await context.reply(t(language, 'help', paramsWithApp()), {
      reply_markup: createMainMenu(miniAppUrl, language)
    });
  });

  bot.command('support', async (context) => {
    const language = await getUserLanguage(context);
    await context.reply(t(language, 'support', paramsWithApp()), {
      reply_markup: createMainMenu(miniAppUrl, language)
    });
  });

  bot.callbackQuery(CALLBACK_BALANCE, async (context) => {
    await context.answerCallbackQuery();
    await showBalance(context);
  });

  bot.callbackQuery(CALLBACK_ORDERS, async (context) => {
    await context.answerCallbackQuery();
    await showOrders(context);
  });

  bot.callbackQuery(CALLBACK_SUPPORT, async (context) => {
    const language = await getUserLanguage(context);
    await context.answerCallbackQuery();
    await context.reply(t(language, 'support', paramsWithApp()), {
      reply_markup: createMainMenu(miniAppUrl, language)
    });
  });

  bot.callbackQuery(CALLBACK_CHANGE_LANGUAGE, async (context) => {
    await context.answerCallbackQuery();
    await showLanguageSelection(context, true);
  });

  bot.callbackQuery(CALLBACK_LANGUAGE_BACK, async (context) => {
    await context.answerCallbackQuery();
    // Re-read the persisted preference so Back always returns to the CURRENT
    // language's main menu, even if it was changed from another device.
    const language = await getUserLanguage(context);
    await showWelcomeMenu(context, language);
  });

  bot.callbackQuery(/^set_language:(km|en)$/, async (context) => {
    const language = normalizeSupportedLanguage(context.match[1]) ?? defaultLanguage;
    await context.answerCallbackQuery({ text: t(language, 'language_changed') });

    const telegramId = context.from?.id;
    if (telegramId !== undefined) {
      // Remember immediately so every later button click in this session uses
      // the chosen language even while the save below is failing/retrying.
      sessionLanguages.set(telegramId, language);
      // Persisted on the existing account row (upsert by telegramId), so the
      // choice survives restarts. No duplicate accounts are ever created.
      try {
        await saveLanguage(telegramId, language, {
          firstName: context.from?.first_name,
          lastName: context.from?.last_name,
          username: context.from?.username,
          languageCode: context.from?.language_code
        });
      } catch (error) {
        console.error(`Failed to persist language ${language} for ${telegramId}.`, error);
      }
    }

    await showWelcomeMenu(context, language);
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

/** Khmer command descriptions registered alongside the English default. */
export const botCommandsKm = localizedCommands.km;
