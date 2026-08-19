'use client';

import { useState } from 'react';
import { Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Pagination, Select, Table, formatDate } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { getAdminAuditLogs } from '@/lib/api-admin';

const ENTITY_TYPES = ['Product', 'Category', 'Order', 'Stock'];

function summarize(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');

  const logs = useAsync(
    () =>
      getAdminAuditLogs({
        page,
        pageSize: 50,
        entityType: entityType || undefined,
        action: action || undefined,
        entityId: entityId || undefined
      }),
    [page, entityType, action, entityId]
  );

  if (logs.loading) return <LoadingState label="Loading audit logs…" />;
  if (logs.error) return <ErrorState error={logs.error} onRetry={logs.reload} />;

  return (
    <div>
      <PageHeader title="Audit Logs" description="Every important admin action, with old and new values" />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
          <option value="">All entity types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <Input
          placeholder="Action (e.g. UPDATE, PRICE_CHANGED)"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
        />
        <Input
          placeholder="Entity ID (filter)"
          value={entityId}
          onChange={(e) => { setEntityId(e.target.value); setPage(1); }}
        />
      </div>

      <Card>
        {logs.data && logs.data.logs.length > 0 ? (
          <>
            <Table headers={['When', 'Admin', 'Entity', 'Action', 'Changes']}>
              {logs.data.logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400">{formatDate(log.createdAt)}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {log.admin ? `${log.admin.firstName} ${log.admin.lastName ?? ''}`.trim() || 'Admin' : 'System'}
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-slate-300">{log.entityType}</p>
                    <p className="text-xs text-slate-500">{log.entityId?.slice(0, 8) ?? '—'}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-medium text-cyan-300">{log.action}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="max-w-80 text-xs text-slate-400">
                      {log.oldValue !== null && log.oldValue !== undefined && (
                        <p><span className="text-red-400 line-through">{summarize(log.oldValue)}</span></p>
                      )}
                      {log.newValue !== null && log.newValue !== undefined && (
                        <p><span className="text-emerald-400">{summarize(log.newValue)}</span></p>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={logs.data.page} total={logs.data.total} pageSize={logs.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No audit entries found" message="Adjust filters." />
        )}
      </Card>
    </div>
  );
}