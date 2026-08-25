import { describe, expect, it } from 'vitest';
import { appName } from '@jr/shared';
import { en } from './en.js';
import { km } from './km.js';
import { localizedCommands, t, translateOrderStatus } from './index.js';

describe('bot translation catalogs', () => {
  it('keeps the Khmer and English catalogs perfectly in sync', () => {
    expect(Object.keys(km).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      const value = km[key as keyof typeof en];
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it('never exposes supplier or provider details in any customer-facing string', () => {
    const serialized = JSON.stringify({ en, km }).toLowerCase();
    expect(serialized).not.toMatch(/fazercards/);
    expect(serialized).not.toContain('api.fzr.cards');
    expect(serialized).not.toContain('x-api-key');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('subscription');
    expect(serialized).not.toContain('supplier');
  });

  it('translates the core keys into Khmer and English', () => {
    expect(t('en', 'welcome', { app: appName })).toContain(`Welcome to ${appName}`);
    expect(t('km', 'welcome', { app: appName })).toContain('សូមស្វាគមន៍មកកាន់');
    expect(t('km', 'welcome', { app: appName })).toContain(appName);

    expect(t('en', 'select_language')).toContain('choose your language');
    expect(t('km', 'select_language')).toContain('សូមជ្រើសរើសភាសារបស់អ្នក');

    expect(t('en', 'open_mini_app')).toBe('📱 Open JR Digital License');
    expect(t('km', 'open_mini_app')).toBe('📱 បើក JR Digital License');

    expect(t('en', 'balance_button')).toBe('💰 Balance');
    expect(t('km', 'balance_button')).toBe('💰 សមតុល្យ');

    expect(t('en', 'orders_button')).toBe('📦 Orders');
    expect(t('km', 'orders_button')).toBe('📦 ការបញ្ជាទិញ');

    expect(t('en', 'support_button')).toBe('💬 Support');
    expect(t('km', 'support_button')).toBe('💬 ជំនួយ');

    expect(t('en', 'change_language_button')).toBe('🌐 Change Language');
    expect(t('km', 'change_language_button')).toBe('🌐 ប្តូរភាសា');

    expect(t('en', 'generic_error')).toBe('❌ Something went wrong. Please try again.');
    expect(t('km', 'generic_error')).toBe('❌ មានបញ្ហាកើតឡើង។ សូមព្យាយាមម្តងទៀត។');

    expect(t('en', 'language_km')).toBe('🇰🇭 ខ្មែរ');
    expect(t('km', 'language_en')).toBe('🇬🇧 English');
  });

  it('interpolates parameters without translating dynamic data', () => {
    expect(t('en', 'balance_message', { amount: 'USD 5.00' })).toBe(
      '💰 Your balance:\n\nUSD 5.00'
    );
    expect(t('km', 'balance_message', { amount: 'USD 5.00' })).toBe(
      '💰 សមតុល្យរបស់អ្នក៖\n\nUSD 5.00'
    );
    // Unknown parameters stay untouched instead of crashing.
    expect(t('en', 'balance_message')).toContain('{amount}');
  });

  it('keeps command names untranslated inside help text', () => {
    expect(t('km', 'help', { app: appName })).toContain('/balance');
    expect(t('km', 'help', { app: appName })).toContain('/orders');
    expect(t('km', 'help', { app: appName })).toContain('/support');
    expect(t('km', 'help', { app: appName })).toContain(appName);
  });

  it('translates every order status shown to customers', () => {
    const statuses = [
      'DRAFT',
      'PAYMENT_PENDING',
      'PAID',
      'PROCESSING',
      'FULFILLING',
      'COMPLETED',
      'CANCELLED',
      'EXPIRED',
      'DELIVERY_FAILED',
      'REFUNDED'
    ] as const;

    for (const status of statuses) {
      expect(translateOrderStatus('en', status)).not.toBe(status);
      expect(translateOrderStatus('km', status)).not.toBe(status);
      expect(translateOrderStatus('km', status)).toMatch(/[\u1780-\u17FF]/);
    }

    expect(translateOrderStatus('en', 'COMPLETED')).toBe('Completed');
    expect(translateOrderStatus('km', 'COMPLETED')).toBe('បានបញ្ចប់');
    expect(translateOrderStatus('km', 'REFUNDED')).toBe('បានបង្វិលសងប្រាក់');
  });

  it('falls back to the raw status for unknown future statuses', () => {
    expect(translateOrderStatus('km', 'SOME_FUTURE_STATUS')).toBe('SOME_FUTURE_STATUS');
  });

  it('uses the warning fallback texts for temporarily unavailable services', () => {
    expect(t('en', 'balance_unavailable')).toBe(
      '⚠️ Balance is temporarily unavailable. Please try again later.'
    );
    expect(t('km', 'balance_unavailable')).toBe(
      '⚠️ សមតុល្យមិនអាចប្រើបានជាបណ្តោះអាសន្នទេ។ សូមព្យាយាមម្តងទៀតនៅពេលក្រោយ។'
    );
    expect(t('en', 'orders_unavailable')).toBe(
      '⚠️ Orders are temporarily unavailable. Please try again later.'
    );
    expect(t('km', 'orders_unavailable')).toBe(
      '⚠️ ការបញ្ជាទិញមិនអាចប្រើបានជាបណ្តោះអាសន្នទេ។ សូមព្យាយាមម្តងទៀតនៅពេលក្រោយ។'
    );
    expect(t('km', 'back_button')).toBe('⬅️ ត្រឡប់ក្រោយ');
  });

  it('provides Khmer command descriptions alongside the English defaults', () => {
    expect(localizedCommands.en.map(({ command }) => command)).toEqual([
      'start',
      'balance',
      'orders',
      'help',
      'support'
    ]);
    for (const { description } of localizedCommands.km) {
      expect(description).not.toBe('');
    }
    // The Khmer descriptions must differ from English (actually localized).
    expect(localizedCommands.km[1]!.description).not.toBe(localizedCommands.en[1]!.description);
  });
});
