'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Pagination, Select, StatusBadge, Table, formatDate, formatMoney } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { getAdminOrders } from '@/lib/api-admin';

const ORDER_STATUSES = [
  'DRAFT',
  'PAYMENT_PENDING',
  'PAID',
  'PROCESSING',
  'FULFILLING',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'DELIVERY_FAILED',
  'REFUNDED'
];

export default function AdminOrdersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const orders = useAsync(
    () => getAdminOrders({ page, pageSize: 20, search: search || undefined, status: status || undefined }),
    [page, search, status]
  );

  if (orders.loading) return <LoadingState label="Loading orders…" />;
  if (orders.error) return <ErrorState error={orders.error} onRetry={orders.reload} />;

  return (
    <div>
      <PageHeader title="Orders" description="All customer orders and their payment/fulfillment state" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Input
          placeholder="Search by order number or ID…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      <Card>
        {orders.data && orders.data.orders.length > 0 ? (
          <>
            <Table headers={['#', 'Customer', 'Items', 'Total', 'Payments', 'Status', 'Date', '']}>
              {orders.data.orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-3 py-2 font-medium text-slate-200">#{order.orderNumber}</td>
                  <td className="px-3 py-2">
                    <p className="text-slate-200">{order.user.firstName} {order.user.lastName ?? ''}</p>
                    <p className="text-xs text-slate-500">@{order.user.username ?? '—'}</p>
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {order.items.map((item) => item.productNameSnapshot).join(', ')}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{formatMoney(order.total, order.currency)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {order.payments.map((payment) => (
                        <span key={payment.id} className="text-xs text-slate-400">
                          {payment.provider} <StatusBadge status={payment.status} />
                        </span>
                      ))}
                      {order.payments.length === 0 && <span className="text-xs text-slate-600">none</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={order.status} /></td>
                  <td className="px-3 py-2 text-slate-300">{formatDate(order.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/orders/${order.id}`} className="text-sm font-medium text-cyan-400 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={orders.data.page} total={orders.data.total} pageSize={orders.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No orders found" message="Adjust filters." />
        )}
      </Card>
    </div>
  );
}