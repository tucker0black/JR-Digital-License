'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorState, Field, Input, LoadingState, PageHeader, Select, StatusBadge, Table, Textarea, formatDate, formatMoney } from '@/components/admin/ui';
import { CopyText } from '@/components/CopyText';
import { useAsync } from '@/components/admin/use-async';
import { humanizeError } from '@/lib/errors';
import { cancelAdminOrder, deliverAdminOrder, getAdminOrder, getAdminOrderDeliveries, recheckAdminPayment, refundAdminOrder, retryAdminPayment } from '@/lib/api-admin';

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const order = useAsync(() => getAdminOrder(id), [id]);
  const deliveries = useAsync(() => getAdminOrderDeliveries(id), [id]);
  const [reason, setReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [deliverTitle, setDeliverTitle] = useState('');
  const [deliverContent, setDeliverContent] = useState('');
  const [deliverItemId, setDeliverItemId] = useState<string | null>(null);
  const [confirmDeliver, setConfirmDeliver] = useState(false);

  if (order.loading) return <LoadingState label="Loading order…" />;
  if (order.error) return <ErrorState error={order.error} onRetry={order.reload} />;

  const data = order.data;
  if (!data) return <ErrorState error="Order not found" onRetry={order.reload} />;

  const user = data.user ?? null;
  const items = data.items ?? [];
  const payments = data.payments ?? [];
  const walletPayment = payments.find((p) => p.provider === 'WALLET');
  const paidPayment = payments.find((p) => p.status === 'SUCCEEDED');
  const canRefund = (data.status === 'PAID' || data.status === 'COMPLETED') && Boolean(paidPayment);
  const refundableAmount = refundAmount.trim() || (paidPayment?.amount ?? data.total);

  const run = async (action: string, fn: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    setBusy(action);
    try {
      await fn();
      order.reload();
      if (action === 'cancel' || action === 'refund') {
        window.dispatchEvent(new Event('hand-delivery-count-changed'));
      }
    } catch (err) {
      setError(humanizeError('Unable to perform action', err));
    } finally {
      setBusy(null);
    }
  };

  const handleRecheck = async (paymentId: string) => {
    setError(null);
    setNotice(null);
    setBusy(`recheck:${paymentId}`);
    try {
      const result = await recheckAdminPayment(paymentId);
      if (result.success && result.status === 'SUCCEEDED') {
        setNotice({
          kind: 'success',
          text: `Verified with Bakong. Status: ${result.status}${result.providerTransactionHash ? `. Transaction ID: ${result.providerTransactionHash}` : ''}${result.fulfillment && !result.fulfillment.success && result.fulfillment.errors.length > 0 ? ' (fulfillment incomplete — check logs)' : ''}`
        });
      } else if (result.success && result.status === 'PENDING') {
        setNotice({
          kind: 'error',
          text: `Bakong has not confirmed this payment yet. Payment stays ${result.status}.${result.error ? ` ${result.error}` : ''}`
        });
      } else {
        setNotice({
          kind: 'error',
          text: `Payment remains unsuccessful (${result.status}).${result.error ? ` ${result.error}` : ''}`
        });
      }
      order.reload();
    } catch (err) {
      setError(humanizeError('Unable to recheck payment', err));
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
      {notice && (
        <p className={`mb-3 rounded-lg border px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
          {notice.text}
        </p>
      )}

      <Card title="Order" description="Human-readable number and the exact database ID" className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-400">Order ID</p>
            <p className="break-all font-mono text-xs text-slate-200">{data.id}</p>
          </div>
          <CopyText
            value={data.id}
            label="Copy Order ID"
            copiedClassName="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Customer" className="lg:col-span-1">
          {user ? (
            <>
              <p className="text-sm text-slate-200">
                {user.firstName ?? ''} {user.lastName ?? ''}
              </p>
              <p className="text-xs text-slate-500">@{user.username ?? '—'}</p>
              <p className="mt-1 text-xs text-slate-500">Telegram ID: {user.telegramId}</p>
              <p className="mt-1 text-xs text-slate-500">Customer ID: {user.customerId}</p>
              <p className="mt-1 text-xs text-slate-500">User ID: {user.id}</p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Customer data unavailable.</p>
          )}
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
            {walletPayment && (
              <div>
                <p className="text-xs text-slate-500">Paid from wallet</p>
                <p className="text-slate-200">{formatMoney(walletPayment.amount, walletPayment.currency)}</p>
              </div>
            )}
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
            <div>
              <p className="text-xs text-slate-500">Cancelled at</p>
              <p className="text-slate-200">{formatDate(data.cancelledAt)}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Items" className="mt-4">
        {items.length > 0 ? (
          <Table headers={['Product', 'Delivery', 'Quantity', 'Unit price', 'Total']}>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2">
                  <p className="text-slate-200">{item.productNameSnapshot}</p>
                  <p className="text-xs text-slate-500">{item.product?.slug ?? 'deleted product'}</p>
                  {item.target && <p className="mt-0.5 break-all text-xs text-slate-500">Target: {item.target}</p>}
                </td>
                <td className="px-3 py-2"><Badge>{item.deliveryTypeSnapshot.replace(/_/g, ' ')}</Badge></td>
                <td className="px-3 py-2 text-slate-300">{item.quantitySnapshot}</td>
                <td className="px-3 py-2 text-slate-300">{formatMoney(item.unitPriceSnapshot, item.currencySnapshot)}</td>
                <td className="px-3 py-2 text-slate-300">{formatMoney(item.totalSnapshot, item.currencySnapshot)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sm text-slate-500">No items recorded.</p>
        )}
      </Card>

      <Card title="Hand Delivery" description="Deliver product content manually for hand-delivery orders" className="mt-4">
        {deliveries.data && deliveries.data.deliveries.length > 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-xs text-slate-400">Previous deliveries:</p>
            {deliveries.data.deliveries.map((d) => (
              <div key={d.id} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-emerald-300">{d.title}</p>
                  <span className="text-xs text-slate-500">{new Date(d.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{d.content}</p>
                <p className="mt-1 text-xs text-slate-500">For: {d.orderItem.productNameSnapshot}</p>
              </div>
            ))}
          </div>
        )}

        {data.status === 'PAID' || data.status === 'FULFILLING' || data.status === 'COMPLETED' ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Select an order item and enter the delivery details:</p>
            <Field label="Order Item">
              <Select value={deliverItemId ?? ''} onChange={(e) => setDeliverItemId(e.target.value || null)}>
                <option value="" disabled>Select an item…</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.productNameSnapshot} ({item.deliveryTypeSnapshot})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Delivery Title">
              <Input value={deliverTitle} onChange={(e) => setDeliverTitle(e.target.value)} placeholder="e.g. Account credentials" />
            </Field>
            <Field label="Delivery Content" hint="Enter account details, license key, or any content to deliver">
              <Textarea value={deliverContent} onChange={(e) => setDeliverContent(e.target.value)} placeholder="Account email, password, license key, instructions…" rows={4} />
            </Field>
            <Button
              variant="subtle"
              disabled={busy === 'deliver' || !deliverItemId || !deliverTitle.trim() || !deliverContent.trim()}
              onClick={async () => {
                if (!confirmDeliver) {
                  setConfirmDeliver(true);
                  setError(null);
                  return;
                }
                setError(null);
                setNotice(null);
                setBusy('deliver');
                try {
                  await deliverAdminOrder(data.id, deliverItemId!, deliverTitle.trim(), deliverContent.trim());
                  setNotice({ kind: 'success', text: 'Product delivered successfully.' });
                  setDeliverTitle('');
                  setDeliverContent('');
                  setDeliverItemId(null);
                  setConfirmDeliver(false);
                  deliveries.reload();
                  order.reload();
                  window.dispatchEvent(new Event('hand-delivery-count-changed'));
                } catch (err) {
                  setError(humanizeError('Delivery failed', err));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'deliver' ? 'Delivering…' : confirmDeliver ? 'Confirm Delivery' : 'Deliver Product'}
            </Button>
            {confirmDeliver && (
              <p className="text-xs text-amber-300">This will deliver the content to the customer and mark the item as delivered. This action cannot be undone.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Order must be paid before manual delivery.</p>
        )}
      </Card>

      <Card title="Payments" description="Payment method, KHQR/payment reference and transaction reference" className="mt-4">
        {payments.length > 0 ? (
          <Table headers={['Provider', 'Status', 'Reference', 'Transaction ID', 'Amount', 'Created', 'Paid', 'Actions']}>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td className="px-3 py-2"><StatusBadge status={payment.provider} /></td>
                <td className="px-3 py-2"><StatusBadge status={payment.status} /></td>
                <td className="max-w-44 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs text-slate-300" title={payment.reference}>{payment.reference}</span>
                    <CopyText
                      value={payment.reference}
                      label="Copy"
                      copiedClassName="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    />
                  </div>
                </td>
                <td className="max-w-44 px-3 py-2">
                  {payment.providerTransactionHash ? (
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs text-slate-300" title={payment.providerTransactionHash}>{payment.providerTransactionHash}</span>
                      <CopyText
                        value={payment.providerTransactionHash}
                        label="Copy Transaction ID"
                        copiedClassName="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-300">{formatMoney(payment.amount, payment.currency)}</td>
                <td className="px-3 py-2 text-slate-400">{formatDate(payment.createdAt)}</td>
                <td className="px-3 py-2 text-slate-400">{formatDate(payment.paidAt)}</td>
                <td className="px-3 py-2">
                  {(payment.provider === 'KHQRCC' || payment.provider === 'KHQR' || payment.provider === 'BAKONG') &&
                    (payment.status === 'PENDING' || payment.status === 'PROCESSING') && (
                    <Button
                      variant="ghost"
                      disabled={busy === `recheck:${payment.id}`}
                      onClick={() => handleRecheck(payment.id)}
                    >
                      {busy === `recheck:${payment.id}` ? 'Rechecking…' : 'Recheck Payment'}
                    </Button>
                  )}
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

        {canRefund && (
          <div className="mt-3">
            <Field label="Refund amount" hint={`Never exceeds the amount actually paid (${formatMoney(paidPayment?.amount ?? data.total, data.currency)})`}>
              <Input
                type="text"
                inputMode="decimal"
                value={refundAmount}
                onChange={(e) => { setRefundAmount(e.target.value); setConfirmRefund(false); }}
                placeholder={paidPayment?.amount ?? data.total}
              />
            </Field>
            {paidPayment && paidPayment.provider !== 'WALLET' && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                This order was paid via {paidPayment.provider}. Bakong/KHQR does not support automated reversals in this
                system — the refund will be recorded locally and you must return the money to the customer manually
                (original transaction {paidPayment.reference}).
              </p>
            )}
          </div>
        )}

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
            disabled={!canRefund || busy === 'refund' || busy === 'confirm-refund'}
            onClick={() => {
              if (!confirmRefund) {
                setConfirmRefund(true);
                setError(null);
                return;
              }
              void run('refund', async () => {
                const result = await refundAdminOrder(data.id, refundAmount.trim() || undefined, reason.trim() || undefined);
                setConfirmRefund(false);
                if (result.refund.externalRefundRequired) {
                  setNotice({
                    kind: 'error',
                    text: `Refund of ${formatMoney(result.refund.amountRefunded, result.refund.currency)} recorded (order marked REFUNDED). ${result.refund.provider} has no automated reversal — return the money to the customer manually.`
                  });
                } else {
                  setNotice({
                    kind: 'success',
                    text: `Refund of ${formatMoney(result.refund.amountRefunded, result.refund.currency)} returned to the customer's wallet.`
                  });
                }
              });
            }}
          >
            {busy === 'refund' ? 'Refunding…' : confirmRefund ? 'Confirm Refund' : 'Refund order'}
          </Button>
        </div>

        {confirmRefund && canRefund && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
            <p className="font-semibold text-red-300">Confirm refund</p>
            <p className="mt-1 text-red-200/90">
              Refund <span className="font-semibold">{formatMoney(refundableAmount, data.currency)}</span> for order{' '}
              <span className="font-semibold">#{data.orderNumber}</span> to customer{' '}
              <span className="font-semibold">
                {user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.customerId : '—'}
              </span>
              {user?.customerId ? ` (${user.customerId})` : ''}?
            </p>
            <p className="mt-1 text-xs text-red-200/70">
              The refund cannot be automatically reversed. Verify the amount and customer before confirming.
            </p>
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" disabled={busy === 'refund'} onClick={() => setConfirmRefund(false)}>
                Back
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}