import type { BadgeTone } from '@/components/Badge';

/**
 * Canonical presentation-only tone mapping for order statuses.
 * Semantics: payment flow amber -> violet -> green; system working = primary;
 * terminal-negative states (cancelled/expired/refunded/delivery failed) = red.
 * Single source of truth used by Home, OrderCard and Order detail.
 */
export const ORDER_STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: 'slate',
  PAYMENT_PENDING: 'amber',
  PENDING: 'amber',
  PAID: 'violet',
  PROCESSING: 'primary',
  FULFILLING: 'primary',
  COMPLETED: 'green',
  CANCELLED: 'red',
  EXPIRED: 'red',
  REFUNDED: 'red',
  DELIVERY_FAILED: 'red'
};

export function getOrderStatusTone(status: string): BadgeTone {
  return ORDER_STATUS_TONES[status] ?? 'slate';
}
