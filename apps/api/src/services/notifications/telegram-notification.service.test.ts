import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { TelegramNotificationService } from './telegram-notification.service.js';

describe('TelegramNotificationService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const orderInfo = {
    orderNumber: 59,
    items: [{ productName: 'Gemini 18 Month', quantity: 1 }],
    total: '2.60',
    currency: 'USD'
  };

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    process.env.TELEGRAM_ADMIN_GROUP_ID = '-100123456789';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ADMIN_GROUP_ID;
  });

  it('sends the group NEW ORDER notification without private details', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '-100123456789');
    const result = await service.sendNewOrderNotification(orderInfo);

    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('api.telegram.org/bottest-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/sendMessage');
    const payload = JSON.parse(init.body);
    expect(payload.chat_id).toBe('-100123456789');
    expect(payload.text).toContain('#59');
    expect(payload.text).toContain('Gemini 18 Month');
    expect(payload.text).toContain('2.60');
  });

  it('sends a private delivery message to the customer chat with the order reference', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '-100123456789');
    const result = await service.sendOrderDeliveredMessage({ chatId: 123456789n, ...orderInfo });

    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('api.telegram.org');
    const payload = JSON.parse(init.body);
    expect(payload.chat_id).toBe('123456789');
    expect(payload.text).toContain('#59');
    expect(payload.text).toContain('Gemini 18 Month');
    expect(payload.text).toContain('2.60');
    expect(payload.text).not.toContain('license-key-');
    expect(payload.text).not.toContain('password');
  });

  it('returns false without sending when no bot token is configured', async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new TelegramNotificationService('', '-100123456789');
    const result = await service.sendOrderDeliveredMessage({ chatId: 123456789n, ...orderInfo });

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send group notifications when the admin group is not configured', async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '');
    const result = await service.sendNewOrderNotification(orderInfo);

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false and does not throw when Telegram is unreachable', async () => {
    fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '-100123456789');
    const result = await service.sendOrderDeliveredMessage({ chatId: 123456789n, ...orderInfo });

    expect(result).toBe(false);
  });

  it('returns false when Telegram responds with a non-OK status', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', fetchMock);

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '-100123456789');
    const result = await service.sendNewOrderNotification(orderInfo);

    expect(result).toBe(false);
  });

  it('sends the group notification to every active target subscribed to the event', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const prisma = {
      telegramNotificationTarget: {
        findMany: vi.fn().mockResolvedValue([
          { chatId: -100111111111n, eventTypes: ['NEW_PAID_ORDER'] },
          { chatId: -100222222222n, eventTypes: ['REFUND'] },
          { chatId: -100333333333n, eventTypes: [] }
        ])
      }
    } as unknown as PrismaClient;

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', prisma);
    const result = await service.sendNewOrderNotification(orderInfo);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const chatIds = fetchMock.mock.calls.map((call: unknown[]) => JSON.parse((call[1] as { body: string }).body).chat_id);
    expect(chatIds).toContain('-100111111111');
    expect(chatIds).toContain('-100333333333');
    expect(chatIds).not.toContain('-100222222222');
  });

  it('still sends to the legacy admin group when no database targets exist', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const prisma = {
      telegramNotificationTarget: { findMany: vi.fn().mockResolvedValue([]) }
    } as unknown as PrismaClient;

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '-100123456789', prisma);
    const result = await service.sendNewOrderNotification(orderInfo);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(payload.chat_id).toBe('-100123456789');
  });

  it('does not duplicate a chat that is both a target and the legacy admin group', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const prisma = {
      telegramNotificationTarget: {
        findMany: vi.fn().mockResolvedValue([{ chatId: -100123456789n, eventTypes: [] }])
      }
    } as unknown as PrismaClient;

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '-100123456789', prisma);
    const result = await service.sendNewOrderNotification(orderInfo);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a success result when the test message is delivered', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '');
    const result = await service.sendTestMessage('-100123456789');

    expect(result).toEqual({ success: true, error: null });
    const payload = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(payload.chat_id).toBe('-100123456789');
    expect(payload.text).toContain('JR Digital license');
  });

  it('returns the Telegram error without leaking the bot token', async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ ok: false, description: 'Bad Request: chat not found (bot test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA)' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '');
    const result = await service.sendTestMessage('-100123456789');

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });

  it('reports that the bot token is missing', async () => {
    const service = new TelegramNotificationService('', '');
    const result = await service.sendTestMessage('-100123456789');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });
});

