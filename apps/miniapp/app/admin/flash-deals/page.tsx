'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getAdminFlashDeals,
  createAdminFlashDeal,
  updateAdminFlashDeal,
  deleteAdminFlashDeal,
  activateAdminFlashDeal,
  deactivateAdminFlashDeal,
  type AdminFlashDeal,
  type AdminFlashDealFilters,
  getAdminProducts
} from '@/lib/api-admin';
import type { ProductDetail } from '@jr/shared';

const formatCurrency = (amount: string, currency = 'USD') => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
};

const formatDate = (date: string | null) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

function getDiscountPercent(original: string, sale: string): number {
  const o = parseFloat(original);
  const s = parseFloat(sale);
  if (isNaN(o) || isNaN(s) || o <= 0) return 0;
  return Math.round(((o - s) / o) * 100);
}

function getDealStatus(deal: AdminFlashDeal): { label: string; color: string } {
  if (!deal.isActive) return { label: 'Disabled', color: 'text-soft bg-muted/50' };
  const now = new Date();
  if (deal.startsAt && new Date(deal.startsAt) > now) return { label: 'Scheduled', color: 'text-blue-400 bg-blue-500/10' };
  if (deal.endsAt && new Date(deal.endsAt) < now) return { label: 'Expired', color: 'text-amber-400 bg-amber-500/10' };
  return { label: 'Active', color: 'text-emerald-400 bg-emerald-500/10' };
}

