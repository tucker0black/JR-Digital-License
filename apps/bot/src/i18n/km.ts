import type { TranslationKey } from './en.js';

/**
 * Khmer catalog for every customer-facing Telegram bot string.
 * Typed as Record<TranslationKey, string> so a missing or extra key is a
 * compile-time error — the two catalogs always stay in sync.
 */
export const km: Record<TranslationKey, string> = {
  welcome:
    '👋 សូមស្វាគមន៍មកកាន់ {app}!\n\n🛍️ ទិញផលិតផលឌីជីថល និងសេវាកម្ម SMM ដោយផ្ទាល់តាមរយៈ Mini App របស់យើង។',
  select_language: '🌐 សូមជ្រើសរើសភាសារបស់អ្នក៖',
  language_changed: '✅ ភាសាត្រូវបានផ្លាស់ប្តូរ។',
  open_mini_app: '📱 បើក JR Digital License',
  balance_button: '💰 សមតុល្យ',
  orders_button: '📦 ការបញ្ជាទិញ',
  support_button: '💬 ជំនួយ',
  change_language_button: '🌐 ប្តូរភាសា',
  back_button: '⬅️ ត្រឡប់ក្រោយ',
  language_km: '🇰🇭 ខ្មែរ',
  language_en: '🇬🇧 English',
  balance_message: '💰 សមតុល្យរបស់អ្នក៖\n\n{amount}',
  balance_unavailable: '⚠️ សមតុល្យមិនអាចប្រើបានជាបណ្តោះអាសន្នទេ។ សូមព្យាយាមម្តងទៀតនៅពេលក្រោយ។',
  orders_empty: '📦 អ្នកមិនទាន់មានការបញ្ជាទិញទេ។\n\nបើកហាង ហើយធ្វើការទិញដំបូងរបស់អ្នក!',
  orders_list: '📦 ការបញ្ជាទិញថ្មីៗរបស់អ្នក៖\n\n{list}',
  orders_unavailable: '⚠️ ការបញ្ជាទិញមិនអាចប្រើបានជាបណ្តោះអាសន្នទេ។ សូមព្យាយាមម្តងទៀតនៅពេលក្រោយ។',
  help: 'ℹ️ ប្រើប៊ូតុងខាងក្រោមដើម្បីបើក {app}។\n\n💰 ពិនិត្យសមតុល្យដោយប្រើ /balance\n📦 មើលការបញ្ជាទិញដោយប្រើ /orders\n💬 ទាក់ទងជំនួយដោយប្រើ /support',
  support:
    '💬 ត្រូវការជំនួយ?\n\nបើក {app} ហើយចូលទៅផ្នែក «ជំនួយ» ដើម្បីបង្កើតសំណើជំនួយ ឬផ្ញើសារមកនៅទីនេះ ហើយក្រុមការងាររបស់យើងនឹងតបឱ្យក្នុងពេលឆាប់ៗនេះ។',
  generic_error: '❌ មានបញ្ហាកើតឡើង។ សូមព្យាយាមម្តងទៀត។',
  cmd_start: 'បើក JR Digital license',
  cmd_balance: 'មើលសមតុល្យរបស់អ្នក',
  cmd_orders: 'មើលការបញ្ជាទិញរបស់អ្នក',
  cmd_help: 'ទទួលបានជំនួយ',
  cmd_support: 'ទាក់ទងជំនួយ',
  status_draft: 'ព្រាង',
  status_payment_pending: 'កំពុងរង់ចាំការទូទាត់',
  status_paid: 'បានទូទាត់',
  status_processing: 'កំពុងដំណើរការ',
  status_fulfilling: 'កំពុងរៀបចំប្រគល់',
  status_completed: 'បានបញ្ចប់',
  status_cancelled: 'បានបោះបង់',
  status_expired: 'ផុតកំណត់',
  status_delivery_failed: 'ការប្រគល់បរាជ័យ',
  status_refunded: 'បានបង្វិលសងប្រាក់'
};
