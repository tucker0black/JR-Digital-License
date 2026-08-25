import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Transformer } from 'grammy';
import type { Update } from 'grammy/types';
import { createBot } from './bot.js';

/**
 * End-to-end regression tests for the REAL button/callback flow.
 *
 * These tests reproduce the production bug that unit tests missed: selecting
 * Khmer rendered a Khmer menu, but clicking the Khmer buttons produced English
 * responses whenever the internal-API language lookup failed.
 *
 * Strategy:
 * - A real local HTTP server fakes the internal API (language/balance/orders),
 *   backed by an in-memory "database" that survives API restarts (like
 *   PostgreSQL does).
 * - A grammY API transformer intercepts every outbound Telegram call so
 *   bot.handleUpdate() runs the REAL handlers end-to-end without network.
 */

const MINIAPP_URL = 'https://miniapp.example.com';
const BOT_SECRET = 'test-bot-secret';
const BALANCE_AMOUNT = '1857.04';

interface TestUser {
  id: number;
  first_name: string;
  username: string;
  language_code: string;
}

const JIM: TestUser = { id: 7001, first_name: 'Jim', username: 'jimrotha', language_code: 'en' };

// ---------------------------------------------------------------------------
// Fake internal API
// ---------------------------------------------------------------------------

function createFakeInternalApi() {
  const users = new Map<number, { language: string | null }>();
  const state = { failAll: false };
  let server: http.Server | null = null;
  let baseUrl = '';

  async function listen(): Promise<string> {
    server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://localhost');
      const match = parsed.pathname.match(/^\/api\/internal\/bot\/(\d+)\/(language|balance|orders)$/);
      if (!match || state.failAll) {
        res.statusCode = state.failAll ? 500 : 404;
        res.end();
        return;
      }
      const telegramId = Number(match[1]);
      const resource = match[2] as 'language' | 'balance' | 'orders';
      const json = (body: unknown): void => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };

      if (resource === 'language') {
        if (req.method === 'GET') {
          const record = users.get(telegramId);
          if (!record) {
            res.statusCode = 404;
            res.end();
            return;
          }
          json({ language: record.language });
          return;
        }
        // POST: upsert into the single account row keyed by telegramId.
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const payload = JSON.parse(body || '{}') as { language?: string };
          const existing = users.get(telegramId) ?? { language: null };
          existing.language = payload.language ?? null;
          users.set(telegramId, existing);
          json({ language: existing.language });
        });
        return;
      }

      if (!users.has(telegramId)) {
        res.statusCode = 404;
        res.end();
        return;
      }

      if (resource === 'balance') {
        json({ balance: BALANCE_AMOUNT, currency: 'USD' });
        return;
      }

      json({
        orders: [
          {
            orderNumber: 59,
            status: 'COMPLETED',
            total: '2.60',
            currency: 'USD',
            createdAt: '2026-08-20T03:00:00.000Z'
          }
        ]
      });
    });

    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    return baseUrl;
  }

  return {
    users,
    state,
    listen,
    /** Simulate restarting the API container: new socket, SAME database. */
    async restart(): Promise<string> {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      return listen();
    },
    close(): void {
      server?.close();
    },
    get url(): string {
      return baseUrl;
    }
  };
}

// ---------------------------------------------------------------------------
// Telegram outbound-call interception
// ---------------------------------------------------------------------------

interface SentMessagePayload {
  text: string;
  replyMarkup: unknown;
}

function interceptTelegram(bot: Bot): { sent: SentMessagePayload[] } {
  const sent: SentMessagePayload[] = [];
  const transformer: Transformer = async (_previous, method, payload) => {
    if (method === 'sendMessage') {
      const p = payload as unknown as { text?: string; reply_markup?: unknown; chat_id?: unknown };
      sent.push({ text: String(p.text ?? ''), replyMarkup: p.reply_markup });
      return {
        ok: true,
        result: {
          message_id: sent.length + 1000,
          date: 1,
          chat: { id: p.chat_id, type: 'private' }
        }
      } as never;
    }
    if (method === 'getMe') {
      return {
        ok: true,
        result: { id: 42, is_bot: true, first_name: 'JR Test', username: 'jr_test_bot' }
      } as never;
    }
    // answerCallbackQuery, setMyCommands, setChatMenuButton, ...
    return { ok: true, result: true } as never;
  };
  bot.api.config.use(transformer);
  return { sent };
}

