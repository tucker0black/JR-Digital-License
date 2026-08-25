'use client';

import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatCard, StatusBadge, formatDate, formatMoney } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { getDashboardActivity, getDashboardStats } from '@/lib/api-admin';

export default function AdminDashboardPage() {
  const stats = useAsync(() => getDashboardStats(), []);
  const activity = useAsync(() => getDashboardActivity(10), []);

  if (stats.loading || activity.loading) return <LoadingState label="Loading dashboard\u2026" />;
  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.reload} />;

  const data = stats.data!;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Store overview and recent activity"
        action={
          <button
            type="button"
            onClick={() => { stats.reload(); activity.reload(); }}
            className="inline-flex items-center justify-center rounded-xl border border-line/50 px-4 py-2 text-sm font-medium text-soft transition-luxury hover:border-line hover:text-ink hover:bg-muted/50"
          >
            Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Revenue"
          value={formatMoney(data.orders.totalRevenue)}
          hint={`${data.orders.completed} completed orders`}
        />
        <StatCard
          label="Orders"
          value={data.orders.total}
          hint={`${data.orders.pending} pending \u00b7 ${data.orders.expired} expired`}
        />
        <StatCard
          label="Products"
          value={data.products.total}
          hint={`${data.products.active} active \u00b7 ${data.products.outOfStock} out of stock`}
        />
        <StatCard
          label="Customers"
          value={data.users.total}
          hint={`${data.users.withOrders} with orders`}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Available stock"
          value={data.stock.available}
          hint={`${data.stock.reserved} reserved \u00b7 ${data.stock.sold} sold`}
        />
        <StatCard
          label="Payments"
          value={data.payments.total}
          hint={`${data.payments.succeeded} succeeded \u00b7 ${data.payments.pending} pending`}
        />
        <StatCard
          label="Payment volume"
          value={formatMoney(data.payments.totalAmount)}
        />
        <StatCard
          label="Categories"
          value={data.categories.total}
          hint={`${data.categories.active} active`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Recent orders" description="Latest customer orders">
          {activity.data && activity.data.orders.length > 0 ? (
            <ul className="divide-y divide-line/20">
              {activity.data.orders.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">#{order.orderNumber}</p>
                    <p className="mt-0.5 text-xs text-muted-text">
                      {order.user.firstName} {order.user.lastName ?? ''} \u00b7 {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums text-soft">{formatMoney(order.amount, order.currency)}</span>
                    <StatusBadge status={order.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No orders yet" />
          )}
        </Card>

        <Card title="Recent payments" description="Latest payment attempts">
          {activity.data && activity.data.payments.length > 0 ? (
            <ul className="divide-y divide-line/20">
              {activity.data.payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{payment.reference}</p>
                    <p className="mt-0.5 text-xs text-muted-text">
                      {payment.provider} \u00b7 order #{payment.orderNumber ?? '\u2014'} \u00b7 {formatDate(payment.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums text-soft">{formatMoney(payment.amount, payment.currency)}</span>
                    <StatusBadge status={payment.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No payments yet" />
          )}
        </Card>
      </div>

      {data.stock.lowStockProducts.length > 0 && (
        <Card title="Low stock alerts" className="mt-4">
          <ul className="divide-y divide-line/20">
            {data.stock.lowStockProducts.map((item) => (
              <li key={item.productId} className="flex items-center justify-between py-3 text-sm">
                <span className="font-medium text-ink">{item.productName}</span>
                <span className="text-warning">
                  {item.available} available (minimum {item.minimumQuantity})
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
