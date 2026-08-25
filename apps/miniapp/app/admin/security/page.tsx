'use client';

import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Pagination, Select, Table, formatDate } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { getAdminSecurityEvents, type SecurityEventEntry } from '@/lib/api-admin';

const EVENT_TYPES = [
  'AUTH_INVALID_INIT_DATA',
  'AUTH_SUSPENDED_ACCOUNT',
  'UNAUTHORIZED_ORDER_ACCESS',
  'UNAUTHORIZED_PAYMENT_ACCESS',
  'PAYMENT_REPLAY'
];

const SEVERITY_TONES: Record<string, 'success' | 'warning' | 'danger' | 'muted' | 'accent'> = {
  INFO: 'muted',
  WARNING: 'warning',
  CRITICAL: 'danger'
};

function summarizeMetadata(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function AdminSecurityPage() {
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');

  const events = useAsync(
    () =>
      getAdminSecurityEvents({
        page,
        pageSize: 50,
        eventType: eventType || undefined,
        severity: (severity as 'INFO' | 'WARNING' | 'CRITICAL') || undefined,
        search: search || undefined
      }),
    [page, eventType, severity, search]
  );

  if (events.loading) return <LoadingState label="Loading security events…" />;
  if (events.error) return <ErrorState error={events.error} onRetry={events.reload} />;

  return (
    <div>
      <PageHeader
        title="Security Events"
        description="Server-recorded suspicious activity (invalid auth, unauthorized access, payment replay)"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(1); }}>
          <option value="">All event types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <Select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}>
          <option value="">All severities</option>
          <option value="INFO">INFO</option>
          <option value="WARNING">WARNING</option>
          <option value="CRITICAL">CRITICAL</option>
        </Select>
        <Input
          placeholder="Search IP address or Telegram ID"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <Card>
        {events.data && events.data.events.length > 0 ? (
          <>
            <Table headers={['When', 'Event', 'Severity', 'User', 'IP address', 'Details']}>
              {events.data.events.map((event) => (
                <SecurityEventRow key={event.id} event={event} />
              ))}
            </Table>
            <Pagination page={events.data.page} total={events.data.total} pageSize={events.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No security events found" message="Suspicious activity will appear here." />
        )}
      </Card>
    </div>
  );
}

function SecurityEventRow({ event }: { event: SecurityEventEntry }) {
  return (
    <tr>
      <td className="px-3 py-2 whitespace-nowrap text-slate-400">{formatDate(event.createdAt)}</td>
      <td className="px-3 py-2">
        <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-medium text-cyan-300">{event.eventType}</span>
      </td>
      <td className="px-3 py-2">
        <Badge tone={SEVERITY_TONES[event.severity] ?? 'muted'}>{event.severity}</Badge>
      </td>
      <td className="px-3 py-2 text-slate-300">
        {event.user
          ? `${event.user.firstName} ${event.user.lastName ?? ''}`.trim() || (event.user.username ?? 'User')
          : '—'}
        {event.user && <p className="text-xs text-slate-500">{event.user.telegramId}</p>}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-slate-400">{event.ipAddress ?? '—'}</td>
      <td className="px-3 py-2 max-w-72 text-xs text-slate-400">{summarizeMetadata(event.metadata)}</td>
    </tr>
  );
}
