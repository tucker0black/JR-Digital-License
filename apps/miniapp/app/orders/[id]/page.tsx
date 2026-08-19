'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getOrder } from '@/lib/api';
import type { Order } from '@/lib/api';
import { PaymentActions } from '@/components/PaymentActions';
import { StoreHeader } from '@/components/StoreHeader';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { formatDateTime } from '@/lib/format';
import { getOrderSupportUrl } from '@/lib/support';

const STATUS_TONES: Record<string, BadgeTone> = {
  PENDING: 'amber',
  PROCESSING: 'violet',
  COMPLETED: 'green',
  CANCELLED: 'red',
  PAYMENT_PENDING: 'amber',
  PAID: 'green',
  EXPIRED: 'red',
  REFUNDED: 'red',
  DRAFT: 'slate',
  FULFILLING: 'violet',
  DELIVERY_FAILED: 'red'
};

export default function OrderDetailPage() {
  const { status: telegramStatus } = useTelegramAuth();
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getOrder(id);
      setOrder(result.order);
      setError(null);
    } catch (err) {
      setOrder(null);
      setError(err instanceof Error ? err.message : 'Unable to load order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    void loadOrder();
  }, [loadOrder, telegramStatus]);

  if (telegramStatus !== 'ready') {
    return (
      <main className="min-h-screen bg-page text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
          <TelegramAuthNotice />
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-page text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
          <p className="text-sm text-soft">Loading order...</p>
        </div>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="min-h-screen bg-page text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
          <EmptyState
            title="Unable to load order"
            description={error ?? 'Order not found'}
            action={<Button href="/orders">Back to Orders</Button>}
          />
        </div>
      </main>
    );
  }

  const statusTone = STATUS_TONES[order.status] ?? 'slate';

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
        <header className="mb-4">
          <Link
            href="/orders"
            className="mb-3 inline-flex items-center gap-1 text-sm text-soft transition hover:text-primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            Back to Orders
          </Link>
        </header>

        <article className="space-y-4">
          <section className="animate-fade-up rounded-2xl border border-line bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-ink">
                  Order #{order.orderNumber}
                </h1>
                <p className="mt-1 text-sm text-soft">{formatDateTime(order.createdAt)}</p>
              </div>
              <Badge tone={statusTone}>{order.status.replace('_', ' ')}</Badge>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
            <h2 className="font-semibold text-ink">Items</h2>
            <div className="mt-3 space-y-3">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-line bg-muted/40 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{item.productNameSnapshot}</p>
                      <p className="text-sm text-soft capitalize">
                        {item.deliveryTypeSnapshot.toLowerCase().replace('_', ' ')}
                      </p>
                      {item.target && (
                        <p className="mt-1 truncate text-xs text-soft">Target: {item.target}</p>
                      )}
                      {item.fulfillment?.status === 'DELIVERED' && (
                        <div className="mt-2 space-y-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2">
                          <p className="text-xs text-success">
                            Your product{item.deliveryValues?.length ? ` (${item.deliveryValues.length} of ${item.quantitySnapshot})` : ''}
                          </p>
                          {(item.deliveryValues?.length ?? 0) > 0 ? (
                            <ol className="space-y-2">
                              {item.deliveryValues?.map((value, index) => (
                                <li key={index} className="border-t border-success/20 pt-2 first:border-t-0 first:pt-0">
                                  <p className="break-all text-sm font-medium text-ink">{value}</p>
                                </li>
                              ))}
                            </ol>
                          ) : item.deliveryValue ? (
                            <p className="break-all text-sm font-medium text-ink">
                              {item.deliveryValue}
                            </p>
                          ) : null}
                        </div>
                      )}
                      {item.fulfillment && item.fulfillment.status !== 'DELIVERED' && (
                        <p className="mt-1 text-xs text-soft">
                          Delivery: {item.fulfillment.status.toLowerCase().replace('_', ' ')}
                          {item.fulfillment.failureReason
                            ? ` — ${item.fulfillment.failureReason}`
                            : ''}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-ink">
                        {Number(item.unitPriceSnapshot).toFixed(2)} {item.currencySnapshot} ×{' '}
                        {item.quantitySnapshot}
                      </p>
                      <p className="text-sm text-soft">
                        {Number(item.totalSnapshot).toFixed(2)} {item.currencySnapshot}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
            <h2 className="font-semibold text-ink">Summary</h2>
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-soft">Subtotal</span>
                <span className="text-ink">
                  {Number(order.subtotal).toFixed(2)} {order.currency}
                </span>
              </div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-soft">Discount</span>
                  <span className="text-success">
                    - {Number(order.discount).toFixed(2)} {order.currency}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2">
                <span className="font-medium text-ink">Total</span>
                <span className="text-lg font-bold text-primary">
                  {Number(order.total).toFixed(2)} {order.currency}
                </span>
              </div>
            </div>
          </section>

          <PaymentActions
            orderId={order.id}
            orderNumber={order.orderNumber}
            orderStatus={order.status}
            orderTotal={Number(order.total).toFixed(2)}
            orderCurrency={order.currency}
          />

          {(() => {
            const supportUrl = getOrderSupportUrl(order.orderNumber);
            if (!supportUrl) return null;
            return (
              <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">Need help with this order?</p>
                    <p className="mt-0.5 text-sm text-soft">
                      Contact support on Telegram and reference order #{order.orderNumber}.
                    </p>
                  </div>
                  <a
                    href={supportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm shadow-primary/30 transition hover:bg-primary-dark"
                  >
                    Contact Support
                  </a>
                </div>
              </section>
            );
          })()}

          <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
            <h2 className="font-semibold text-ink">Information</h2>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-soft">Order ID</span>
                <span className="max-w-[200px] truncate font-mono text-xs text-ink">
                  {order.id}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-soft">Status</span>
                <span className="capitalize text-ink">
                  {order.status.toLowerCase().replace('_', ' ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-soft">Created</span>
                <span className="text-ink">{formatDateTime(order.createdAt)}</span>
              </div>
              {order.paidAt && (
                <div className="flex justify-between">
                  <span className="text-soft">Paid</span>
                  <span className="text-ink">{formatDateTime(order.paidAt)}</span>
                </div>
              )}
              {order.completedAt && (
                <div className="flex justify-between">
                  <span className="text-soft">Completed</span>
                  <span className="text-ink">{formatDateTime(order.completedAt)}</span>
                </div>
              )}
              {order.cancelledAt && (
                <div className="flex justify-between">
                  <span className="text-soft">Cancelled</span>
                  <span className="text-ink">{formatDateTime(order.cancelledAt)}</span>
                </div>
              )}
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}
