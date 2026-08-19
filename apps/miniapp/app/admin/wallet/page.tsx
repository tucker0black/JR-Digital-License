'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Pagination, Select, Table, formatDate, formatMoney } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { humanizeError } from '@/lib/errors';
import { adjustAdminWalletBalance, getAdminWalletDetail, getAdminWallets } from '@/lib/api-admin';

export default function AdminWalletPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const wallets = useAsync(
    () => getAdminWallets({ page, pageSize: 20, search: search || undefined }),
    [page, search]
  );
  const detail = useAsync(() => (selectedUserId ? getAdminWalletDetail(selectedUserId) : Promise.resolve(null)), [selectedUserId]);

  const refresh = () => {
    wallets.reload();
    detail.reload();
  };

  const openWallet = (userId: string) => {
    setSelectedUserId(selectedUserId === userId ? null : userId);
  };

  if (wallets.loading) return <LoadingState label="Loading wallets…" />;
  if (wallets.error) return <ErrorState error={wallets.error} onRetry={refresh} />;

  return (
    <div>
      <PageHeader title="Wallet" description="Customer balances and wallet transactions" />

      <div className="mb-4">
        <Input
          placeholder="Search by name, username or Telegram ID…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <Card>
        {wallets.data && wallets.data.wallets.length > 0 ? (
          <>
            <Table headers={['User', 'Balance', 'Updated', 'Actions']}>
              {wallets.data.wallets.map((wallet) => (
                <tr key={wallet.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-200">
                      {wallet.user ? `${wallet.user.firstName} ${wallet.user.lastName ?? ''}` : 'Unknown user'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {wallet.user ? (wallet.user.username ? `@${wallet.user.username}` : wallet.user.telegramId) : wallet.userId}
                    </p>
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-100">{formatMoney(wallet.balance, wallet.currency)}</td>
                  <td className="px-3 py-2 text-slate-400">{formatDate(wallet.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <Button variant="ghost" onClick={() => openWallet(wallet.userId)}>
                      {selectedUserId === wallet.userId ? 'Close' : 'View / Adjust'}
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={wallets.data.page} total={wallets.data.total} pageSize={wallets.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No wallets found" message="Wallets are created when a customer's balance is first touched." />
        )}
      </Card>

      {selectedUserId && detail.loading && <LoadingState label="Loading wallet details…" />}
      {selectedUserId && detail.error && <ErrorState error={detail.error} onRetry={detail.reload} />}
      {selectedUserId && detail.data && (
        <WalletDetailCard
          userId={selectedUserId}
          balance={detail.data.wallet.balance}
          currency={detail.data.wallet.currency}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function WalletDetailCard({ userId, balance, currency, onChanged }: {
  userId: string;
  balance: string;
  currency: string;
  onChanged: () => void;
}) {
  const detail = useAsync(() => getAdminWalletDetail(userId), [userId]);
  const [type, setType] = useState<'ADJUSTMENT' | 'BONUS'>('ADJUSTMENT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdjust = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await adjustAdminWalletBalance(userId, type, amount, reason);
      setAmount('');
      setReason('');
      detail.reload();
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to apply wallet adjustment', err));
    } finally {
      setBusy(false);
    }
  };

  if (detail.loading) return <LoadingState label="Loading transactions…" />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={detail.reload} />;

  return (
    <Card
      title={`Wallet · ${currency} ${Number(balance).toFixed(2)}`}
      description="Every change creates a ledger transaction and an audit record"
      className="mt-4"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Manual adjustment</p>
          <form onSubmit={handleAdjust} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value as 'ADJUSTMENT' | 'BONUS')}>
                  <option value="ADJUSTMENT">ADJUSTMENT (±)</option>
                  <option value="BONUS">BONUS (+)</option>
                </Select>
              </Field>
              <Field label="Amount" hint="Use a negative value to deduct">
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  step="0.01"
                  required
                  placeholder={type === 'BONUS' ? '5.00' : '-2.00'}
                />
              </Field>
            </div>
            <Field label="Reason" hint="Required — recorded in the ledger and audit log">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} placeholder="e.g. compensation for failed delivery" />
            </Field>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" disabled={busy || !amount || !reason}>
              {busy ? 'Applying…' : 'Apply adjustment'}
            </Button>
          </form>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Recent transactions</p>
          {detail.data && detail.data.transactions.length > 0 ? (
            <Table headers={['Type', 'Amount', 'Balance', 'Reason', 'Date']}>
              {detail.data.transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="px-2 py-2"><Badge tone={tx.type === 'DEPOSIT' || tx.type === 'BONUS' ? 'success' : tx.type === 'PURCHASE' ? 'danger' : 'accent'}>{tx.type}</Badge></td>
                  <td className="px-2 py-2 text-slate-200">{Number(tx.amount) >= 0 ? '+' : ''}{Number(tx.amount).toFixed(2)}</td>
                  <td className="px-2 py-2 text-slate-400">{Number(tx.balanceAfter).toFixed(2)}</td>
                  <td className="max-w-40 truncate px-2 py-2 text-slate-400">{tx.reason ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{formatDate(tx.createdAt)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="text-sm text-slate-500">No transactions yet.</p>
          )}
          {detail.data && detail.data.totalTransactions > 100 && (
            <p className="mt-2 text-xs text-slate-500">Showing 100 of {detail.data.totalTransactions} transactions.</p>
          )}
        </div>
      </div>
    </Card>
  );
}