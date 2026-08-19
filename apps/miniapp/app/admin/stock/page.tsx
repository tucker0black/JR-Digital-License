'use client';

import { useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Field, LoadingState, PageHeader, Pagination, Select, StatCard, StatusBadge, Table, Textarea, formatDate } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import {
  createAdminStock,
  disableAdminStock,
  expireOldAdminStock,
  getAdminProducts,
  getAdminStock,
  getAdminStockSummary
} from '@/lib/api-admin';

const STOCK_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'DISABLED'];
const DELIVERY_TYPES = ['DIGITAL_LINK', 'DIGITAL_CODE', 'DIGITAL_TEXT', 'DIGITAL_FILE', 'DIGITAL_ACCOUNT'];

export default function AdminStockPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [productId, setProductId] = useState('');
  const [newProductId, setNewProductId] = useState('');
  const [newDeliveryType, setNewDeliveryType] = useState('DIGITAL_LINK');
  const [newValues, setNewValues] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const stock = useAsync(
    () => getAdminStock({ page, pageSize: 50, status: status || undefined, productId: productId || undefined }),
    [page, status, productId]
  );
  const summary = useAsync(() => getAdminStockSummary(), []);
  const products = useAsync(() => getAdminProducts({ pageSize: 100, status: 'ACTIVE' }), []);

  const refresh = () => {
    stock.reload();
    summary.reload();
    products.reload();
  };

  const clearAction = () => {
    setActionMessage(null);
    setActionError(null);
  };

  const handleAddStock = async () => {
    clearAction();
    if (!newProductId || !newValues.trim()) return;
    try {
      const result = await createAdminStock(
        newProductId,
        newDeliveryType,
        newValues.split('\n').map((v) => v.trim()).filter(Boolean)
      );
      setActionMessage(`Added ${result.count} stock items.`);
      setNewValues('');
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to add stock');
    }
  };

  const handleDisable = async (id: string) => {
    clearAction();
    try {
      await disableAdminStock(id);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to disable stock');
    }
  };

  const handleExpireReservations = async () => {
    clearAction();
    const confirmed = window.confirm('Release all reservations older than 15 minutes?');
    if (!confirmed) return;
    try {
      await expireOldAdminStock(15);
      setActionMessage('Expired old reservations.');
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to expire reservations');
    }
  };

  if (stock.loading || summary.loading) return <LoadingState label="Loading stock…" />;
  if (stock.error) return <ErrorState error={stock.error} onRetry={refresh} />;

  const summaryData = summary.data;

  return (
    <div>
      <PageHeader
        title="Stock / Inventory"
        description="Digital product inventory — values are encrypted and never shown back"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleExpireReservations}>Expire old reservations</Button>
            <Button variant="ghost" onClick={refresh}>Refresh</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total" value={summaryData?.total ?? 0} />
        <StatCard label="Available" value={summaryData?.available ?? 0} />
        <StatCard label="Reserved" value={summaryData?.reserved ?? 0} />
        <StatCard label="Sold" value={summaryData?.sold ?? 0} />
        <StatCard label="Disabled" value={summaryData?.disabled ?? 0} />
      </div>

      <Card title="Add stock" description="Batch upload delivery values (links, codes, text). One per line." className="mt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Product">
            <Select value={newProductId} onChange={(e) => setNewProductId(e.target.value)}>
              <option value="">Select product</option>
              {products.data?.products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Delivery type">
            <Select value={newDeliveryType} onChange={(e) => setNewDeliveryType(e.target.value)}>
              {DELIVERY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Values" hint="One per line">
            <Textarea
              value={newValues}
              onChange={(e) => setNewValues(e.target.value)}
              placeholder={'value-1\nvalue-2\nvalue-3'}
            />
          </Field>
        </div>
        <Button className="mt-3" disabled={!newProductId || !newValues.trim()} onClick={handleAddStock}>
          Add Stock
        </Button>
      </Card>

      <div className="mt-4">
        {actionMessage && <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{actionMessage}</p>}
        {actionError && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{actionError}</p>}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {STOCK_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={productId} onChange={(e) => { setProductId(e.target.value); setPage(1); }}>
          <option value="">All products</option>
          {products.data?.products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>

      <Card className="mt-3">
        {stock.data && stock.data.stock.length > 0 ? (
          <>
            <Table headers={['Product', 'Type', 'Status', 'Order', 'Created', 'Actions']}>
              {stock.data.stock.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <p className="text-slate-200">{item.product?.name ?? '—'}</p>
                    <p className="text-xs text-slate-500">{item.id.slice(0, 8)}</p>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{item.deliveryType}</td>
                  <td className="px-3 py-2"><StatusBadge status={item.status} /></td>
                  <td className="px-3 py-2 text-slate-300">
                    {item.order ? `#${item.order.orderNumber}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{formatDate(item.createdAt)}</td>
                  <td className="px-3 py-2">
                    {item.status !== 'SOLD' && (
                      <Button variant="danger" onClick={() => handleDisable(item.id)}>Disable</Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={stock.data.page} total={stock.data.total} pageSize={stock.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No stock found" message="Add stock or adjust filters." />
        )}
      </Card>
    </div>
  );
}