describe('TelegramNotificationService customer notification localization', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const orderInfo = {
    orderNumber: 32,
    items: [{ productName: 'Gemini 18 Month', quantity: 1 }],
    total: '2.60',
    currency: 'USD'
  };

  /** Prisma stub whose User.language can change BETWEEN sends. */
  function makePrisma(languages: (string | null | Error)[]) {
    let call = 0;
    return {
      user: {
        findUnique: vi.fn().mockImplementation(() => {
          const value = languages[Math.min(call, languages.length - 1)];
          call += 1;
          if (value instanceof Error) return Promise.reject(value);
          return Promise.resolve(value === null ? null : { language: value });
        })
      },
      telegramNotificationTarget: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as unknown as PrismaClient;
  }

  function lastSentText(): string {
    const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, { body: string }];
    return JSON.parse(init.body).text as string;
  }

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('sends the digital delivery message in Khmer for a km customer (#32)', async () => {
    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', makePrisma(['km']));
    await service.sendOrderDeliveredMessage({ chatId: '6197878051', ...orderInfo });

    const text = lastSentText();
    expect(text).toContain('ការទូទាត់បានជោគជ័យ');
    expect(text).toContain('ការបញ្ជាទិញ: #32');
    expect(text).toContain('ផលិតផលរបស់អ្នកត្រូវបានប្រគល់ជូនរួចរាល់។');
    expect(text).not.toContain('Payment Successful');
    expect(text).not.toContain('🇬🇧');
  });

  it('sends the digital delivery message in English for an en customer (#32)', async () => {
    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', makePrisma(['en']));
    await service.sendOrderDeliveredMessage({ chatId: '6197878051', ...orderInfo });

    const text = lastSentText();
    expect(text).toContain('✅ Payment Successful');
    expect(text).toContain('Order: #32');
    expect(text).toContain('Your products have been delivered.');
    expect(text).toContain('Open your order in the Mini App to view your delivery.');
    expect(text).not.toContain('ការទូទាត់');
  });

  it('keeps dynamic values untranslated and hides private data in both languages', async () => {
    const kmService = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', makePrisma(['km']));
    await kmService.sendOrderDeliveredMessage({ chatId: '6197878051', ...orderInfo });
    const kmText = lastSentText();
    expect(kmText).toContain('#32');
    expect(kmText).toContain('Gemini 18 Month');
    expect(kmText).toContain('USD 2.60');
    expect(kmText).not.toContain('license-key-');
    expect(kmText).not.toContain('password');

    fetchMock.mockClear();
    const enService = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', makePrisma(['en']));
    await enService.sendOrderDeliveredMessage({ chatId: '6197878051', ...orderInfo });
    const enText = lastSentText();
    expect(enText).toContain('#32');
    expect(enText).toContain('Gemini 18 Month');
    expect(enText).toContain('USD 2.60');
  });

  it('localizes the hand-delivery completion message per saved language', async () => {
    const kmService = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', makePrisma(['km']));
    await kmService.sendHandDeliveryCompletedNotification({ chatId: '6197878051', ...orderInfo, items: [] });
    const kmText = lastSentText();
    expect(kmText).toContain('ការបញ្ជាទិញរបស់អ្នកត្រូវបានប្រគល់ជូនរួចរាល់។');
    expect(kmText).toContain('#32');
    expect(kmText).not.toContain('Your order has been delivered');

    fetchMock.mockClear();
    const enService = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', makePrisma(['en']));
    await enService.sendHandDeliveryCompletedNotification({ chatId: '6197878051', ...orderInfo, items: [] });
    const enText = lastSentText();
    expect(enText).toBe([
      '✅ Your order has been delivered.',
      '',
      'Order: #32',
      '',
      'Open your order in the Mini App to view your delivery.'
    ].join('\n'));
  });

  it('resolves language at SEND time: km customer switched to en gets English on the next async notification', async () => {
    const prisma = makePrisma(['km', 'en']);
    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', prisma);

    await service.sendHandDeliveryCompletedNotification({ chatId: '6197878051', ...orderInfo, items: [] });
    expect(lastSentText()).toContain('ការបញ្ជាទិញរបស់អ្នកត្រូវបានប្រគល់ជូនរួចរាល់។');

    await service.sendHandDeliveryCompletedNotification({ chatId: '6197878051', ...orderInfo, items: [] });
    expect(lastSentText()).toContain('✅ Your order has been delivered.');
    expect(lastSentText()).not.toContain('ការបញ្ជា');
  });

  it('resolves language at SEND time: en customer switched to km gets Khmer on the next async notification', async () => {
    const prisma = makePrisma(['en', 'km']);
    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', prisma);

    await service.sendOrderDeliveredMessage({ chatId: '6197878051', ...orderInfo });
    expect(lastSentText()).toContain('✅ Payment Successful');

    await service.sendOrderDeliveredMessage({ chatId: '6197878051', ...orderInfo });
    expect(lastSentText()).toContain('ការទូទាត់បានជោគជ័យ');
    expect(lastSentText()).not.toContain('Payment Successful');
  });

  it('falls back to the project default (km) without throwing when the lookup fails or is unknown', async () => {
    const failing = new TelegramNotificationService(
      'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '',
      makePrisma([new Error('db down')])
    );
    await failing.sendOrderDeliveredMessage({ chatId: '6197878051', ...orderInfo });
    expect(lastSentText()).toContain('ការទូទាត់បានជោគជ័យ');

    fetchMock.mockClear();
    const unknown = new TelegramNotificationService(
      'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '',
      makePrisma(['fr'])
    );
    await unknown.sendOrderDeliveredMessage({ chatId: '6197878051', ...orderInfo });
    expect(lastSentText()).toContain('ការទូទាត់បានជោគជ័យ');

    fetchMock.mockClear();
    const noUser = new TelegramNotificationService(
      'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '',
      makePrisma([null])
    );
    await noUser.sendOrderDeliveredMessage({ chatId: '6197878051', ...orderInfo });
    expect(lastSentText()).toContain('ការទូទាត់បានជោគជ័យ');
  });

  it('does not translate internal/admin group notifications', async () => {
    const service = new TelegramNotificationService(
      'test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '-100123456789',
      makePrisma(['km'])
    );
    await service.sendNewOrderNotification(orderInfo);

    const text = lastSentText();
    expect(text).toContain('🎉 NEW ORDER');
    expect(text).not.toContain('ការបញ្ជាទិញ');
  });

  it('never exposes provider/supplier/FazerCards details in customer messages', async () => {
    const service = new TelegramNotificationService('test-bot-token:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '', makePrisma(['en']));
    await service.sendOrderDeliveredMessage({
      ...orderInfo,
      items: [{ productName: 'FazerCards 1000 Diamonds', quantity: 2 }]
    });

    const text = lastSentText();
    expect(text).toContain('FazerCards 1000 Diamonds ×2');
    expect(text.toLowerCase()).not.toContain('provider');
    expect(text.toLowerCase()).not.toContain('supplier');
    expect(text.toLowerCase()).not.toContain('api key');
  });
});
