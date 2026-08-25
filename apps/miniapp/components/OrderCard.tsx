import Link from 'next/link';
import { memo } from 'react';
import type { Order } from '@/lib/api';
import { Badge } from '@/components/Badge';
import { getOrderStatusTone } from '@/components/orderStatusTone';
import { useTranslation } from '@/lib/i18n';

interface OrderCardProps {
  order: Order;
}

const statusIcons: Record<string, string> = {
  COMPLETED: '\u2713',
  CANCELLED: '\u2715',
  PAYMENT_PENDING: '\u25F7',
  PAID: '\u2713',
  PROCESSING: '\u25D5',
  FULFILLING: '\u25D5',
};

export const OrderCard = memo(function OrderCard({ order }: OrderCardProps) {
  const { t } = useTranslation();
  const tone = getOrderStatusTone(order.status);
  const firstItem = order.items[0];
  const itemCount = order.items.length;

  return (
    <Link
      href={`/orders/${order.id}`}
      className="group flex items-center gap-4 rounded-2xl card-cosmic p-4 transition-luxury hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
        order.status === 'COMPLETED' || order.status === 'PAID'
          ? 'bg-success/10 text-success'
          : order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.status === 'DELIVERY_FAILED'
            ? 'bg-danger/10 text-danger'
            : order.status === 'PAYMENT_PENDING' || order.status === 'PENDING'
              ? 'bg-warning/10 text-warning'
              : 'bg-primary/10 text-primary'
      }`}>
        {statusIcons[order.status] ?? '\u25CB'}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">#{order.orderNumber}</span>
          <Badge tone={tone}>{order.status.replace('_', ' ')}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-text">
          {firstItem?.productNameSnapshot || t('orders.unknownProduct')}
          {itemCount > 1 && ` ${t('orders.moreItems', { count: itemCount - 1 })}`}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-text/70">
          {new Date(order.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tracking-premium text-ink tabular-nums">
          {order.currency === 'USD' ? '$' : ''}
          {Number(order.total).toFixed(2)}
        </p>
      </div>
    </Link>
  );
});
