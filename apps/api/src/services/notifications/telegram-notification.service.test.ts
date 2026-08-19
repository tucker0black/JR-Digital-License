import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
});
