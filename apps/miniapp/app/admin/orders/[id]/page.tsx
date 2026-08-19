'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorState, Field, LoadingState, PageHeader, StatusBadge, Table, Textarea, formatDate, formatMoney } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { humanizeError } from '@/lib/errors';
import { cancelAdminOrder, getAdminOrder, refundAdminOrder, retryAdminPayment } from '@/lib/api-admin';

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const order = useAsync(() => getAdminOrder(id), [id]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (order.loading) return <LoadingState label="Loading order…" />;
  if (order.error) return <ErrorState error={order.error} onRetry={order.reload} />;

  const data = order.data!.order;

  const run = async (action: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(action);
    try {
      await fn();
      order.reload();
    } catch (err) {
      setError(humanizeError('Unable to perform action', err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={`Order #${data.orderNumber}`}
        description={`Created ${formatDate(data.createdAt)}`}
        action={<StatusBadge status={data.status} />}
      />

      {error && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Customer" className="lg:col-span-1">
          <p className="text-sm text-slate-200">{data.user.firstName} {data.user.lastName ?? ''}</p>
          <p className="text-xs text-slate-500">@{data.user.username ?? '—'}</p>
          <p className="mt-1 text-xs text-slate-500">Telegram ID: {data.user.telegramId}</p>
          <p className="mt-1 text-xs text-slate-500">User ID: {data.user.id}</p>
        </Card>

        <Card title="Summary" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-500">Subtotal</p>
              <p className="text-slate-200">{formatMoney(data.subtotal, data.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Discount</p>
              <p className="text-slate-200">{formatMoney(data.discount, data.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total</p>
              <p className="font-semibold text-slate-100">{formatMoney(data.total, data.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Paid at</p>
              <p className="text-slate-200">{formatDate(data.paidAt)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Completed at</p>
              <p className="text-slate-200">{formatDate(data.completedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Expires at</p>
              <p className="text-slate-200">{formatDate(data.expiresAt)}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Items" className="mt-4">
        <Table headers={['Product', 'Quantity', 'Unit price', 'Total', 'Delivery']}>
          {data.items.map((item) => (
            <tr key={item.id}>
              <td className="px-3 py-2">
                <p className="text-slate-200">{item.productNameSnapshot}</p>
                <p className="text-xs text-slate-500">{item.product?.slug ?? 'deleted product'}</p>
              </td>
              <td className="px-3 py-2 text-slate-300">{item.quantitySnapshot}</td>
              <td className="px-3 py-2 text-slate-300">{formatMoney(item.unitPriceSnapshot, item.currencySnapshot)}</td>
              <td className="px-3 py-2 text-slate-300">{formatMoney(item.totalSnapshot, item.currencySnapshot)}</td>
              <td className="px-3 py-2"><Badge>{item.deliveryTypeSnapshot}</Badge></td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Payments" className="mt-4">
        {data.payments.length > 0 ? (
          <Table headers={['Reference', 'Provider', 'Amount', 'Status', 'Created', 'Actions']}>
            {data.payments.map((payment) => (
              <tr key={payment.id}>
                <td className="px-3 py-2 text-slate-300">{payment.reference}</td>
                <td className="px-3 py-2 text-slate-300">{payment.provider}</td>
                <td className="px-3 py-2 text-slate-300">{formatMoney(payment.amount, payment.currency)}</td>
                <td className="px-3 py-2"><StatusBadge status={payment.status} /></td>
                <td className="px-3 py-2 text-slate-300">{formatDate(payment.createdAt)}</td>
                <td className="px-3 py-2">
                  {(payment.status === 'FAILED' || payment.status === 'EXPIRED') && (
                    <Button
                      variant="ghost"
                      disabled={busy === payment.id}
                      onClick={() => run(payment.id, () => retryAdminPayment(payment.id))}
                    >
                      Retry
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sm text-slate-500">No payments recorded.</p>
        )}
      </Card>

      <Card title="Admin actions" className="mt-4">
        <Field label="Reason (recorded in audit log)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional reason for cancel/refund" />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={busy === 'cancel'}
            onClick={() => run('cancel', () => cancelAdminOrder(data.id, reason.trim() || undefined))}
          >
            Cancel order
          </Button>
          <Button
            variant="danger"
            disabled={busy === 'refund'}
            onClick={() => run('refund', () => refundAdminOrder(data.id, reason.trim() || undefined))}
          >
            Refund order
          </Button>
        </div>
      </Card>
    </div>
  );
}