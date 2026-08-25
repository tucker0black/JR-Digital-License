'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createTicket,
  getTicket,
  getTickets,
  getOrders,
  getMe,
  getSupportAvailability,
  replyToTicket,
  type SupportTicket,
  type SupportTicketDetail,
  type SupportAvailability
} from '@/lib/api';
import { StoreHeader } from '@/components/StoreHeader';
import { Skeleton, RowSkeleton } from '@/components/Skeleton';
import { SUPPORT_READ_EVENT } from '@/components/BottomNav';
import { useTranslation } from '@/lib/i18n';
import { formatDateTime, formatRelative } from '@/lib/format';
import { getSupportTelegramUrl } from '@/lib/support';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';

const supportUrl = getSupportTelegramUrl();

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-primary/15 text-primary border-primary/20',
  IN_PROGRESS: 'bg-warning/15 text-warning border-warning/20',
  WAITING_FOR_CUSTOMER: 'bg-violet/15 text-violet border-violet/20',
  RESOLVED: 'bg-success/15 text-success border-success/20',
  CLOSED: 'bg-muted/60 text-soft border-line/30'
};

export default function SupportPage() {
  const { status: telegramStatus } = useTelegramAuth();
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [orderId, setOrderId] = useState('');
  const [orders, setOrders] = useState<Array<{ id: string; orderNumber: number }>>([]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [activeTicket, setActiveTicket] = useState<SupportTicketDetail | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [availability, setAvailability] = useState<SupportAvailability | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    try {
      const result = await getTickets();
      setTickets(result.tickets);
      setError(null);
      window.dispatchEvent(new Event(SUPPORT_READ_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('store.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    void loadTickets();
    getSupportAvailability()
      .then(setAvailability)
      .catch(() => setAvailability(null));
    getMe()
      .then((result) => setCustomerId(result.user.customerId))
      .catch(() => setCustomerId(null));
    getOrders({ pageSize: 10 })
      .then((result) => setOrders(result.orders.map((order) => ({ id: order.id, orderNumber: order.orderNumber }))))
      .catch(() => setOrders([]));
  }, [loadTickets, telegramStatus]);

  const openTicket = useCallback(async (id: string) => {
    setActiveTicketId(id);
    setTicketLoading(true);
    setActiveTicket(null);
    try {
      const result = await getTicket(id);
      setActiveTicket(result.ticket);
      window.dispatchEvent(new Event(SUPPORT_READ_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('store.unableToLoad'));
    } finally {
      setTicketLoading(false);
    }
  }, []);

  const handleCreate = async () => {
    if (!subject.trim()) {
      setFormError(t('support.subjectRequired'));
      return;
    }
    if (!message.trim()) {
      setFormError(t('support.messageRequired'));
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      const result = await createTicket({
        subject: subject.trim(),
        body: message.trim(),
        orderId: orderId || undefined
      });
      setShowNew(false);
      setSubject('');
      setMessage('');
      setOrderId('');
      await loadTickets();
      await openTicket(result.ticket.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('store.unableToLoad'));
    } finally {
      setCreating(false);
    }
  };

  const handleReply = async () => {
    if (!activeTicket || !reply.trim()) return;
    setSending(true);
    try {
      await replyToTicket(activeTicket.id, reply.trim());
      setReply('');
      await openTicket(activeTicket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('store.unableToLoad'));
    } finally {
      setSending(false);
    }
  };

  if (telegramStatus !== 'ready') {
    return (
      <main className="min-h-screen bg-page bg-cosmic text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 md:pb-16">
          <TelegramAuthNotice />
        </div>
      </main>
    );
  }

  if (activeTicketId) {
    const statusStyle = STATUS_STYLES[activeTicket?.status ?? ''] ?? STATUS_STYLES.OPEN;
    return (
      <main className="min-h-screen bg-page bg-cosmic text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 md:pb-16">
          <button
            type="button"
            onClick={() => {
              setActiveTicketId(null);
              setActiveTicket(null);
              void loadTickets();
            }}
            className="inline-flex items-center gap-1 text-sm text-soft transition-default hover:text-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            {t('support.backToTickets')}
          </button>

          {ticketLoading && !activeTicket ? (
            <div className="mt-6 space-y-3" aria-hidden="true">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <RowSkeleton />
              <RowSkeleton />
            </div>
          ) : activeTicket ? (
            <div className="animate-fade-up mt-4 space-y-4">
              <section className="rounded-2xl card-cosmic p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-lg font-bold tracking-tight text-ink">
                      {t('support.ticket', { number: activeTicket.number })}
                      <span className="ml-2 text-sm font-normal text-soft">{activeTicket.subject}</span>
                    </h1>
                    <p className="mt-1 text-xs text-soft">
                      {activeTicket.order
                        ? t('support.linkedToOrder', { orderNumber: String(activeTicket.order.orderNumber) })
                        : t('support.noLinkedOrder')}
                      {' · '}{formatDateTime(activeTicket.createdAt)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${statusStyle}`}>
                    {activeTicket.status.replace('_', ' ')}
                  </span>
                </div>
              </section>

              <section className="space-y-3">
                {activeTicket.messages.map((msg) => {
                  const isSystem = msg.sender === 'SYSTEM';
                  const isAdmin = msg.sender === 'ADMIN' || msg.fromAdmin;
                  return (
                    <div
                      key={msg.id}
                      className={`rounded-2xl border p-4 ${
                        isSystem
                          ? 'border-line bg-muted/60 mx-2'
                          : isAdmin
                            ? 'border-primary/30 bg-primary/5 ml-6'
                            : 'border-line bg-card mr-6'
                      }`}
                    >
                      <div className="mb-1.5 flex items-center justify-between text-xs text-soft">
                        <span className="font-medium">
                          {isSystem
                            ? t('support.system')
                            : isAdmin
                              ? (msg.adminName ?? t('nav.support'))
                              : t('support.you')}
                        </span>
                        <span title={formatDateTime(msg.createdAt)}>{formatRelative(msg.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{msg.body}</p>
                    </div>
                  );
                })}
              </section>

              {activeTicket.status !== 'CLOSED' && (
                <section className="rounded-2xl card-cosmic p-4">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={t('support.writeReply')}
                    rows={3}
                    className="w-full rounded-xl border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                  <button
                    type="button"
                    onClick={() => void handleReply()}
                    disabled={sending || !reply.trim()}
                    className="mt-3 rounded-xl bg-gradient-to-r from-primary to-violet px-5 py-2.5 font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95 disabled:opacity-50"
                  >
                    {sending ? t('support.sending') : t('support.sendReply')}
                  </button>
                </section>
              )}
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 md:pb-16">
        <section className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{t('support.title')}</h1>
            <p className="mt-1 text-sm text-soft">
{t('support.subtitle')}
            </p>
            {customerId && <p className="mt-0.5 text-xs text-soft">{t('generic.customerID', { id: customerId })}</p>}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowNew(!showNew);
              setFormError(null);
            }}
            className="rounded-xl bg-gradient-to-r from-primary to-violet px-4 py-2 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95"
          >
            {showNew ? t('support.close') : t('support.newTicket')}
          </button>
        </section>

        {availability && (
          <section
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
              availability.isOpen
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-warning/30 bg-warning/10 text-warning'
            }`}
          >
            {availability.isOpen ? (
              <>
                <span className="font-medium">{t('support.supportOnline')}</span>{' '}
                <span className="opacity-90">
                  {t('support.hours', {
                    openTime: availability.openTime,
                    closeTime: availability.closeTime,
                    timezone: availability.timezoneLabel
                  })}
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">{t('support.supportOffline')}</span>{' '}
                <span className="opacity-90">
                  {t('support.hours', {
                    openTime: availability.openTime,
                    closeTime: availability.closeTime,
                    timezone: availability.timezoneLabel
                  })}{' '}
                  {t('support.offlineNote')}
                </span>
              </>
            )}
          </section>
        )}

        {supportUrl && (
          <section className="mt-4 rounded-2xl card-cosmic p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-ink">{t('support.needHelp')}</p>
                <p className="mt-0.5 text-sm text-soft">
{t('support.chatOnTelegram')}
                </p>
              </div>
              <a
                href={supportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet px-4 py-2 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95"
              >
{t('support.openTelegram')}
              </a>
            </div>
          </section>
        )}

        {error && (
          <div className="mt-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            {error}
          </div>
        )}

        {showNew && (
          <section className="animate-fade-up mt-4 rounded-2xl card-cosmic p-5">
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-soft">{t('support.subject')}</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={t('support.subjectPlaceholder')}
                  maxLength={200}
                  className="w-full rounded-xl border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-soft">{t('support.message')}</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t('support.messagePlaceholder')}
                  rows={4}
                  maxLength={4000}
                  className="w-full rounded-xl border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-soft">{t('support.linkedOrder')}</label>
                <select
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  className="w-full rounded-xl border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
                >
                  <option value="">{t('support.noOrder')}</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>Order #{order.orderNumber}</option>
                  ))}
                </select>
              </div>
              {formError && <p className="text-sm text-danger">{formError}</p>}
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating}
                className="rounded-xl bg-gradient-to-r from-primary to-violet px-5 py-2.5 font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95 disabled:opacity-50"
              >
                {creating ? t('support.creating') : t('support.createTicket')}
              </button>
            </div>
          </section>
        )}

        <section className="mt-6">
          <h2 className="text-lg font-bold tracking-tight text-ink">{t('support.yourTickets')}</h2>
          {loading ? (
            <div className="mt-3 space-y-2" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <RowSkeleton key={i} />
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <div className="mt-3 rounded-2xl card-cosmic p-6 text-center text-sm text-soft">
{t('support.noTickets')}
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => void openTicket(ticket.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl card-cosmic p-4 text-left transition-default hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        <span className="text-soft">#{ticket.number}</span> {ticket.subject}
                      </p>
                      <p className="mt-0.5 text-xs text-soft">
                        {ticket.order ? `Order #${ticket.order.orderNumber} · ` : ''}
                        {ticket.messageCount} {t('support.messages')}{ticket.messageCount === 1 ? '' : 's'} ·{' '}
                        {formatRelative(ticket.updatedAt)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[ticket.status] ?? STATUS_STYLES.OPEN}`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