// ---------------------------------------------------------------------------
// Telegram update builders
// ---------------------------------------------------------------------------

// Real Telegram always attaches this entity to /commands; grammy 1.45+ requires
// it for command routing, so synthetic updates must include it too.
const START_COMMAND_ENTITIES = [{ offset: 0, length: 6, type: 'bot_command' as const }];

function chatOf(from: TestUser): { id: number; type: 'private'; first_name: string } {
  return { id: from.id, type: 'private', first_name: from.first_name };
}

function startUpdate(updateId: number, from: TestUser): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: from as never,
      chat: chatOf(from),
      date: Math.floor(Date.now() / 1000),
      text: '/start',
      entities: START_COMMAND_ENTITIES
    }
  } as unknown as Update;
}

function callbackUpdate(updateId: number, data: string, from: TestUser): Update {
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      from: from as never,
      data,
      chat_instance: 'test',
      message: {
        message_id: updateId,
        from: from as never,
        chat: chatOf(from),
        date: Math.floor(Date.now() / 1000)
      }
    }
  } as unknown as Update;
}

async function dispatch(
  bot: Bot,
  sent: SentMessagePayload[],
  make: (id: number) => Update
): Promise<SentMessagePayload> {
  const countBefore = sent.length;
  await bot.handleUpdate(make(++updateCounter));
  const latest = sent[countBefore];
  expect(latest).toBeTruthy();
  return latest!;
}

let updateCounter = 100;

// ---------------------------------------------------------------------------
// Shared harness
// ---------------------------------------------------------------------------

const fakeApi = createFakeInternalApi();
let bot: Bot;
let sent: SentMessagePayload[];

async function press(data: string, from: TestUser = JIM): Promise<SentMessagePayload> {
  return dispatch(bot, sent, (id) => callbackUpdate(id, data, from));
}

async function sendStart(from: TestUser = JIM): Promise<SentMessagePayload> {
  return dispatch(bot, sent, (id) => startUpdate(id, from));
}

beforeAll(async () => {
  await fakeApi.listen();
  bot = createBot('test-token', MINIAPP_URL, fakeApi.url, BOT_SECRET);
  ({ sent } = interceptTelegram(bot));
  await bot.init();
});

afterAll(() => {
  fakeApi.close();
});

beforeEach(() => {
  fakeApi.state.failAll = false;
});

// ---------------------------------------------------------------------------
// THE reported bug: SELECT KHMER -> EVERY BUTTON RESPONDS IN KHMER
// ---------------------------------------------------------------------------

