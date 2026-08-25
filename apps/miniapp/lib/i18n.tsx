'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from '@/lib/locales/en';
import km from '@/lib/locales/km';

export type Locale = 'en' | 'km';

const STORAGE_KEY = 'jr-lang';

const localeModules: Record<Locale, Record<string, unknown>> = { en, km };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function resolveTranslation(
  translations: Record<string, unknown>,
  key: string,
  params?: Record<string, string | number>
): string {
  let value = getNestedValue(translations, key);
  if (value === undefined) {
    // fallback to English if key not found in current locale
    value = getNestedValue(en as Record<string, unknown>, key);
  }
  if (value === undefined) return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => {
    const param = params[name];
    return param !== undefined ? String(param) : `{${name}}`;
  });
}

/** Exported for tests. */
export function getUrlLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    // The Telegram bot appends ?lang=km|en to the Mini App URL so it opens in
    // the customer's saved bot language. Only read once on initial load — the
    // in-app language selector keeps working exactly as before.
    const param = new URLSearchParams(window.location.search).get('lang');
    if (param === 'en' || param === 'km') return param;
  } catch {
    // URL parsing unavailable
  }
  return null;
}

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'km') return saved;
  } catch {
    // localStorage may be unavailable
  }
  // Check Telegram language code
  try {
    const tg = (window as unknown as Record<string, unknown>).Telegram as Record<string, unknown> | undefined;
    const webApp = tg?.WebApp as Record<string, unknown> | undefined;
    const initDataUnsafe = webApp?.initDataUnsafe as Record<string, unknown> | undefined;
    const user = initDataUnsafe?.user as Record<string, unknown> | undefined;
    const lang = user?.language_code as string | undefined;
    if (lang?.startsWith('km')) return 'km';
  } catch {
    // Telegram SDK not available
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Initialize from storage on mount. A ?lang= parameter passed by the
  // Telegram bot takes priority on initial load and is remembered as the
  // saved preference for direct opens; the in-app selector still overrides
  // everything afterwards.
  useEffect(() => {
    const urlLocale = getUrlLocale();
    if (urlLocale) {
      try {
        localStorage.setItem(STORAGE_KEY, urlLocale);
      } catch {
        // ignore
      }
      setLocaleState(urlLocale);
      return;
    }
    setLocaleState(detectLocale());
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch {
      // ignore
    }
    // Update html lang attribute
    document.documentElement.lang = newLocale;
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      return resolveTranslation(localeModules[locale], key, params);
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // During SSR or outside provider, return English defaults
    return {
      locale: 'en' as Locale,
      setLocale: () => {},
      t: (key: string, params?: Record<string, string | number>) =>
        resolveTranslation(en, key, params),
    };
  }
  return ctx;
}