export default function FlashDealsPage() {
  const [deals, setDeals] = useState<AdminFlashDeal[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editDeal, setEditDeal] = useState<AdminFlashDeal | null>(null);
  const [products, setProducts] = useState<ProductDetail[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const loadDeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: AdminFlashDealFilters = { page, pageSize: 20 };
      if (search) filters.search = search;
      if (filterActive) filters.isActive = filterActive;
      const result = await getAdminFlashDeals(filters);
      setDeals(result.deals);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load flash deals');
    } finally {
      setLoading(false);
    }
  }, [page, search, filterActive]);

  useEffect(() => { void loadDeals(); }, [loadDeals]);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const result = await getAdminProducts({ pageSize: 200, status: 'ACTIVE', isActive: 'true' });
      setProducts(result.products);
    } catch { /* ignore */ }
    finally { setLoadingProducts(false); }
  }, []);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this flash deal?')) return;
    try {
      await deleteAdminFlashDeal(id);
      await loadDeals();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleToggleActive = async (deal: AdminFlashDeal) => {
    try {
      if (deal.isActive) {
        await deactivateAdminFlashDeal(deal.id);
      } else {
        await activateAdminFlashDeal(deal.id);
      }
      await loadDeals();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Flash Deals</h1>
          <p className="mt-1 text-sm text-soft">{total} total deals</p>
        </div>
        <button
          onClick={() => { setEditDeal(null); setShowCreateModal(true); }}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-luxury hover:bg-primary/90"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M12 4v16m8-8H4" strokeLinecap="round" />
          </svg>
          Add Flash Deal
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 rounded-xl border border-line/40 bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-muted-text focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <select
          value={filterActive}
          onChange={(e) => { setFilterActive(e.target.value); setPage(1); }}
          className="rounded-xl border border-line/40 bg-surface px-4 py-2.5 text-sm text-ink focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
        >
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Disabled</option>
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-primary" />
          <span className="ml-3 text-sm text-soft">Loading flash deals...</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-center text-sm text-danger">{error}</div>
      ) : deals.length === 0 ? (
        <div className="rounded-xl border border-line/30 bg-surface/50 p-12 text-center">
          <div className="text-4xl">🔥</div>
          <p className="mt-3 text-sm font-medium text-ink">No flash deals found</p>
          <p className="mt-1 text-xs text-soft">Create your first flash deal to offer time-limited discounts.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line/30 bg-surface/50">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line/30 text-xs uppercase tracking-wider text-muted-text">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Original</th>
                  <th className="px-4 py-3 font-medium">Sale</th>
                  <th className="px-4 py-3 font-medium">Discount</th>
                  <th className="px-4 py-3 font-medium">Schedule</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/20">
                {deals.map((deal) => {
                  const status = getDealStatus(deal);
                  const discount = getDiscountPercent(deal.product.price, deal.salePrice);
                  return (
                    <tr key={deal.id} className="transition-luxury hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {deal.product.imageUrl ? (
                            <img src={deal.product.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/30 text-lg">📦</div>
                          )}
                          <div>
                            <p className="font-medium text-ink line-clamp-1">{deal.product.name}</p>
                            {deal.product.category && (
                              <p className="text-xs text-soft">{deal.product.category.name}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-soft">{formatCurrency(deal.product.price, deal.product.currency)}</td>
                      <td className="px-4 py-3 font-medium text-primary">{formatCurrency(deal.salePrice, deal.product.currency)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                          {deal.discountType === 'PERCENTAGE' ? `${deal.discountValue}%` : `-${formatCurrency(deal.discountValue, deal.product.currency)}`}
                          {discount > 0 && ` (${discount}% off)`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-soft">
                        {deal.startsAt || deal.endsAt ? (
                          <div>
                            {deal.startsAt && <div>From: {formatDate(deal.startsAt)}</div>}
                            {deal.endsAt && <div>To: {formatDate(deal.endsAt)}</div>}
                          </div>
                        ) : (
                          <span className="text-muted-text">Always</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleToggleActive(deal)}
                            className="rounded-lg p-1.5 text-soft transition-luxury hover:bg-muted/50 hover:text-ink"
                            title={deal.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {deal.isActive ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4"><path d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" strokeLinecap="round" /></svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" /></svg>
                            )}
                          </button>
                          <button
                            onClick={() => { setEditDeal(deal); setShowCreateModal(true); }}
                            className="rounded-lg p-1.5 text-soft transition-luxury hover:bg-muted/50 hover:text-ink"
                            title="Edit"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" strokeLinecap="round" /></svg>
                          </button>
                          <button
                            onClick={() => handleDelete(deal.id)}
                            className="rounded-lg p-1.5 text-soft transition-luxury hover:bg-danger/10 hover:text-danger"
                            title="Delete"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-line/30 px-4 py-3">
              <span className="text-xs text-soft">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-line/40 px-3 py-1.5 text-xs text-soft transition-luxury hover:bg-muted/50 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-lg border border-line/40 px-3 py-1.5 text-xs text-soft transition-luxury hover:bg-muted/50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <FlashDealModal
          deal={editDeal}
          products={products}
          loadingProducts={loadingProducts}
          onClose={() => { setShowCreateModal(false); setEditDeal(null); }}
          onSaved={async () => { setShowCreateModal(false); setEditDeal(null); await loadDeals(); }}
        />
      )}
    </div>
  );
}

function FlashDealModal({
  deal,
  products,
  loadingProducts,
  onClose,
  onSaved
}: {
  deal: AdminFlashDeal | null;
  products: ProductDetail[];
  loadingProducts: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [productId, setProductId] = useState(deal?.productId || '');
  const [discountType, setDiscountType] = useState(deal?.discountType || 'PERCENTAGE');
  const [discountValue, setDiscountValue] = useState(deal?.discountValue || '');
  const [isActive, setIsActive] = useState(deal?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(deal?.sortOrder || 0);
  const [startsAt, setStartsAt] = useState(deal?.startsAt ? deal.startsAt.slice(0, 16) : '');
  const [endsAt, setEndsAt] = useState(deal?.endsAt ? deal.endsAt.slice(0, 16) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProduct = products.find(p => p.id === productId);
  const originalPrice = selectedProduct ? parseFloat(selectedProduct.price) : 0;
  const discVal = parseFloat(discountValue) || 0;

  let calculatedSale = 0;
  if (originalPrice > 0 && discVal > 0) {
    if (discountType === 'PERCENTAGE') {
      calculatedSale = originalPrice * (1 - discVal / 100);
    } else {
      calculatedSale = originalPrice - discVal;
    }
    calculatedSale = Math.max(0, Math.round(calculatedSale * 100) / 100);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || discVal <= 0) {
      setError('Please select a product and enter a valid discount value');
      return;
    }
    if (discountType === 'PERCENTAGE' && discVal > 100) {
      setError('Percentage cannot exceed 100%');
      return;
    }
    if (discountType === 'FIXED' && discVal >= originalPrice) {
      setError('Fixed discount cannot exceed or equal product price');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const data = {
        productId,
        discountType: discountType as 'PERCENTAGE' | 'FIXED',
        discountValue: discVal,
        isActive,
        sortOrder,
        startsAt: startsAt || null,
        endsAt: endsAt || null
      };

      if (deal) {
        await updateAdminFlashDeal(deal.id, {
          discountType: data.discountType,
          discountValue: data.discountValue,
          isActive: data.isActive,
          sortOrder: data.sortOrder,
          startsAt: data.startsAt,
          endsAt: data.endsAt
        });
      } else {
        await createAdminFlashDeal(data);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save flash deal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line/30 bg-surface p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-ink">{deal ? 'Edit Flash Deal' : 'Create Flash Deal'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-soft hover:text-ink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-soft">Product *</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={!!deal || loadingProducts}
              className="w-full rounded-xl border border-line/40 bg-surface px-3 py-2.5 text-sm text-ink focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
            >
              <option value="">{loadingProducts ? 'Loading products...' : 'Select a product'}</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} — {formatCurrency(p.price, p.currency)}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-soft">Discount Type *</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'PERCENTAGE' | 'FIXED')}
                className="w-full rounded-xl border border-line/40 bg-surface px-3 py-2.5 text-sm text-ink focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="FIXED">Fixed Amount ($)</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-soft">Discount Value *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={discountType === 'PERCENTAGE' ? '100' : undefined}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'PERCENTAGE' ? 'e.g. 25' : 'e.g. 5.00'}
                className="w-full rounded-xl border border-line/40 bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted-text focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                required
              />
            </div>
          </div>

          {selectedProduct && discVal > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-soft">Original Price:</span>
                <span className="text-ink">{formatCurrency(selectedProduct.price, selectedProduct.currency)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-soft">Sale Price:</span>
                <span className="font-medium text-primary">{formatCurrency(String(calculatedSale), selectedProduct.currency)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-soft">Savings:</span>
                <span className="font-medium text-emerald-400">{getDiscountPercent(selectedProduct.price, String(calculatedSale))}%</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-soft">Start Time</label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-xl border border-line/40 bg-surface px-3 py-2.5 text-sm text-ink focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-soft">End Time</label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full rounded-xl border border-line/40 bg-surface px-3 py-2.5 text-sm text-ink focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-soft">Sort Order</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                className="w-full rounded-xl border border-line/40 bg-surface px-3 py-2.5 text-sm text-ink focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-line/40 text-primary focus:ring-primary/30"
                />
                <span className="text-sm text-ink">Active</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-line/40 px-4 py-2.5 text-sm text-soft transition-luxury hover:bg-muted/50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-luxury hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : deal ? 'Save Changes' : 'Create Deal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
