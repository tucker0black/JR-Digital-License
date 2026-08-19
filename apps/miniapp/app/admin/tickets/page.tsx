'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import type { TicketDetail } from '@jr/shared';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Pagination, Select, StatusBadge, Table, Textarea, formatDate } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { humanizeError } from '@/lib/errors';
import { getAdminTicket, getAdminTickets, replyAdminTicket, setAdminTicketStatus } from '@/lib/api-admin';

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'];

export default function AdminTicketsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tickets = useAsync(
    () => getAdminTickets({ page, pageSize: 20, search: search || undefined, status: (status as never) || undefined }),
    [page, search, status]
  );

  const refresh = () => tickets.reload();

  if (tickets.loading) return <LoadingState label="Loading tickets…" />;
  if (tickets.error) return <ErrorState error={tickets.error} onRetry={refresh} />;

  return (
    <div>
      <PageHeader title="Tickets" description="Customer support tickets" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Input placeholder="Search subject or username…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      <Card>
        {tickets.data && tickets.data.tickets.length > 0 ? (
          <>
            <Table headers={['Subject', 'Customer', 'Order', 'Status', 'Messages', 'Updated', 'Actions']}>
              {tickets.data.tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="max-w-56 truncate px-3 py-2 font-medium text-slate-200">{ticket.subject}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {ticket.user ? (
                      <>
                        {ticket.user.displayName ?? 'Not available'}
                        {ticket.user.usernameHandle ? (
                          <span className="text-slate-500"> {ticket.user.usernameHandle}</span>
                        ) : null}
                      </>
                    ) : 'Not available'}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{ticket.order ? `#${ticket.order.orderNumber}` : '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={ticket.status} /></td>
                  <td className="px-3 py-2 text-slate-400">
                    {ticket.messageCount}
                    {ticket.unreadCount ? (
                      <span className="ml-2 inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">
                        {ticket.unreadCount}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{formatDate(ticket.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <Button variant="ghost" onClick={() => setSelectedId(selectedId === ticket.id ? null : ticket.id)}>
                      {selectedId === ticket.id ? 'Close' : 'Open'}
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={tickets.data.page} total={tickets.data.total} pageSize={tickets.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No tickets found" message="Support tickets opened by customers appear here." />
        )}
      </Card>

      {selectedId && <TicketThread ticketId={selectedId} onChanged={refresh} />}
    </div>
  );
}

function TicketThread({ ticketId, onChanged }: { ticketId: string; onChanged: () => void }) {
  const detail = useAsync(() => getAdminTicket(ticketId), [ticketId]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReply = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await replyAdminTicket(ticketId, reply);
      setReply('');
      detail.reload();
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to reply', err));
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (nextStatus: string) => {
    setError(null);
    try {
      await setAdminTicketStatus(ticketId, nextStatus as never);
      detail.reload();
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to change ticket status', err));
    }
  };

  if (detail.loading) return <LoadingState label="Loading ticket…" />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={detail.reload} />;

  const ticket = detail.data as TicketDetail;
  const customer = ticket.user;

  return (
    <div className="mt-4">
      <Card
        title={`Ticket #${ticket.number}`}
        description={
          <span className="text-slate-400">
            {ticket.subject}
            {customer ? (
              <>
                {' · '}
                {customer.displayName ?? 'Not available'}
                {customer.usernameHandle ? ` (${customer.usernameHandle})` : ''}
              </>
            ) : null}
            {ticket.order ? ` · Order #${ticket.order.orderNumber}` : ''}
          </span>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={ticket.status} />
          {TICKET_STATUSES.filter((s) => s !== ticket.status).map((s) => (
            <Button key={s} variant="ghost" onClick={() => handleStatus(s)}>Set {s}</Button>
          ))}
        </div>

        <div className="mb-4 grid gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Customer name</p>
            <p className="text-slate-200">{customer?.displayName ?? 'Not available'}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Telegram username</p>
            <p className="text-slate-200">{customer?.usernameHandle ?? 'Not available'}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Telegram user ID</p>
            <p className="font-mono text-slate-200">{customer?.telegramId ?? 'Not available'}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Internal customer ID</p>
            <p className="break-all font-mono text-slate-200">{customer?.id ?? 'Not available'}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Linked order</p>
            <p className="text-slate-200">
              {ticket.order ? (
                <a
                  href={`/admin/orders/${ticket.order.id}`}
                  className="text-cyan-400 transition hover:text-cyan-300"
                >
                  Order #{ticket.order.orderNumber}
                </a>
              ) : (
                'Not available'
              )}
            </p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Ticket status</p>
            <p className="text-slate-200">{ticket.status.replace('_', ' ')}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Created</p>
            <p className="text-slate-200">{formatDate(ticket.createdAt)}</p>
          </div>
        </div>

        <div className="space-y-3">
          {ticket.messages.map((message) => {
            const sender = message.sender ?? (message.fromAdmin ? 'ADMIN' : 'USER');
            return (
              <div
                key={message.id}
                className={`rounded-lg border p-3 ${
                  sender === 'ADMIN'
                    ? 'border-cyan-500/30 bg-cyan-500/10'
                    : sender === 'SYSTEM'
                      ? 'border-slate-700 bg-slate-900/60'
                      : 'border-slate-700 bg-slate-900'
                }`}
              >
                <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {sender === 'ADMIN' ? (
                      <Badge tone="accent">{message.adminName ?? 'Admin'}</Badge>
                    ) : sender === 'SYSTEM' ? (
                      <Badge>System</Badge>
                    ) : (
                      <Badge>Customer</Badge>
                    )}
                    {sender === 'ADMIN' && <span className="ml-2 text-slate-400">Support reply</span>}
                    <span className="ml-2">{formatDate(message.createdAt)}</span>
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-200">{message.body}</p>
              </div>
            );
          })}
        </div>

        {ticket.status !== 'CLOSED' && (
          <form onSubmit={handleReply} className="mt-4 space-y-3">
            <Field label="Reply to customer">
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} required maxLength={4000} placeholder="Type your reply…" />
            </Field>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" disabled={busy || !reply.trim()}>
              {busy ? 'Sending…' : 'Send reply'}
            </Button>
          </form>
        )}
        {ticket.status === 'CLOSED' && <p className="mt-4 text-sm text-slate-500">Ticket is closed — reopen it with Set OPEN to reply.</p>}
      </Card>
    </div>
  );
}