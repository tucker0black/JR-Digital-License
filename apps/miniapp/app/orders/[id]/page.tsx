'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getOrder } from '@/lib/api';
import type { Order } from '@/lib/api';
import { CopyText } from '@/components/CopyText';
import { PaymentActions } from '@/components/PaymentActions';
import { StoreHeader } from '@/components/StoreHeader';
import { Badge } from '@/components/Badge';
import { getOrderStatusTone } from '@/components/orderStatusTone';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { TranslatedText } from '@/components/TranslatedText';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { useTranslation } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { getOrderSupportUrl } from '@/lib/support';

const TIMELINE_STEP = ['DRAFT', 'PAYMENT_PENDING', 'PAID', 'FULFILLING', 'DELIVERED', 'COMPLETED'] as const;

type TimelineStep = typeof TIMELINE_STEP[number];

export default function OrderDetailPage() {
  const { status: telegramStatus } = useTelegramAuth();
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t('orders.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

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
          <div className="animate-fade-up space-y-4" aria-hidden="true">
            <Skeleton className="h-[88px] w-full rounded-2xl" />
            <div className="space-y-3 rounded-2xl card-cosmic p-4 sm:p-5">
              <Skeleton className="h-5 w-20 rounded-lg" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
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
            title={t('orders.unableToLoad')}
            description={error ?? t('orders.orderNotFound')}
            action={<Button href="/orders">{t('orders.backToOrders')}</Button>}
          />
        </div>
      </main>
    );
  }

  const statusTone = getOrderStatusTone(order.status);

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
        <header className="mb-4">
          <Link
            href="/orders"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-soft transition-default hover:text-primary"
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
            {t('orders.backToOrders')}
          </Link>
        </header>

        <article className="space-y-4">
          <section className="animate-fade-up rounded-2xl card-cosmic p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-ink">
                    Order #{order.orderNumber}
                  </h1>
                  <CopyText value={`#${order.orderNumber}`} label={t('orders.copyOrderNumber')} title={t('orders.copyOrderNumber')} />
                </div>
                <p className="mt-1 text-sm text-soft">{formatDateTime(order.createdAt)}</p>
              </div>
              <Badge tone={statusTone}>{order.status.replace('_', ' ')}</Badge>
            </div>
            {order.status === 'REFUNDED' && (
              <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {t('orders.refundedNotice')}
              </p>
            )}

            {order.items.some((item) => item.manualDelivery) && (
              <div className="mt-4 space-y-1.5">
                <p className="text-xs font-medium text-soft">{t('orders.timeline') ?? 'Order Timeline'}</p>
                {TIMELINE_STEP.map((step, idx) => {
                  const orderStatusStr = order.status as string;
                  const hasManualDelivery = order.items.some((item) => item.manualDelivery);

                  let isCompleted: boolean;
                  let isCurrent: boolean;

                  if (hasManualDelivery && order.status === 'FULFILLING') {
                    isCompleted = idx <= 2;
                    isCurrent = step === 'FULFILLING';
                  } else if (order.status === 'COMPLETED') {
                    isCompleted = true;
                    isCurrent = step === 'COMPLETED';
                  } else {
                    const orderStatusIndex = TIMELINE_STEP.indexOf(order.status as TimelineStep);
                    isCompleted = orderStatusIndex >= 0 && idx <= orderStatusIndex;
                    isCurrent = step === orderStatusStr;
                  }

                  const labels: Record<TimelineStep, string> = {
                    DRAFT: t('orders.timelinePlaced') ?? 'Order Placed',
                    PAYMENT_PENDING: t('orders.timelinePending') ?? 'Awaiting Payment',
                    PAID: t('orders.timelinePaid') ?? 'Paid',
                    FULFILLING: t('orders.timelinePrepared') ?? 'Prepared',
                    DELIVERED: t('orders.timelineDelivered') ?? 'Delivered',
                    COMPLETED: t('orders.timelineCompleted') ?? 'Completed'
                  };

                  return (
                    <div key={step} className="flex items-center gap-3">
                      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        isCurrent ? 'bg-primary text-white' : isCompleted ? 'bg-success/20 text-success' : 'bg-line text-soft'
                      }`}>
                        {isCompleted || isCurrent ? '✓' : idx + 1}
                      </div>
                      <span className={`text-sm ${isCurrent ? 'font-semibold text-ink' : isCompleted ? 'text-ink' : 'text-soft'}`}>
                        {labels[step]}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl card-cosmic p-4 sm:p-5">
            <h2 className="font-semibold text-ink">{t('orders.items')}</h2>
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
                        <p className="mt-1 truncate text-xs text-soft">{t('orders.targetLabel')}: {item.target}</p>
                      )}
                      {item.manualDelivery && (
                        <div className="mt-2 space-y-1 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-primary">{t('orders.handDelivered') ?? 'Delivered Content'}</p>
                            <CopyText
                              value={`${item.manualDelivery.title}\n${item.manualDelivery.content}`}
                              label={t('orders.copyValue')}
                              title={t('orders.copyTitle')}
                            />
                          </div>
                          <p className="text-sm font-medium text-ink">{item.manualDelivery.title}</p>
                          <p className="whitespace-pre-wrap text-sm text-ink">{item.manualDelivery.content}</p>
                          <p className="text-xs text-soft">{formatDateTime(item.manualDelivery.deliveredAt)}</p>
                        </div>
                      )}
                      {!item.manualDelivery && item.fulfillment?.status === 'DELIVERED' && (
                        <div className="mt-2 space-y-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-success">
                              {t('orders.yourProduct')}{item.deliveryValues?.length ? ` (${item.deliveryValues.length} of ${item.quantitySnapshot})` : ''}
                            </p>
                            {(item.deliveryValues?.length ?? 0) > 1 && (
                              <CopyText
                                value={(item.deliveryValues ?? []).join('\n')}
                                label={t('orders.copyAll')}
                                title={t('orders.copyAll')}
                              />
                            )}
                          </div>
                          {(item.deliveryValues?.length ?? 0) > 0 ? (
                            <ol className="space-y-2">
                              {item.deliveryValues?.map((value, index) => (
                                <li
                                  key={index}
                                  className="flex items-start justify-between gap-2 border-t border-success/20 pt-2 first:border-t-0 first:pt-0"
                                >
                                  <p className="min-w-0 break-all text-sm font-medium text-ink">{value}</p>
                                  <CopyText value={value} label={t('orders.copyValue')} title={t('orders.copyTitle')} />
                                </li>
                              ))}
                            </ol>
                          ) : item.deliveryValue ? (
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 break-all text-sm font-medium text-ink">
                                {item.deliveryValue}
                              </p>
                              <CopyText value={item.deliveryValue} label={t('orders.copyValue')} title={t('orders.copyTitle')} />
                            </div>
                          ) : null}
                        </div>
                      )}
                      {item.fulfillment && item.fulfillment.status !== 'DELIVERED' && (
                        <p className="mt-1 text-xs text-soft">
                          {t('orders.deliveryStatusLabel')}: {item.fulfillment.status.toLowerCase().replace('_', ' ')}
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

          <section className="rounded-2xl card-cosmic p-4 sm:p-5">
            <h2 className="font-semibold text-ink">{t('orders.summary')}</h2>
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-soft">{t('orders.subtotal')}</span>
                <span className="text-ink">
                  {Number(order.subtotal).toFixed(2)} {order.currency}
                </span>
              </div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-soft">{t('orders.discount')}</span>
                  <span className="text-success">
                    - {Number(order.discount).toFixed(2)} {order.currency}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2">
                <span className="font-medium text-ink">{t('cart.total')}</span>
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

          {order.status === 'COMPLETED' && order.items.length > 0 && (
            <section className="rounded-2xl card-cosmic p-4 sm:p-5">
              <Link
                href="/store"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet px-4 py-3 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <TranslatedText k="orders.buyAgain" />
              </Link>
            </section>
          )}

          {(() => {
            const supportUrl = getOrderSupportUrl(order.orderNumber);
            if (!supportUrl) return null;
            return (
              <section className="rounded-2xl card-cosmic p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{t('orders.needHelp')}</p>
                    <p className="mt-0.5 text-sm text-soft">
                      {t('orders.contactOnTelegram', { orderNumber: String(order.orderNumber) })}
                    </p>
                  </div>
                  <a
                    href={supportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet px-4 py-2 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95"
                  >
                    {t('orders.contactSupport')}
                  </a>
                </div>
              </section>
            );
          })()}

          {order.items.some((item) => item.manualDelivery === undefined && order.status === 'FULFILLING') && (
            <section className="rounded-2xl card-cosmic p-4 sm:p-5 border border-primary/20 bg-primary/5">
              <p className="text-sm text-soft">
                {t('orders.handDeliveryPending') ?? 'Your order is being prepared. An admin will deliver your product shortly. You will see the delivery content here once it is ready.'}
              </p>
            </section>
          )}

          <section className="rounded-2xl card-cosmic p-4 sm:p-5">
            <h2 className="font-semibold text-ink">{t('orders.information')}</h2>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="text-soft">{t('orders.orderId')}</span>
                <span className="flex min-w-0 items-start justify-end gap-2">
                  <span className="min-w-0 break-all font-mono text-xs text-ink">{order.id}</span>
                  <CopyText value={order.id} label={t('orders.copyOrderId')} title={t('orders.copyOrderId')} />
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-soft">{t('orders.status')}</span>
                <span className="capitalize text-ink">
                  {order.status.toLowerCase().replace('_', ' ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-soft">{t('orders.created')}</span>
                <span className="text-ink">{formatDateTime(order.createdAt)}</span>
              </div>
              {order.paidAt && (
                <div className="flex justify-between">
                  <span className="text-soft">{t('orders.paid')}</span>
                  <span className="text-ink">{formatDateTime(order.paidAt)}</span>
                </div>
              )}
              {order.completedAt && (
                <div className="flex justify-between">
                  <span className="text-soft">{t('orders.completed')}</span>
                  <span className="text-ink">{formatDateTime(order.completedAt)}</span>
                </div>
              )}
              {order.cancelledAt && (
                <div className="flex justify-between">
                  <span className="text-soft">{t('orders.cancelled')}</span>
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
