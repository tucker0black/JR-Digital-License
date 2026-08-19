'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, Select, StatCard, StatusBadge, Table, formatDate, formatMoney } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { humanizeError } from '@/lib/errors';
import { expireOldAdminPayments, getAdminPayments, getDashboardStats } from '@/lib/api-admin';

const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'];
const PAYMENT_PROVIDERS = ['KHQR', 'BAKONG', 'WALLET', 'MANUAL'];

export default function AdminPaymentsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stats = useAsync(() => getDashboardStats(), []);
  const payments = useAsync(
    () => getAdminPayments({ page, pageSize: 20, status: status || undefined, provider: provider || undefined, search: search || undefined }),
    [page, status, provider, search]
  );

  const refresh = () => {
    stats.reload();
    payments.reload();
  };

  const handleExpire = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const result = await expireOldAdminPayments(15);
      setMessage(`Expired ${result.expiredCount} old payment session(s).`);
      refresh();
    } catch (err) {
      setError(humanizeError('Unable to expire payments', err));
    } finally {
      setBusy(false);
    }
  };

  if (stats.loading) return <LoadingState label="Loading payments…" />;
  if (stats.error) return <ErrorState error={stats.error} onRetry={refresh} />;

  const paymentsStats = stats.data!.payments;

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Payment sessions, providers and status"
        action={<Button variant="ghost" onClick={refresh}>Refresh</Button>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={paymentsStats.total} />
        <StatCard label="Pending" value={paymentsStats.pending} />
        <StatCard label="Succeeded" value={paymentsStats.succeeded} />
        <StatCard label="Failed / expired" value={paymentsStats.failed + paymentsStats.expired} />
      </div>

      {message && <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{message}</p>}
      {error && <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <Card title="Maintenance" description="Expire pending payment sessions older than 15 minutes so they cannot be reused." className="mt-4">
        <Button variant="ghost" disabled={busy} onClick={handleExpire}>
          {busy ? 'Expiring…' : 'Expire old payments'}
        </Button>
      </Card>

      <Card title="All payments" className="mt-4">
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <input
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            placeholder="Search reference, provider ID or order #…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
            <option value="">All providers</option>
            {PAYMENT_PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </div>

        {payments.error ? (
          <ErrorState error={payments.error} onRetry={payments.reload} />
        ) : payments.loading ? (
          <LoadingState label="Loading payments…" />
        ) : payments.data && payments.data.payments.length > 0 ? (
          <>
            <Table headers={['Reference', 'Order', 'Customer', 'Provider', 'Amount', 'Status', 'Created']}>
              {payments.data.payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="max-w-40 truncate px-3 py-2 text-slate-300" title={payment.reference}>{payment.reference}</td>
                  <td className="px-3 py-2">
                    {payment.order ? (
                      <Link href={`/admin/orders/${payment.order.id}`} className="text-cyan-400 hover:underline">
                        #{payment.order.orderNumber}
                      </Link>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {payment.user ? `${payment.user.firstName} ${payment.user.lastName ?? ''}` : '—'}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={payment.provider} /></td>
                  <td className="px-3 py-2 text-slate-200">{formatMoney(payment.amount, payment.currency)}</td>
                  <td className="px-3 py-2"><StatusBadge status={payment.status} /></td>
                  <td className="px-3 py-2 text-slate-400">{formatDate(payment.createdAt)}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={payments.data.page} total={payments.data.total} pageSize={payments.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No payments found" message="Adjust filters." />
        )}
      </Card>
    </div>
  );
}