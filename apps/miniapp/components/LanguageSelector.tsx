'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation, type Locale } from '@/lib/i18n';

const LANGUAGES: { locale: Locale; flag: string; label: string }[] = [
  { locale: 'en', flag: '🇬🇧', label: 'English' },
  { locale: 'km', flag: '🇰🇭', label: 'ខ្មែរ' },
];

export function LanguageSelector() {
  const { locale, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.locale === locale) ?? LANGUAGES[0]!;

  const handleSelect = useCallback(
    (newLocale: Locale) => {
      setLocale(newLocale);
      setOpen(false);
    },
    [setLocale]
  );

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-medium text-soft transition-luxury hover:bg-muted hover:text-primary"
        aria-label={t('lang.changeLanguage')}
      >
        <span className="text-base leading-none">{current.flag}</span>
        <span className="hidden sm:inline">{current.label}</span>
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M2.5 4.5L6 8l3.5-3.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-line/50 bg-card shadow-lg animate-scale-in">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.locale}
              type="button"
              onClick={() => handleSelect(lang.locale)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-default ${
                lang.locale === locale
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-ink hover:bg-muted'
              }`}
            >
              <span className="text-lg leading-none">{lang.flag}</span>
              <span>{lang.label}</span>
              {lang.locale === locale && (
                <svg viewBox="0 0 16 16" fill="currentColor" className="ml-auto h-3.5 w-3.5 text-primary">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
