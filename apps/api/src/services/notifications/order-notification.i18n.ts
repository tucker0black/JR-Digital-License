import { defaultLanguage, type SupportedLanguage } from '@jr/shared';

/**
 * Customer-facing order notification translations for asynchronous Telegram
 * messages sent by the API (delivery completions, hand-delivery completions).
 *
 * This mirrors the Telegram bot's i18n system (apps/bot/src/i18n):
 *   - catalogs keyed by SupportedLanguage
 *   - {placeholder} params for dynamic values (order numbers, amounts,
 *     product names) which are NEVER translated
 *   - unknown-key fallback so a missing translation cannot crash a send
 *
 * The customer's persisted language (User.language in PostgreSQL) is the
 * source of truth, resolved at the moment the notification is sent.
 */
const catalogs: Record<SupportedLanguage, Record<OrderNotificationKey, string>> = {
  en: {
    payment_successful: '✅ Payment Successful',
    order_label: 'Order',
    product_label: '📦 Product:',
    total_label: '💰 Total:',
    order_delivered: '✅ Your order has been delivered.',
    order_products_delivered: 'Your products have been delivered.',
    open_order_in_mini_app: 'Open your order in the Mini App to view your delivery.'
  },
  km: {
    payment_successful: '✅ ការទូទាត់បានជោគជ័យ',
    order_label: 'ការបញ្ជាទិញ',
    product_label: '📦 ផលិតផល៖',
    total_label: '💰 សរុប៖',
    order_delivered: '✅ ការបញ្ជាទិញរបស់អ្នកត្រូវបានប្រគល់ជូនរួចរាល់។',
    order_products_delivered: 'ផលិតផលរបស់អ្នកត្រូវបានប្រគល់ជូនរួចរាល់។',
    open_order_in_mini_app: 'សូមបើកការបញ្ជាទិញរបស់អ្នកនៅក្នុង Mini App ដើម្បីមើលការប្រគល់។'
  }
};

export type OrderNotificationKey =
  | 'payment_successful'
  | 'order_label'
  | 'product_label'
  | 'total_label'
  | 'order_delivered'
  | 'order_products_delivered'
  | 'open_order_in_mini_app';

export interface OrderNotificationParams {
  [key: string]: string | number;
}

export function tOrderNotification(
  language: SupportedLanguage,
  key: OrderNotificationKey,
  params?: OrderNotificationParams
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
