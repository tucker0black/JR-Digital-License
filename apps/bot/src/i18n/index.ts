import { defaultLanguage, type SupportedLanguage } from '@jr/shared';
import { en, type TranslationKey } from './en.js';
import { km } from './km.js';

export { defaultLanguage };
export type { SupportedLanguage, TranslationKey };

const catalogs: Record<SupportedLanguage, Record<TranslationKey, string>> = { en, km };

export interface TranslationParams {
  [key: string]: string | number;
}

/**
 * Resolve a translation key in the requested language.
 *
 * Dynamic data (amounts, order IDs, URLs, product names...) is never
 * translated — it is injected through `params` placeholders like {app}.
 * An unknown key falls back to the key itself so a missing translation can
 * never crash a customer interaction.
 */
export function t(
  language: SupportedLanguage,
  key: TranslationKey,
  params?: TranslationParams
): string {
  const template = catalogs[language][key] ?? catalogs[defaultLanguage][key] ?? key;
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Map an arbitrary DB/API status string to its translated label. */
export function translateOrderStatus(
  language: SupportedLanguage,
  status: string
): string {
  const key = `status_${status.toLowerCase()}` as TranslationKey;
  const template = catalogs[language][key];
  // Unknown/new statuses fall back to the raw value so no information is lost.
  return template ?? status;
}

/** Localized /command descriptions for Telegram's command menu. */
export const localizedCommands: Record<SupportedLanguage, { command: string; description: string }[]> = {
  en: [
    { command: 'start', description: en.cmd_start },
    { command: 'balance', description: en.cmd_balance },
    { command: 'orders', description: en.cmd_orders },
    { command: 'help', description: en.cmd_help },
    { command: 'support', description: en.cmd_support }
  ],
  km: [
    { command: 'start', description: km.cmd_start },
    { command: 'balance', description: km.cmd_balance },
    { command: 'orders', description: km.cmd_orders },
    { command: 'help', description: km.cmd_help },
    { command: 'support', description: km.cmd_support }
  ]
};
