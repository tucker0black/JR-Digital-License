'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createTicket,
  getTicket,
  getTickets,
  getOrders,
  replyToTicket,
  type SupportTicket,
  type SupportTicketDetail
} from '@/lib/api';
import { StoreHeader } from '@/components/StoreHeader';
import { SUPPORT_READ_EVENT } from '@/components/BottomNav';
import { formatDateTime, formatRelative } from '@/lib/format';
import { getSupportTelegramUrl } from '@/lib/support';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';

const supportUrl = getSupportTelegramUrl();

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-primary/15 text-primary border-primary/30',
  IN_PROGRESS: 'bg-warning/15 text-warning border-warning/30',
  WAITING_FOR_CUSTOMER: 'bg-violet/15 text-violet border-violet/30',
  RESOLVED: 'bg-success/15 text-success border-success/30',
  CLOSED: 'bg-muted text-soft border-line'
};

export default function SupportPage() {
  const { status: telegramStatus } = useTelegramAuth();
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

  const loadTickets = useCallback(async () => {
    try {
      const result = await getTickets();
      setTickets(result.tickets);
      setError(null);
      window.dispatchEvent(new Event(SUPPORT_READ_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load support tickets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    void loadTickets();
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
      setError(err instanceof Error ? err.message : 'Unable to load ticket');
    } finally {
      setTicketLoading(false);
    }
  }, []);

  const handleCreate = async () => {
    if (!subject.trim()) {
      setFormError('Subject is required');
      return;
    }
    if (!message.trim()) {
      setFormError('Message is required');
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
      setFormError(err instanceof Error ? err.message : 'Unable to create ticket');
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
      setError(err instanceof Error ? err.message : 'Unable to send message');
    } finally {
      setSending(false);
    }
  };

  if (telegramStatus !== 'ready') {
    return (
      <main className="min-h-screen bg-page text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
          <TelegramAuthNotice />
        </div>
      </main>
    );
  }

  if (activeTicketId) {
    const statusStyle = STATUS_STYLES[activeTicket?.status ?? ''] ?? STATUS_STYLES.OPEN;
    return (
      <main className="min-h-screen bg-page text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
          <button
            type="button"
            onClick={() => {
              setActiveTicketId(null);
              setActiveTicket(null);
              void loadTickets();
            }}
            className="inline-flex items-center gap-1 text-sm text-soft transition hover:text-primary"
          >
            ← Back to tickets
          </button>

          {ticketLoading && !activeTicket ? (
            <p className="mt-6 text-sm text-soft">Loading ticket…</p>
          ) : activeTicket ? (
            <div className="animate-fade-up mt-4 space-y-4">
              <section className="rounded-2xl border border-line bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-lg font-bold tracking-tight text-ink">
                      Ticket #{activeTicket.number}
                      <span className="ml-2 text-sm font-normal text-soft">{activeTicket.subject}</span>
                    </h1>
                    <p className="mt-1 text-xs text-soft">
                      {activeTicket.order
                        ? `Linked to order #${activeTicket.order.orderNumber}`
                        : 'No linked order'}
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
                            ? 'border-primary/30 bg-primary-soft/60 ml-6'
                            : 'border-line bg-card mr-6'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between text-xs text-soft">
                        <span className="font-medium">
                          {isSystem
                            ? 'System'
                            : isAdmin
                              ? (msg.adminName ?? 'Support')
                              : 'You'}
                        </span>
                        <span title={formatDateTime(msg.createdAt)}>{formatRelative(msg.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{msg.body}</p>
                    </div>
                  );
                })}
              </section>

              {activeTicket.status !== 'CLOSED' && (
                <section className="rounded-2xl border border-line bg-card p-4">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Write a reply…"
                    rows={3}
                    className="w-full rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => void handleReply()}
                    disabled={sending || !reply.trim()}
                    className="mt-3 rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
                  >
                    {sending ? 'Sending…' : 'Send Reply'}
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
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <section className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Support</h1>
            <p className="mt-1 text-sm text-soft">
              Ask a question or report an issue with your order
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowNew(!showNew);
              setFormError(null);
            }}
            className="rounded-xl bg-primary px-4 py-2 font-medium text-white shadow-sm shadow-primary/30 transition hover:bg-primary-dark"
          >
            {showNew ? 'Close' : 'New Ticket'}
          </button>
        </section>

        {supportUrl && (
          <section className="mt-4 rounded-2xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-ink">Need help? Contact Support</p>
                <p className="mt-0.5 text-sm text-soft">
                  Chat with us directly on Telegram for faster help.
                </p>
              </div>
              <a
                href={supportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm shadow-primary/30 transition hover:bg-primary-dark"
              >
                Open Telegram
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
          <section className="animate-fade-up mt-4 rounded-2xl border border-line bg-card p-5">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-soft">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. My order was not delivered"
                  maxLength={200}
                  className="w-full rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-soft">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your issue…"
                  rows={4}
                  maxLength={4000}
                  className="w-full rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-soft">Linked order (optional)</label>
                <select
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  className="w-full rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                >
                  <option value="">No order</option>
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
                className="rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create Ticket'}
              </button>
            </div>
          </section>
        )}

        <section className="mt-6">
          <h2 className="text-lg font-bold tracking-tight text-ink">Your tickets</h2>
          {loading ? (
            <p className="mt-3 text-sm text-soft">Loading…</p>
          ) : tickets.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-line bg-card p-6 text-center text-sm text-soft">
              No support tickets yet.
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => void openTicket(ticket.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        <span className="text-soft">#{ticket.number}</span> {ticket.subject}
                      </p>
                      <p className="mt-0.5 text-xs text-soft">
                        {ticket.order ? `Order #${ticket.order.orderNumber} · ` : ''}
                        {ticket.messageCount} message{ticket.messageCount === 1 ? '' : 's'} ·{' '}
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
