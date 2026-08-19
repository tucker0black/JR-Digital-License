import { describe, expect, it } from 'vitest';
import { botCommands, createMainMenu } from './bot.js';
import { loadBotConfig } from './config.js';

describe('Telegram bot configuration', () => {
  it('requires a token without revealing it', () => {
    expect(() => loadBotConfig({ APP_URL: 'https://example.com' })).toThrow(
      'TELEGRAM_BOT_TOKEN must be configured'
    );
  });

  it('accepts the token only from its environment configuration', () => {
    expect(
      loadBotConfig({
        TELEGRAM_BOT_TOKEN: 'test-token',
        APP_URL: 'https://example.com/miniapp'
      })
    ).toEqual({
      token: 'test-token',
      miniAppUrl: 'https://example.com/miniapp',
      apiUrl: 'http://localhost:4000',
      apiSecret: ''
    });
  });

  it('uses the internal API URL and secret from its environment configuration', () => {
    expect(
      loadBotConfig({
        TELEGRAM_BOT_TOKEN: 'test-token',
        APP_URL: 'https://example.com/miniapp',
        NEXT_PUBLIC_API_URL: 'https://api.example.com',
        BOT_SECRET: 'test-secret'
      })
    ).toEqual({
      token: 'test-token',
      miniAppUrl: 'https://example.com/miniapp',
      apiUrl: 'https://api.example.com',
      apiSecret: 'test-secret'
    });
  });

  it('prefers MINIAPP_URL over APP_URL', () => {
    expect(
      loadBotConfig({
        TELEGRAM_BOT_TOKEN: 'test-token',
        APP_URL: 'https://example.com/app',
        MINIAPP_URL: 'http://localhost:3000'
      })
    ).toEqual({
      token: 'test-token',
      miniAppUrl: 'http://localhost:3000/',
      apiUrl: 'http://localhost:4000',
      apiSecret: ''
    });
  });
});

describe('Telegram bot menu', () => {
  it('exposes the required commands and Mini App launch button', () => {
    expect(botCommands.map(({ command }) => command)).toEqual([
      'start',
      'balance',
      'orders',
      'help',
      'support'
    ]);
    expect(JSON.stringify(createMainMenu('https://example.com').inline_keyboard)).toContain(
      'https://example.com'
    );
  });

  it('includes the Telegram Web App button for localhost (local testing)', () => {
    const localMenu = createMainMenu('http://localhost:3000/');
    const serializedMenu = JSON.stringify(localMenu.inline_keyboard);

    expect(serializedMenu).toContain('http://localhost:3000/');
    expect(serializedMenu).toContain('Open JR Digital License');
    expect(serializedMenu).toContain('balance');
    expect(serializedMenu).toContain('orders');
    expect(serializedMenu).toContain('support');
  });

  it('includes the Telegram Web App button for 127.0.0.1', () => {
    const localMenu = createMainMenu('http://127.0.0.1:3000/');
    const serializedMenu = JSON.stringify(localMenu.inline_keyboard);

    expect(serializedMenu).toContain('127.0.0.1');
    expect(serializedMenu).toContain('Open JR Digital License');
    expect(serializedMenu).toContain('balance');
    expect(serializedMenu).toContain('orders');
    expect(serializedMenu).toContain('support');
  });

  it('includes the Telegram Web App button for [::1]', () => {
    const localMenu = createMainMenu('http://[::1]:3000/');
    const serializedMenu = JSON.stringify(localMenu.inline_keyboard);

    expect(serializedMenu).toContain('[::1]');
    expect(serializedMenu).toContain('Open JR Digital License');
    expect(serializedMenu).toContain('balance');
    expect(serializedMenu).toContain('orders');
    expect(serializedMenu).toContain('support');
  });

  it('includes the Telegram Web App button for valid HTTPS URLs like Cloudflare tunnels', () => {
    const cloudflareMenu = createMainMenu('https://henderson-divisions-dust-benjamin.trycloudflare.com/');
    const serializedMenu = JSON.stringify(cloudflareMenu.inline_keyboard);

    expect(serializedMenu).toContain('henderson-divisions-dust-benjamin.trycloudflare.com');
    expect(serializedMenu).toContain('Open JR Digital License');
    expect(serializedMenu).toContain('balance');
    expect(serializedMenu).toContain('orders');
    expect(serializedMenu).toContain('support');
  });
});
