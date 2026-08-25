'use client';

import { useAsync } from '@/components/admin/use-async';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Pagination
} from '@/components/admin/ui';
import {
  createAdminCoupon,
  deleteAdminCoupon,
  getAdminCoupons,
  updateAdminCoupon
} from '@/lib/api-admin';
import type { CouponDetail, CreateCouponRequest, UpdateCouponRequest } from '@jr/shared';
import { useEffect, useState } from 'react';

const DISCOUNT_TYPES = [
  { value: 'PERCENTAGE', label: 'Percentage (%)' },
  { value: 'FIXED', label: 'Fixed Amount' }
];

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<CouponDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editCoupon, setEditCoupon] = useState<CouponDetail | null>(null);
  const [form, setForm] = useState<CreateCouponRequest>({
    code: '',
    discountType: 'PERCENTAGE',
    discountValue: 0,
    minimumOrderAmount: null,
    maximumDiscountAmount: null,
    startAt: null,
    endAt: null,
    usageLimit: null,
    perUserLimit: 1,
    isActive: true,
    restrictedProductId: null,
    restrictedCategoryId: null
  });

  const { data, error, loading, reload } = useAsync(async () => {
    return getAdminCoupons({ page, pageSize: 20, search });
  }, [page, search]);

  useEffect(() => {
    if (data) {
      setCoupons(data.coupons);
      setTotal(data.total);
    }
  }, [data]);

  const handleCreate = async () => {
    try {
      await createAdminCoupon(form);
      setShowCreateModal(false);
      resetForm();
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create coupon');
    }
  };

  const handleEdit = async () => {
    if (!editCoupon) return;
    try {
      await updateAdminCoupon(editCoupon.id, form as UpdateCouponRequest);
      setEditCoupon(null);
      resetForm();
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update coupon');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this coupon?')) return;
    try {
      await deleteAdminCoupon(id);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete coupon');
    }
  };

  const handleToggleActive = async (coupon: CouponDetail) => {
    try {
      await updateAdminCoupon(coupon.id, { isActive: !coupon.isActive });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update coupon status');
    }
  };

  const resetForm = () => {
    setForm({
      code: '',
      discountType: 'PERCENTAGE',
      discountValue: 0,
      minimumOrderAmount: null,
      maximumDiscountAmount: null,
      startAt: null,
      endAt: null,
      usageLimit: null,
      perUserLimit: 1,
      isActive: true,
      restrictedProductId: null,
      restrictedCategoryId: null
    });
  };

  const openEditModal = (coupon: CouponDetail) => {
    setEditCoupon(coupon);
    setForm({
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: parseFloat(coupon.discountValue),
      minimumOrderAmount: coupon.minimumOrderAmount ? parseFloat(coupon.minimumOrderAmount) : null,
      maximumDiscountAmount: coupon.maximumDiscountAmount ? parseFloat(coupon.maximumDiscountAmount) : null,
      startAt: coupon.startAt,
      endAt: coupon.endAt,
      usageLimit: coupon.usageLimit,
      perUserLimit: coupon.perUserLimit,
      isActive: coupon.isActive,
      restrictedProductId: coupon.restrictedProductId,
      restrictedCategoryId: coupon.restrictedCategoryId
    });
  };

  const getCouponStatus = (coupon: CouponDetail): { label: string; tone: 'success' | 'danger' | 'warning' | 'muted' | 'accent' } => {
    if (!coupon.isActive) return { label: 'Disabled', tone: 'muted' };
    const now = new Date();
    if (coupon.startAt && new Date(coupon.startAt) > now) return { label: 'Scheduled', tone: 'accent' as const };
    if (coupon.endAt && new Date(coupon.endAt) < now) return { label: 'Expired', tone: 'warning' };
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) return { label: 'Used Up', tone: 'warning' };
    return { label: 'Active', tone: 'success' };
  };

  const formatDateStr = (dateStr: string | null): string => {
    if (!dateStr) return '\u2014';
    return new Date(dateStr).toLocaleDateString();
  };

  if (loading && coupons.length === 0) return <LoadingState />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coupons"
        description="Manage discount coupons for your store"
        action={
          <Button onClick={() => { resetForm(); setShowCreateModal(true); }}>
            + Add Coupon
          </Button>
        }
      />

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search coupons..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {coupons.length === 0 ? (
        <EmptyState title="No coupons found" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line/30">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/30 text-left text-xs font-medium uppercase tracking-wide text-muted-text">
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Discount</th>
                  <th className="px-4 py-3">Restrictions</th>
                  <th className="px-4 py-3">Usage</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/30">
                {coupons.map((coupon) => {
                  const status = getCouponStatus(coupon);
                  return (
                    <tr key={coupon.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-sm">{coupon.code}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">
                          {coupon.discountType === 'PERCENTAGE'
                            ? `${coupon.discountValue}%`
                            : `$${coupon.discountValue}`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-muted-text space-y-1">
                          {coupon.minimumOrderAmount && (
                            <div>Min order: ${coupon.minimumOrderAmount}</div>
                          )}
                          {coupon.maximumDiscountAmount && (
                            <div>Max discount: ${coupon.maximumDiscountAmount}</div>
                          )}
                          {coupon.restrictedProduct && (
                            <div>Product: {coupon.restrictedProduct.name}</div>
                          )}
                          {coupon.restrictedCategory && (
                            <div>Category: {coupon.restrictedCategory.name}</div>
                          )}
                          {!coupon.minimumOrderAmount && !coupon.maximumDiscountAmount && !coupon.restrictedProduct && !coupon.restrictedCategory && (
                            <span>No restrictions</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm">
                          {coupon.usageCount}
                          {coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3"><Badge tone={status.tone}>{status.label}</Badge></td>
                      <td className="px-4 py-3"><span className="text-sm">{formatDateStr(coupon.endAt)}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" onClick={() => openEditModal(coupon)}>
                            Edit
                          </Button>
                          <Button
                            variant={coupon.isActive ? 'danger' : 'subtle'}
                            onClick={() => handleToggleActive(coupon)}
                          >
                            {coupon.isActive ? 'Disable' : 'Enable'}
                          </Button>
                          <Button variant="danger" onClick={() => handleDelete(coupon.id)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            total={total}
            pageSize={20}
            onChange={setPage}
          />
        </>
      )}

      {(showCreateModal || editCoupon) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card title={editCoupon ? 'Edit Coupon' : 'Create Coupon'} className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="space-y-4">
              <Field label="Coupon Code">
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. SUMMER20"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Discount Type">
                  <select
                    value={form.discountType}
                    onChange={(e) => setForm({ ...form, discountType: e.target.value as 'PERCENTAGE' | 'FIXED' })}
                    className="w-full rounded-xl border border-line/50 bg-card px-4 py-2.5 text-sm text-ink"
                  >
                    {DISCOUNT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Discount Value">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.discountValue}
                    onChange={(e) => setForm({ ...form, discountValue: parseFloat(e.target.value) || 0 })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Minimum Order Amount">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.minimumOrderAmount ?? ''}
                    onChange={(e) => setForm({ ...form, minimumOrderAmount: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="Optional"
                  />
                </Field>

                <Field label="Maximum Discount Amount">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.maximumDiscountAmount ?? ''}
                    onChange={(e) => setForm({ ...form, maximumDiscountAmount: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="Optional"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Start Date">
                  <Input
                    type="date"
                    value={form.startAt ? form.startAt.split('T')[0] : ''}
                    onChange={(e) => setForm({ ...form, startAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                  />
                </Field>

                <Field label="End Date">
                  <Input
                    type="date"
                    value={form.endAt ? form.endAt.split('T')[0] : ''}
                    onChange={(e) => setForm({ ...form, endAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Total Usage Limit">
                  <Input
                    type="number"
                    min="1"
                    value={form.usageLimit ?? ''}
                    onChange={(e) => setForm({ ...form, usageLimit: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="Unlimited"
                  />
                </Field>

                <Field label="Per User Limit">
                  <Input
                    type="number"
                    min="1"
                    value={form.perUserLimit ?? ''}
                    onChange={(e) => setForm({ ...form, perUserLimit: e.target.value ? parseInt(e.target.value) : 1 })}
                  />
                </Field>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-line"
                />
                <label htmlFor="isActive" className="text-sm">Active</label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="ghost"
                  onClick={() => { setShowCreateModal(false); setEditCoupon(null); resetForm(); }}
                >
                  Cancel
                </Button>
                <Button onClick={editCoupon ? handleEdit : handleCreate}>
                  {editCoupon ? 'Save Changes' : 'Create Coupon'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}