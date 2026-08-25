import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUrlLocale } from './i18n';

function stubLocation(search: string): void {
  vi.stubGlobal('window', { location: { search } });
}

describe('getUrlLocale (Telegram bot ?lang= deep link)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts the bot-passed Khmer language', () => {
    stubLocation('?lang=km');
    expect(getUrlLocale()).toBe('km');
  });

  it('accepts the bot-passed English language', () => {
    stubLocation('?lang=en');
    expect(getUrlLocale()).toBe('en');
  });

  it('keeps other query parameters intact', () => {
    stubLocation('?ref=bot&lang=km&x=1');
    expect(getUrlLocale()).toBe('km');
  });

  it('ignores unsupported languages', () => {
    stubLocation('?lang=fr');
    expect(getUrlLocale()).toBeNull();
  });

  it('returns null when no lang parameter is present', () => {
    stubLocation('');
    expect(getUrlLocale()).toBeNull();
  });
});
