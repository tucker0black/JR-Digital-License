import { describe, expect, it } from 'vitest';
import {
  buildMiniAppUrl,
  createLanguageKeyboard,
  createMainMenu,
  formatBalanceMessage,
  formatOrderList,
  getStartView,
  isTelegramWebAppUrl,
  setLanguageCallbackData,
  type OrderSummary
} from './bot.js';

const MINIAPP_URL = 'https://store.example.com/miniapp';

function serialized(keyboard: { inline_keyboard: unknown }): string {
  return JSON.stringify(keyboard.inline_keyboard);
}

describe('main menu keyboards', () => {
  it('renders the English main menu with the language switch button', () => {
    const menu = JSON.stringify(createMainMenu(MINIAPP_URL, 'en').inline_keyboard);
    expect(menu).toContain('📱 Open JR Digital License');
    expect(menu).toContain('💰 Balance');
    expect(menu).toContain('📦 Orders');
    expect(menu).toContain('💬 Support');
    expect(menu).toContain('🌐 Change Language');
    expect(menu).toContain('"change_language"');
    expect(menu).toContain('"balance"');
    expect(menu).toContain('"orders"');
    expect(menu).toContain('"support"');
    expect(menu).not.toContain('ប្តូរភាសា');
  });

  it('renders the Khmer main menu with the language switch button', () => {
    const menu = JSON.stringify(createMainMenu(MINIAPP_URL, 'km').inline_keyboard);
    expect(menu).toContain('📱 បើក JR Digital License');
    expect(menu).toContain('💰 សមតុល្យ');
    expect(menu).toContain('📦 ការបញ្ជាទិញ');
    expect(menu).toContain('💬 ជំនួយ');
    expect(menu).toContain('🌐 ប្តូរភាសា');
    expect(menu).not.toContain('Change Language');
  });

  it('keeps the original English labels when called without a language (backwards compatible)', () => {
    const menu = createMainMenu('https://example.com');
    const menuJson = serialized(menu);
    expect(menuJson).toContain('Open JR Digital License');
    expect(menuJson).toContain('balance');
    expect(menuJson).toContain('orders');
    expect(menuJson).toContain('support');
    expect(menuJson).toContain('https://example.com');
  });

  it('still refuses web app buttons for non-http(s) URLs', () => {
    const menu = createMainMenu('ftp://example.com', 'km');
    expect(serialized(menu)).not.toContain('web_app');
  });
});

describe('language selection keyboard', () => {
  it('offers exactly 🇰🇭 Khmer and 🇬🇧 English on first /start', () => {
    const keyboard = JSON.stringify(createLanguageKeyboard(false).inline_keyboard);
    expect(keyboard).toContain('🇰🇭 ខ្មែរ');
    expect(keyboard).toContain('🇬🇧 English');
    expect(keyboard).toContain(setLanguageCallbackData('km'));
    expect(keyboard).toContain(setLanguageCallbackData('en'));
    expect(keyboard).not.toContain('"language_back"');
  });

  it('offers a back button when opened through Change Language', () => {
    const keyboard = JSON.stringify(createLanguageKeyboard(true).inline_keyboard);
    expect(keyboard).toContain('"language_back"');
  });
});

describe('buildMiniAppUrl', () => {
  it('appends the saved language for the Mini App deep link', () => {
    expect(buildMiniAppUrl(MINIAPP_URL, 'km')).toBe(`${MINIAPP_URL}?lang=km`);
    expect(buildMiniAppUrl(MINIAPP_URL, 'en')).toBe(`${MINIAPP_URL}?lang=en`);
  });

  it('preserves path and existing query parameters', () => {
    expect(buildMiniAppUrl('https://store.example.com/miniapp?ref=bot', 'km')).toBe(
      'https://store.example.com/miniapp?ref=bot&lang=km'
    );
  });

  it('replaces a previous lang parameter instead of duplicating it', () => {
    expect(buildMiniAppUrl(`${MINIAPP_URL}?lang=en`, 'km')).toBe(`${MINIAPP_URL}?lang=km`);
  });

  it('returns the original URL unchanged when no language is given', () => {
    expect(buildMiniAppUrl(MINIAPP_URL)).toBe(MINIAPP_URL);
  });

  it('falls back to the original URL when parsing fails', () => {
    expect(buildMiniAppUrl('::invalid::', 'km')).toBe('::invalid::');
  });
});

