'use client';

import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatCard, StatusBadge, formatDate, formatMoney } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { getAdminAnalytics, getAdminAuditSummary, getAdminOrderStats, getDashboardStats } from '@/lib/api-admin';

export default function AdminAnalyticsPage() {
  const stats = useAsync(() => getDashboardStats(), []);
  const orderStats = useAsync(() => getAdminOrderStats(), []);
  const auditSummary = useAsync(() => getAdminAuditSummary(), []);
  const analytics = useAsync(() => getAdminAnalytics(), []);

  if (stats.loading || orderStats.loading || auditSummary.loading || analytics.loading) {
    return <LoadingState label="Loading analytics…" />;
  }
  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.reload} />;
  if (orderStats.error) return <ErrorState error={orderStats.error} onRetry={orderStats.reload} />;
  if (auditSummary.error) return <ErrorState error={auditSummary.error} onRetry={auditSummary.reload} />;
  if (analytics.error) return <ErrorState error={analytics.error} onRetry={analytics.reload} />;

  const data = stats.data!;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Sales, fulfillment and admin activity overview"
        action={
          <button
            type="button"
            onClick={() => { stats.reload(); orderStats.reload(); auditSummary.reload(); analytics.reload(); }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Revenue" value={formatMoney(orderStats.data?.totalRevenue)} />
        <StatCard label="Total orders" value={orderStats.data?.total ?? 0} />
        <StatCard label="Completed" value={orderStats.data?.completed ?? 0} />
        <StatCard label="Pending payment" value={orderStats.data?.pending ?? 0} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Cancelled" value={orderStats.data?.cancelled ?? 0} />
        <StatCard label="Expired" value={orderStats.data?.expired ?? 0} />
        <StatCard label="Paid (awaiting delivery)" value={orderStats.data?.paid ?? 0} />
        <StatCard label="Products sold" value={data.stock.sold} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Sales (last 14 days)" description="Confirmed order revenue per day">
          {analytics.data && analytics.data.dailySeries.length > 0 ? (
            (() => {
              const series = analytics.data!.dailySeries;
              const maxRevenue = Math.max(...series.map((day) => Number(day.revenue)), 0.01);
              return (
                <div className="flex h-40 items-end gap-1.5 sm:gap-2">
                  {series.map((day) => (
                    <div key={day.date} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                      <div className="pointer-events-none absolute -top-9 z-10 hidden whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 group-hover:block">
                        {day.date} · {formatMoney(day.revenue)} · {day.orders} order{day.orders === 1 ? '' : 's'}
                      </div>
                      <div
                        className="w-full rounded-t-md bg-cyan-500/60 transition-colors hover:bg-cyan-400/80"
                        style={{ height: `${Math.max((Number(day.revenue) / maxRevenue) * 100, 2)}%` }}
                      />
                    </div>
                  ))}
                </div>
              );
            })()
          ) : (
            <EmptyState title="No sales in the last 14 days" />
          )}
        </Card>

        <Card title="Top products" description="By revenue from confirmed orders">
          {analytics.data && analytics.data.topProducts.length > 0 ? (
            <ul className="divide-y divide-slate-800/70">
              {analytics.data.topProducts.map((product) => (
                <li key={product.productId ?? product.productName} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-slate-300">{product.productName}</span>
                  <span className="flex items-center gap-3 whitespace-nowrap">
                    <span className="text-xs text-slate-500">{product.orderCount} orders · {product.quantitySold} units</span>
                    <span className="font-medium text-slate-100">{formatMoney(product.revenue)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No sales yet" />
          )}
        </Card>

        <Card title="Payment performance" description="All payment sessions">
          {analytics.data && analytics.data.paymentPerformance.total > 0 ? (
            <>
              <div className="mb-3 flex items-end justify-between">
                <p className="text-3xl font-semibold text-slate-100">
                  {Number(analytics.data.paymentPerformance.successRate) > 0
                    ? `${Number(analytics.data.paymentPerformance.successRate).toFixed(1)}%`
                    : `${analytics.data.paymentPerformance.successRate}%`}
                </p>
                <p className="text-sm text-slate-500">success rate</p>
              </div>
              <ul className="divide-y divide-slate-800/70">
                <li className="flex justify-between py-2 text-sm"><span className="text-slate-300">Total</span><span className="text-slate-200">{analytics.data.paymentPerformance.total}</span></li>
                <li className="flex justify-between py-2 text-sm"><span className="text-slate-300">Succeeded</span><span className="text-emerald-300">{analytics.data.paymentPerformance.succeeded}</span></li>
                <li className="flex justify-between py-2 text-sm"><span className="text-slate-300">Failed</span><span className="text-red-300">{analytics.data.paymentPerformance.failed}</span></li>
              </ul>
            </>
          ) : (
            <EmptyState title="No payment data yet" />
          )}
        </Card>

        <Card title="Fulfillment failures" description="Failed delivery attempts awaiting attention">
          {analytics.data && analytics.data.fulfillmentFailures.count > 0 ? (
            <>
              <p className="mb-3 text-sm text-slate-400">
                <span className="font-semibold text-red-300">{analytics.data.fulfillmentFailures.count}</span> delivery record(s) in a failed state.
              </p>
              <ul className="divide-y divide-slate-800/70">
                {analytics.data.fulfillmentFailures.recent.slice(0, 5).map((failure) => (
                  <li key={failure.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <StatusBadge status={failure.status} />
                      <span className="text-xs text-slate-500">attempts: {failure.attemptCount}</span>
                    </span>
                    <span className="truncate text-xs text-slate-500">
                      {failure.failureReason ?? 'No reason recorded'} · {formatDate(failure.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState title="No fulfillment failures" message="All deliveries are healthy." />
          )}
        </Card>

        <Card title="SMM performance" description="Submitted SMM provider orders">
          {analytics.data && analytics.data.smmPerformance.total > 0 ? (
            <ul className="divide-y divide-slate-800/70">
              <li className="flex justify-between py-2 text-sm"><span className="text-slate-300">Total submitted</span><span className="text-slate-200">{analytics.data.smmPerformance.total}</span></li>
              <li className="flex justify-between py-2 text-sm"><span className="text-slate-300">Completed</span><span className="text-emerald-300">{analytics.data.smmPerformance.completed}</span></li>
              <li className="flex justify-between py-2 text-sm"><span className="text-slate-300">In progress</span><span className="text-amber-300">{analytics.data.smmPerformance.inProgress}</span></li>
              <li className="flex justify-between py-2 text-sm"><span className="text-slate-300">Failed / cancelled</span><span className="text-red-300">{analytics.data.smmPerformance.failed}</span></li>
            </ul>
          ) : (
            <EmptyState title="No SMM orders yet" />
          )}
        </Card>
      </div>

      <Card title="Order status" description="Current distribution of orders">
          <ul className="divide-y divide-slate-800/70">
            {(
              [
                ['PAYMENT_PENDING', data.orders.pending],
                ['PAID', data.orders.paid],
                ['COMPLETED', data.orders.completed],
                ['CANCELLED', data.orders.cancelled],
                ['EXPIRED', data.orders.expired]
              ] as Array<[string, number]>
            ).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between py-2 text-sm">
                <StatusBadge status={status} />
                <span className="text-slate-200">{count}</span>
              </li>
            ))}
          </ul>
        </Card>

      <Card title="Recent orders" className="mt-4">
        {data.orders.recentOrders.length > 0 ? (
          <ul className="divide-y divide-slate-800/70">
            {data.orders.recentOrders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-300">#{order.orderNumber} · {order.user.firstName} {order.user.lastName ?? ''}</span>
                <span className="flex items-center gap-2">
                  <span className="text-slate-200">{formatMoney(order.total, order.currency)}</span>
                  <StatusBadge status={order.status} />
                  <span className="text-xs text-slate-500">{formatDate(order.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No orders yet" />
        )}
      </Card>

      <Card title="Admin action summary" description="Audit log actions performed by administrators" className="mt-4">
        {auditSummary.data && Object.keys(auditSummary.data.byAction).length > 0 ? (
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-400">Top actions</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(auditSummary.data.byAction)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 12)
                  .map(([action, count]) => (
                    <span key={action} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300">
                      {action} <span className="font-semibold text-slate-100">{count}</span>
                    </span>
                  ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-400">By entity</h3>
              <ul className="space-y-1.5">
                {Object.entries(auditSummary.data.byEntity)
                  .sort(([, a], [, b]) => b - a)
                  .map(([entity, count]) => (
                    <li key={entity} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">{entity}</span>
                      <span className="font-semibold text-slate-100">{count}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-400">By admin</h3>
              <ul className="space-y-1.5">
                {Object.entries(auditSummary.data.byAdmin)
                  .sort(([, a], [, b]) => b - a)
                  .map(([adminId, count]) => (
                    <li key={adminId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-mono text-xs text-slate-400">{adminId}</span>
                      <span className="font-semibold text-slate-100">{count}</span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        ) : (
          <EmptyState title="No admin actions yet" />
        )}
      </Card>
    </div>
  );
}