describe('Khmer session: every button responds in Khmer', () => {
  it('new customer gets the language selection, selects Khmer, menu becomes Khmer', async () => {
    expect(fakeApi.users.has(JIM.id)).toBe(false);

    const prompt = await sendStart();
    expect(prompt.text).toBe('🌐 សូមជ្រើសរើសភាសារបស់អ្នក៖');
    const promptMarkup = JSON.stringify(prompt.replyMarkup);
    expect(promptMarkup).toContain('🇰🇭 ខ្មែរ');
    expect(promptMarkup).toContain('🇬🇧 English');

    const menu = await press('set_language:km');
    expect(menu.text).toContain('👋 សូមស្វាគមន៍មកកាន់ JR Digital license!');
    const markup = JSON.stringify(menu.replyMarkup);
    expect(markup).toContain('📱 បើក JR Digital License');
    expect(markup).toContain('💰 សមតុល្យ');
    expect(markup).toContain('📦 ការបញ្ជាទិញ');
    expect(markup).toContain('💬 ជំនួយ');
    expect(markup).toContain('🌐 ប្តូរភាសា');

    // The choice was persisted on the customer's account record.
    expect(fakeApi.users.get(JIM.id)?.language).toBe('km');
  });

  it('💰 Balance answers in Khmer with the real amount', async () => {
    const reply = await press('balance');
    expect(reply.text).toBe(`💰 សមតុល្យរបស់អ្នក៖\n\nUSD ${BALANCE_AMOUNT}`);
    expect(JSON.stringify(reply.replyMarkup)).toContain('🌐 ប្តូរភាសា');
  });

  it('/balance command answers in Khmer too', async () => {
    const reply = await dispatch(bot, sent, (id) => ({
      update_id: id,
      message: {
        message_id: id,
        from: JIM as never,
        chat: chatOf(JIM),
        date: Math.floor(Date.now() / 1000),
        text: '/balance',
        entities: [{ offset: 0, length: 8, type: 'bot_command' }]
      }
    }) as unknown as Update);
    expect(reply.text).toBe(`💰 សមតុល្យរបស់អ្នក៖\n\nUSD ${BALANCE_AMOUNT}`);
  });

  it('📦 Orders answers in Khmer with translated status and untouched data', async () => {
    const reply = await press('orders');
    expect(reply.text).toContain('📦 ការបញ្ជាទិញថ្មីៗរបស់អ្នក៖');
    expect(reply.text).toContain('#59');
    expect(reply.text).toContain('បានបញ្ចប់');
    expect(reply.text).toContain('2.60 USD');
    expect(reply.text).not.toContain('Completed');
    expect(reply.text).not.toContain('Your recent orders');
  });

  it('💬 Support answers with the Khmer support message', async () => {
    const reply = await press('support');
    expect(reply.text).toContain('💬 ត្រូវការជំនួយ?');
    expect(reply.text).toContain('ផ្នែក «ជំនួយ»');
    expect(reply.text).not.toContain('Need help?');
  });

  it('🌐 Change Language shows the Khmer selection screen with Khmer Back button', async () => {
    const reply = await press('change_language');
    expect(reply.text).toBe('🌐 សូមជ្រើសរើសភាសារបស់អ្នក៖');
    const markup = JSON.stringify(reply.replyMarkup);
    expect(markup).toContain('🇰🇭 ខ្មែរ');
    expect(markup).toContain('🇬🇧 English');
    expect(markup).toContain('⬅️ ត្រឡប់ក្រោយ');
    expect(markup).toContain('"language_back"');
  });

  it('⬅️ Back returns to the Khmer main menu', async () => {
    const reply = await press('language_back');
    expect(reply.text).toContain('👋 សូមស្វាគមន៍មកកាន់ JR Digital license!');
    expect(JSON.stringify(reply.replyMarkup)).toContain('💰 សមតុល្យ');
  });

  it('📱 Mini App deep link preserves the Khmer language parameter', async () => {
    const reply = await press('support');
    // URL normalization may add a trailing slash before the query string.
    expect(JSON.stringify(reply.replyMarkup)).toContain('lang=km');
  });
});

describe('English session: switch km -> en, every button responds in English', () => {
  it('switching to English re-renders the main menu in English', async () => {
    const menu = await press('set_language:en');
    expect(menu.text).toContain('👋 Welcome to JR Digital license!');
    const markup = JSON.stringify(menu.replyMarkup);
    expect(markup).toContain('📱 Open JR Digital License');
    expect(markup).toContain('💰 Balance');
    expect(markup).toContain('📦 Orders');
    expect(markup).toContain('💬 Support');
    expect(markup).toContain('🌐 Change Language');
    expect(markup).not.toContain('សមតុល្យ');
    expect(fakeApi.users.get(JIM.id)?.language).toBe('en');
  });

  it('💰 Balance now answers in English', async () => {
    const reply = await press('balance');
    expect(reply.text).toBe(`💰 Your balance:\n\nUSD ${BALANCE_AMOUNT}`);
  });

  it('📦 Orders now answers in English', async () => {
    const reply = await press('orders');
    expect(reply.text).toContain('📦 Your recent orders:');
    expect(reply.text).toContain('Completed');
    expect(reply.text).not.toContain('បានបញ្ចប់');
  });

  it('💬 Support now answers in English', async () => {
    const reply = await press('support');
    expect(reply.text).toContain('💬 Need help?');
    expect(reply.text).toContain('Support section');
    expect(reply.text).not.toContain('ត្រូវការជំនួយ');
  });

  it('🌐 Change Language now shows the English selection screen', async () => {
    const reply = await press('change_language');
    expect(reply.text).toBe('🌐 Please choose your language:');
    const markup = JSON.stringify(reply.replyMarkup);
    expect(markup).toContain('⬅️ Back');
    expect(markup).not.toContain('ត្រឡប់');
  });

  it('📱 Mini App deep link switched to the English language parameter', async () => {
    const reply = await press('support');
    expect(JSON.stringify(reply.replyMarkup)).toContain('lang=en');
  });
});

