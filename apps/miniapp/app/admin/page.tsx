'use client';

import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatCard, StatusBadge, formatDate, formatMoney } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { getDashboardActivity, getDashboardStats } from '@/lib/api-admin';

export default function AdminDashboardPage() {
  const stats = useAsync(() => getDashboardStats(), []);
  const activity = useAsync(() => getDashboardActivity(10), []);

  if (stats.loading || activity.loading) return <LoadingState label="Loading dashboard…" />;
  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.reload} />;

  const data = stats.data!;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Store overview and recent activity"
        action={<button type="button" onClick={() => { stats.reload(); activity.reload(); }} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Refresh</button>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Revenue" value={formatMoney(data.orders.totalRevenue)} hint={`${data.orders.completed} completed orders`} />
        <StatCard label="Orders" value={data.orders.total} hint={`${data.orders.pending} pending · ${data.orders.expired} expired`} />
        <StatCard label="Products" value={data.products.total} hint={`${data.products.active} active · ${data.products.outOfStock} out of stock`} />
        <StatCard label="Customers" value={data.users.total} hint={`${data.users.withOrders} with orders`} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Available stock" value={data.stock.available} hint={`${data.stock.reserved} reserved · ${data.stock.sold} sold`} />
        <StatCard label="Payments" value={data.payments.total} hint={`${data.payments.succeeded} succeeded · ${data.payments.pending} pending`} />
        <StatCard label="Payment volume" value={formatMoney(data.payments.totalAmount)} />
        <StatCard label="Categories" value={data.categories.total} hint={`${data.categories.active} active`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Recent orders" description="Latest customer orders">
          {activity.data && activity.data.orders.length > 0 ? (
            <ul className="divide-y divide-slate-800/70">
              {activity.data.orders.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm text-slate-200">#{order.orderNumber}</p>
                    <p className="text-xs text-slate-500">
                      {order.user.firstName} {order.user.lastName ?? ''} · {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-300">{formatMoney(order.amount, order.currency)}</span>
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
            <ul className="divide-y divide-slate-800/70">
              {activity.data.payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm text-slate-200">{payment.reference}</p>
                    <p className="text-xs text-slate-500">
                      {payment.provider} · order #{payment.orderNumber ?? '—'} · {formatDate(payment.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-300">{formatMoney(payment.amount, payment.currency)}</span>
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
          <ul className="divide-y divide-slate-800/70">
            {data.stock.lowStockProducts.map((item) => (
              <li key={item.productId} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-200">{item.productName}</span>
                <span className="text-amber-300">
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