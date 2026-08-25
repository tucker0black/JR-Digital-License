'use client';

import { useTranslation } from '@/lib/i18n';

interface TranslatedTextProps {
  k: string;
  params?: Record<string, string | number>;
  /** Rendered instead of the raw key when the translation is missing. */
  fallback?: string;
}

/**
 * Renders a string from the shared i18n system inside server components.
 * Reuses the existing useTranslation hook; no new i18n mechanism.
 */
export function TranslatedText({ k, params, fallback }: TranslatedTextProps) {
  const { t } = useTranslation();
  const text = t(k, params);
  return <>{text === k && fallback ? fallback : text}</>;
}