describe('switching back en -> km keeps every response Khmer', () => {
  it('full round-trip ends fully Khmer again', async () => {
    await press('set_language:km');
    const balanceReply = await press('balance');
    expect(balanceReply.text).toContain('សមតុល្យរបស់អ្នក');
    const supportReply = await press('support');
    expect(supportReply.text).toContain('💬 ត្រូវការជំនួយ?');
    const screen = await press('change_language');
    expect(screen.text).toBe('🌐 សូមជ្រើសរើសភាសារបស់អ្នក៖');
    expect(fakeApi.users.get(JIM.id)?.language).toBe('km');
  });
});

describe('API outage resilience (the exact production failure mode)', () => {
  it('Khmer user still receives Khmer responses while the API is down — never English', async () => {
    fakeApi.state.failAll = true;

    const balanceReply = await press('balance');
    expect(balanceReply.text).toBe(
      '⚠️ សមតុល្យមិនអាចប្រើបានជាបណ្តោះអាសន្នទេ។ សូមព្យាយាមម្តងទៀតនៅពេលក្រោយ។'
    );
    expect(balanceReply.text).not.toContain('Balance is temporarily unavailable');

    const ordersReply = await press('orders');
    expect(ordersReply.text).toBe(
      '⚠️ ការបញ្ជាទិញមិនអាចប្រើបានជាបណ្តោះអាសន្នទេ។ សូមព្យាយាមម្តងទៀតនៅពេលក្រោយ។'
    );

    const supportReply = await press('support');
    expect(supportReply.text).toContain('💬 ត្រូវការជំនួយ?');

    const languageScreen = await press('change_language');
    expect(languageScreen.text).toBe('🌐 សូមជ្រើសរើសភាសារបស់អ្នក៖');

    // No supplier/API internals may ever leak through a fallback path.
    for (const reply of [balanceReply, ordersReply]) {
      expect(reply.text).not.toMatch(/fazercards|fzr\.cards|x-api-key|500|ECONNREFUSED/i);
    }

    // A brand-new customer during an outage defaults to Khmer, not English.
    const newcomer: TestUser = { id: 8001, first_name: 'New', username: 'new_user', language_code: 'fr' };
    const prompt = await sendStart(newcomer);
    expect(prompt.text).toBe('🌐 សូមជ្រើសរើសភាសារបស់អ្នក៖');
  });
});

describe('restart persistence', () => {
  it('bot restart: a NEW bot process still serves the saved language', async () => {
    const bot2 = createBot('test-token', MINIAPP_URL, fakeApi.url, BOT_SECRET);
    const stub2 = interceptTelegram(bot2);
    await bot2.init();

    // /start goes straight to the Khmer welcome menu — no re-prompt.
    await bot2.handleUpdate(startUpdate(++updateCounter, JIM));
    const menu = stub2.sent.at(-1)!;
    expect(menu.text).toContain('👋 សូមស្វាគមន៍មកកាន់ JR Digital license!');
    expect(JSON.stringify(menu.replyMarkup)).toContain('💰 សមតុល្យ');

    // Buttons work in Khmer in the new process too.
    const countBefore = stub2.sent.length;
    await bot2.handleUpdate(callbackUpdate(++updateCounter, 'balance', JIM));
    expect(stub2.sent[countBefore]!.text).toBe(`💰 សមតុល្យរបស់អ្នក៖\n\nUSD ${BALANCE_AMOUNT}`);
  });

  it('API restart: same database, preference still drives responses', async () => {
    const previousUrl = fakeApi.url;
    const newUrl = await fakeApi.restart();
    expect(newUrl).not.toBe(previousUrl);

    const bot3 = createBot('test-token', MINIAPP_URL, newUrl, BOT_SECRET);
    const stub3 = interceptTelegram(bot3);
    await bot3.init();

    await bot3.handleUpdate(startUpdate(++updateCounter, JIM));
    const menu = stub3.sent.at(-1)!;
    expect(menu.text).toContain('សូមស្វាគមន៍មកកាន់');
    expect(JSON.stringify(menu.replyMarkup)).toContain('?lang=km');
  });
});
