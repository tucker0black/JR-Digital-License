import Link from 'next/link';
import { memo } from 'react';
import type { Order } from '@/lib/api';
import type { BadgeTone } from '@/components/Badge';
import { Badge } from '@/components/Badge';

interface OrderCardProps {
  order: Order;
}

const statusTones: Record<string, BadgeTone> = {
  PENDING: 'amber',
  PROCESSING: 'primary',
  COMPLETED: 'green',
  CANCELLED: 'red',
  PAYMENT_PENDING: 'amber',
  PAID: 'green',
  EXPIRED: 'red',
  REFUNDED: 'violet',
  DRAFT: 'slate',
  FULFILLING: 'primary',
  DELIVERY_FAILED: 'red'
};

export const OrderCard = memo(function OrderCard({ order }: OrderCardProps) {
  const tone = statusTones[order.status] || 'slate';
  const firstItem = order.items[0];
  const itemCount = order.items.length;

  return (
    <Link
      href={`/orders/${order.id}`}
      className="group flex items-start justify-between gap-3 rounded-2xl border border-line bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md active:scale-[0.98]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">#{order.orderNumber}</span>
          <Badge tone={tone}>{order.status.replace('_', ' ')}</Badge>
        </div>
        <p className="mt-1.5 truncate text-sm text-soft">
          {firstItem?.productNameSnapshot || 'Unknown product'}
          {itemCount > 1 && ` +${itemCount - 1} more`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-base font-bold text-ink">
          {order.currency === 'USD' ? '$' : ''}
          {Number(order.total).toFixed(2)} {order.currency}
        </p>
        <p className="mt-0.5 text-xs text-soft">
          {new Date(order.createdAt).toLocaleDateString()}
        </p>
      </div>
    </Link>
  );
});