describe('/start view', () => {
  it('asks a new customer to choose a language before anything else', () => {
    const view = getStartView(null);
    expect(view.pendingLanguageSelection).toBe(true);
    expect(view.text).toContain('សូមជ្រើសរើសភាសារបស់អ្នក');
    expect(serialized(view.replyMarkup)).toContain('🇰🇭 ខ្មែរ');
    expect(serialized(view.replyMarkup)).toContain('🇬🇧 English');
  });

  it('shows the Khmer welcome menu once Khmer is saved', () => {
    const view = getStartView('km');
    expect(view.pendingLanguageSelection).toBe(false);
    expect(view.text).toContain('👋 សូមស្វាគមន៍មកកាន់ JR Digital license!');
    expect(view.text).toContain('ទិញផលិតផលឌីជីថល');
    expect(serialized(view.replyMarkup)).toContain('🌐 ប្តូរភាសា');
  });

  it('shows the English welcome menu once English is saved', () => {
    const view = getStartView('en');
    expect(view.pendingLanguageSelection).toBe(false);
    expect(view.text).toContain('👋 Welcome to JR Digital license!');
    expect(serialized(view.replyMarkup)).toContain('🌐 Change Language');
  });
});

describe('balance and order messages', () => {
  it('translates the balance message and keeps the amount untouched', () => {
    const balance = { balance: '5.00', currency: 'USD' };
    expect(formatBalanceMessage(balance, 'en')).toBe('💰 Your balance:\n\nUSD 5.00');
    expect(formatBalanceMessage(balance, 'km')).toBe('💰 សមតុល្យរបស់អ្នក៖\n\nUSD 5.00');
  });

  it('translates the empty orders message', () => {
    expect(formatOrderList([], 'en')).toContain('You have no orders yet');
    expect(formatOrderList([], 'km')).toContain('អ្នកមិនទាន់មានការបញ្ជាទិញទេ');
  });

  it('translates order statuses while preserving all order data', () => {
    const orders: OrderSummary[] = [
      {
        orderNumber: 59,
        status: 'COMPLETED',
        total: '2.60',
        currency: 'USD',
        createdAt: '2026-08-25T03:00:00.000Z'
      }
    ];
    const english = formatOrderList(orders, 'en');
    expect(english).toContain('#59');
    expect(english).toContain('Completed');
    expect(english).toContain('2.60 USD');

    const khmer = formatOrderList(orders, 'km');
    expect(khmer).toContain('#59');
    expect(khmer).toContain('បានបញ្ចប់');
    expect(khmer).toContain('2.60 USD');
    expect(khmer).not.toContain('Completed');
  });

  it('keeps unknown statuses visible instead of crashing', () => {
    const orders: OrderSummary[] = [
      {
        orderNumber: 1,
        status: 'FUTURE_STATUS',
        total: '1.00',
        currency: 'USD',
        createdAt: '2026-08-25T03:00:00.000Z'
      }
    ];
    expect(formatOrderList(orders, 'km')).toContain('FUTURE_STATUS');
  });
});

describe('existing URL safety helper', () => {
  it('is unchanged', () => {
    expect(isTelegramWebAppUrl('https://store.example.com')).toBe(true);
    expect(isTelegramWebAppUrl('http://store.example.com')).toBe(false);
    expect(isTelegramWebAppUrl('https://localhost:3000')).toBe(false);
  });
});
