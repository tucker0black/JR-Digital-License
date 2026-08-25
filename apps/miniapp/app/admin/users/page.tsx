'use client';

import { useState } from 'react';
import type { User, UserDetail } from '@jr/shared';
import { Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Pagination, Select, StatusBadge, Table, formatDate } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { getAdminUser, getAdminUsers, setAdminUserStatus } from '@/lib/api-admin';

export default function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const users = useAsync(
    () => getAdminUsers({ page, pageSize: 20, search: search || undefined, status: status || undefined }),
    [page, search, status]
  );
  const detail = useAsync(() => (selectedId ? getAdminUser(selectedId) : Promise.resolve(null)), [selectedId]);

  const refresh = () => {
    users.reload();
    detail.reload();
  };

  const handleStatusChange = async (user: User, nextStatus: string) => {
    const reason = nextStatus === 'ACTIVE' ? undefined : window.prompt(`Reason for ${nextStatus.toLowerCase()}? (recorded in audit log)`);
    if (nextStatus !== 'ACTIVE' && reason === null) return;
    try {
      await setAdminUserStatus(user.id, nextStatus, reason || undefined);
      refresh();
    } catch {
      // user status change failed; the error surfaces on next reload
    }
  };

  if (users.loading) return <LoadingState label="Loading users…" />;
  if (users.error) return <ErrorState error={users.error} onRetry={refresh} />;

  return (
    <div>
      <PageHeader title="Users" description="Customer accounts and account status" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Input
          placeholder="Search name, username, Telegram ID or customer ID…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="BANNED">BANNED</option>
        </Select>
      </div>

      <Card>
        {users.data && users.data.users.length > 0 ? (
          <>
            <Table headers={['User', 'Customer ID', 'Status', 'Last seen', 'Actions']}>
              {users.data.users.map((user) => (
                <tr key={user.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-200">
                      {user.firstName} {user.lastName ?? ''}
                    </p>
                    <p className="text-xs text-slate-500">{user.username ? `@${user.username}` : 'no username'}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-slate-300">{user.customerId}</p>
                    <p className="text-xs text-slate-500">{user.telegramId}</p>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={user.status} /></td>
                  <td className="px-3 py-2 text-slate-400">{formatDate(user.lastSeenAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="ghost" onClick={() => setSelectedId(selectedId === user.id ? null : user.id)}>
                        {selectedId === user.id ? 'Close' : 'View'}
                      </Button>
                      {user.status !== 'ACTIVE' ? (
                        <Button variant="subtle" onClick={() => handleStatusChange(user, 'ACTIVE')}>Reactivate</Button>
                      ) : (
                        <>
                          <Button variant="ghost" onClick={() => handleStatusChange(user, 'SUSPENDED')}>Suspend</Button>
                          <Button variant="danger" onClick={() => handleStatusChange(user, 'BANNED')}>Ban</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={users.data.page} total={users.data.total} pageSize={users.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No users found" message="Adjust filters." />
        )}
      </Card>

      {selectedId && detail.loading && <LoadingState label="Loading user details…" />}
      {selectedId && detail.error && <ErrorState error={detail.error} onRetry={detail.reload} />}
      {selectedId && detail.data && <UserDetailCard user={detail.data} />}
    </div>
  );
}

function UserDetailCard({ user }: { user: UserDetail }) {
  return (
    <Card title={`${user.firstName} ${user.lastName ?? ''}`} description={user.username ? `@${user.username}` : undefined} className="mt-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Internal customer ID">
          <p className="break-all text-sm text-slate-200">{user.id}</p>
        </Field>
        <Field label="Customer ID">
          <p className="text-sm text-slate-200">{user.customerId}</p>
        </Field>
        <Field label="Telegram ID">
          <p className="text-sm text-slate-200">{user.telegramId}</p>
        </Field>
        <Field label="Status">
          <StatusBadge status={user.status} />
        </Field>
        <Field label="Last seen">
          <p className="text-sm text-slate-200">{formatDate(user.lastSeenAt)}</p>
        </Field>
        <Field label="Wallet balance">
          <p className="text-sm text-slate-200">
            {user.wallet ? `${user.wallet.currency} ${Number(user.wallet.balance).toFixed(2)}` : 'No wallet yet'}
          </p>
        </Field>
        <Field label="Orders">
          <p className="text-sm text-slate-200">{user.totalOrders}</p>
        </Field>
        <Field label="Payments">
          <p className="text-sm text-slate-200">{user.paymentCount}</p>
        </Field>
        <Field label="Purchased items">
          <p className="text-sm text-slate-200">{user.totalItemsPurchased}</p>
        </Field>
        <Field label="Total deposited">
          <p className="text-sm text-slate-200">
            {user.totalDeposited} {user.wallet?.currency ?? 'USD'}
          </p>
        </Field>
        <Field label="Support tickets">
          <p className="text-sm text-slate-200">{user.ticketCount}</p>
        </Field>
        <Field label="Joined">
          <p className="text-sm text-slate-200">{formatDate(user.createdAt)}</p>
        </Field>
        {user.photoUrl && (
          <Field label="Profile photo">
            <img src={user.photoUrl} alt="profile" className="h-12 w-12 rounded-full" />
          </Field>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Recent paid orders</p>
          {user.activity.recentOrders.length > 0 ? (
            <div className="space-y-2">
              {user.activity.recentOrders.map((order) => (
                <div key={order.id} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
                  <p className="text-slate-200">Order #{order.orderNumber} · {order.status}</p>
                  <p className="text-xs text-slate-500">{order.total} {order.currency} · {formatDate(order.createdAt)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No paid orders.</p>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Recent support tickets</p>
          {user.activity.recentTickets.length > 0 ? (
            <div className="space-y-2">
              {user.activity.recentTickets.map((ticket) => (
                <div key={ticket.id} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
                  <p className="text-slate-200">Ticket #{ticket.number} · {ticket.subject}</p>
                  <p className="text-xs text-slate-500">{ticket.status} · {formatDate(ticket.createdAt)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No support tickets.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
