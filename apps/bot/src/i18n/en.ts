/**
 * English catalog for every customer-facing Telegram bot string.
 * This file is the source of truth: its keys define the TranslationKey type,
 * and the Khmer catalog (km.ts) is type-checked against it so the two
 * catalogs can never drift apart.
 *
 * Placeholders such as {app} / {amount} / {list} are filled by translate();
 * dynamic data (amounts, IDs, URLs) is always passed as a parameter and is
 * never translated.
 *
 * Never translate: product names, game names, provider names, order IDs,
 * transaction IDs, URLs, coupon codes, player IDs, server IDs, prices.
 */
export const en = {
  welcome: '👋 Welcome to {app}!\n\n🛍️ Buy digital products and SMM services directly through our Mini App.',
  select_language: '🌐 Please choose your language:',
  language_changed: '✅ Language updated.',
  open_mini_app: '📱 Open JR Digital License',
  balance_button: '💰 Balance',
  orders_button: '📦 Orders',
  support_button: '💬 Support',
  change_language_button: '🌐 Change Language',
  back_button: '⬅️ Back',
  language_km: '🇰🇭 ខ្មែរ',
  language_en: '🇬🇧 English',
  balance_message: '💰 Your balance:\n\n{amount}',
  balance_unavailable: '⚠️ Balance is temporarily unavailable. Please try again later.',
  orders_empty: '📦 You have no orders yet.\n\nOpen the store and make your first purchase!',
  orders_list: '📦 Your recent orders:\n\n{list}',
  orders_unavailable: '⚠️ Orders are temporarily unavailable. Please try again later.',
  help: 'ℹ️ Use the button below to open {app}.\n\n💰 Check your balance with /balance\n📦 View your orders with /orders\n💬 Contact support with /support',
  support:
    '💬 Need help?\n\nOpen {app} and go to the Support section to create a ticket, or send a message here and our team will get back to you.',
  generic_error: '❌ Something went wrong. Please try again.',
  cmd_start: 'Open JR Digital license',
  cmd_balance: 'View your balance',
  cmd_orders: 'View your orders',
  cmd_help: 'Get help',
  cmd_support: 'Contact support',
  status_draft: 'Draft',
  status_payment_pending: 'Payment pending',
  status_paid: 'Paid',
  status_processing: 'Processing',
  status_fulfilling: 'Fulfilling',
  status_completed: 'Completed',
  status_cancelled: 'Cancelled',
  status_expired: 'Expired',
  status_delivery_failed: 'Delivery failed',
  status_refunded: 'Refunded'
} as const;

export type TranslationKey = keyof typeof en;
