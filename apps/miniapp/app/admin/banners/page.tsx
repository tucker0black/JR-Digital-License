'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import type { AdminBanner } from '@/lib/api-admin';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Pagination, Table, formatDate } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { useBannerImage } from '@/components/use-banner-image';
import { MediaImageField } from '@/components/admin/MediaImageField';
import { humanizeError } from '@/lib/errors';
import {
  activateAdminBanner,
  createAdminBanner,
  deactivateAdminBanner,
  deleteAdminBanner,
  getAdminBanners,
  getAdminCategories,
  updateAdminBanner
} from '@/lib/api-admin';

interface BannerFormState {
  title: string;
  subtitle: string;
  imageUrl: string;
  buttonText: string;
  buttonDestination: string;
  targetType: string;
  targetCategoryId: string;
  targetProductId: string;
  targetPage: string;
  sortOrder: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
}

const emptyForm: BannerFormState = {
  title: '',
  subtitle: '',
  imageUrl: '',
  buttonText: '',
  buttonDestination: '',
  targetType: 'HOME',
  targetCategoryId: '',
  targetProductId: '',
  targetPage: '',
  sortOrder: '0',
  isActive: true,
  startsAt: '',
  endsAt: ''
};

function toForm(banner: AdminBanner): BannerFormState {
  return {
    title: banner.title,
    subtitle: banner.subtitle ?? '',
    imageUrl: banner.imageUrl ?? '',
    buttonText: banner.buttonText ?? '',
    buttonDestination: banner.buttonDestination ?? '',
    targetType: banner.targetType,
    targetCategoryId: banner.targetCategoryId ?? '',
    targetProductId: banner.targetProductId ?? '',
    targetPage: banner.targetPage ?? '',
    sortOrder: String(banner.sortOrder),
    isActive: banner.isActive,
    startsAt: banner.startsAt ? new Date(banner.startsAt).toISOString().slice(0, 16) : '',
    endsAt: banner.endsAt ? new Date(banner.endsAt).toISOString().slice(0, 16) : ''
  };
}

function BannerForm({ initial, onSubmit, onCancel, submitLabel }: {
  initial: BannerFormState;
  onSubmit: (form: BannerFormState) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState<BannerFormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = useAsync(() => getAdminCategories({ pageSize: 100, sortBy: 'sortOrder', sortOrder: 'asc' }), []);

  const set = <K extends keyof BannerFormState>(key: K, value: BannerFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Preview-only image lifecycle: failure resets automatically when the URL
  // changes and keeps bounded retries. It never touches the stored record.
  const { status: previewStatus, src: previewSrc } = useBannerImage(form.imageUrl);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(humanizeError('Unable to save banner', err));
    } finally {
      setSubmitting(false);
    }
  };

  const showCategory = form.targetType === 'CATEGORY';
  const showPage = form.targetType === 'PAGE';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" hint="Main banner heading">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </Field>
        <Field label="Subtitle" hint="Optional description">
          <Input value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
        </Field>
        <MediaImageField
          label="Banner Image"
          value={form.imageUrl}
          onChange={(url) => set('imageUrl', url)}
          aspect="wide"
        />
        <Field label="Button Text" hint="Optional CTA button">
          <Input value={form.buttonText} onChange={(e) => set('buttonText', e.target.value)} placeholder="Shop Now" />
        </Field>
        <Field label="Button Destination" hint="URL or path when clicked">
          <Input value={form.buttonDestination} onChange={(e) => set('buttonDestination', e.target.value)} placeholder="/store or https://…" />
        </Field>
        <Field label="Sort Order">
          <Input value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} type="number" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Target Type" hint="Where this banner appears">
          <select
            className="w-full rounded-xl border border-line/50 bg-card px-4 py-2.5 text-sm text-ink transition-luxury focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:outline-none"
            value={form.targetType}
            onChange={(e) => set('targetType', e.target.value)}
          >
            <option value="HOME">Home Page</option>
            <option value="CATEGORY">Category</option>
            <option value="PRODUCT">Product</option>
            <option value="PROMOTION">Promotion</option>
            <option value="PAGE">Internal Page</option>
          </select>
        </Field>

        {showCategory && (
          <Field label="Target Category">
            <select
              className="w-full rounded-xl border border-line/50 bg-card px-4 py-2.5 text-sm text-ink transition-luxury focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:outline-none"
              value={form.targetCategoryId}
              onChange={(e) => set('targetCategoryId', e.target.value)}
            >
              <option value="">Select category…</option>
              {categories.data?.categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </Field>
        )}

        {showPage && (
          <Field label="Target Page" hint="Internal Mini App path">
            <Input value={form.targetPage} onChange={(e) => set('targetPage', e.target.value)} placeholder="/store, /topup, /wallet" />
          </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start Date & Time" hint="When to start showing (optional)">
          <Input type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
        </Field>
        <Field label="End Date & Time" hint="When to stop showing (optional)">
          <Input type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
        </Field>
      </div>

      {previewSrc && (
        <Field label="Preview">
          {/* Image-only preview: the artwork is the complete banner, so the
              title/subtitle fields are never drawn over it. A failed load is
              a delivery problem only — the saved URL stays untouched. */}
          <div className="relative aspect-[2048/896] w-full overflow-hidden rounded-xl bg-gradient-to-br from-sky-500 via-purple-500 to-fuchsia-500">
            {previewStatus === 'ok' ? (
              <img
                src={previewSrc}
                alt="Banner preview"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
                <span className="text-xs font-semibold text-white/90">Image unavailable</span>
                <span className="text-[10px] text-white/70">The host did not serve this image. The URL you entered is kept unchanged — retrying happens automatically.</span>
              </div>
            )}
          </div>
        </Field>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
        Active (visible to customers)
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function getBannerStatus(banner: AdminBanner): string {
  const now = new Date();
  if (!banner.isActive) return 'DISABLED';
  if (banner.startsAt && new Date(banner.startsAt) > now) return 'SCHEDULED';
  if (banner.endsAt && new Date(banner.endsAt) < now) return 'EXPIRED';
  return 'ACTIVE';
}

const STATUS_TONES: Record<string, 'success' | 'muted' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  DISABLED: 'muted',
  SCHEDULED: 'warning',
  EXPIRED: 'danger'
};

function BannerThumb({ src, title }: { src: string | null; title: string }) {
  // Database state vs delivery state are different things: a stored imageUrl
  // that currently fails to load must stay visibly distinct from "no image
  // configured", and must never be cleared from the record.
  const { status, src: resolvedSrc, markLoaded, markFailed } = useBannerImage(src);

  if (status === 'no-url') {
    return (
      <div
        className="flex h-10 w-16 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/40 to-fuchsia-500/40 text-[10px] text-slate-300"
        title="No image configured for this banner"
      >
        No img
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div
        className="flex h-10 w-16 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-500/10 px-1 text-center text-[9px] leading-tight text-amber-300"
        title={`A saved image URL exists but the image host is currently unreachable. The banner and its stored URL are unchanged.\n${src ?? ''}`}
      >
        Unavailable
      </div>
    );
  }
  return (
    <img
      src={resolvedSrc ?? undefined}
      alt={`${title} banner`}
      className="h-10 w-16 rounded-lg object-cover"
      onLoad={markLoaded}
      onError={markFailed}
    />
  );
}

export default function AdminBannersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const banners = useAsync(
    () => getAdminBanners({ page, pageSize: 20, search: search || undefined }),
    [page, search]
  );

  const refresh = () => banners.reload();

  const handleCreate = async (form: BannerFormState) => {
    await createAdminBanner({
      title: form.title,
      subtitle: form.subtitle || undefined,
      imageUrl: form.imageUrl || undefined,
      buttonText: form.buttonText || undefined,
      buttonDestination: form.buttonDestination || undefined,
      targetType: form.targetType,
      targetCategoryId: form.targetCategoryId || undefined,
      targetProductId: form.targetProductId || undefined,
      targetPage: form.targetPage || undefined,
      sortOrder: Number(form.sortOrder || 0),
      isActive: form.isActive,
      startsAt: form.startsAt || undefined,
      endsAt: form.endsAt || undefined
    });
    setShowCreate(false);
    refresh();
  };

  const handleUpdate = async (form: BannerFormState) => {
    if (!editingId) return;
    await updateAdminBanner(editingId, {
      title: form.title,
      subtitle: form.subtitle || null,
      imageUrl: form.imageUrl || null,
      buttonText: form.buttonText || null,
      buttonDestination: form.buttonDestination || null,
      targetType: form.targetType,
      targetCategoryId: form.targetCategoryId || null,
      targetProductId: form.targetProductId || null,
      targetPage: form.targetPage || null,
      sortOrder: Number(form.sortOrder || 0),
      isActive: form.isActive,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null
    });
    setEditingId(null);
    refresh();
  };

  const handleToggle = async (banner: AdminBanner) => {
    if (banner.isActive) await deactivateAdminBanner(banner.id);
    else await activateAdminBanner(banner.id);
    refresh();
  };

  const handleDelete = async (banner: AdminBanner) => {
    const confirmed = window.confirm(`Permanently delete banner "${banner.title}"?`);
    if (!confirmed) return;
    await deleteAdminBanner(banner.id);
    refresh();
  };

  if (banners.loading) return <LoadingState label="Loading banners…" />;
  if (banners.error) return <ErrorState error={banners.error} onRetry={refresh} />;

  return (
    <div>
      <PageHeader
        title="Banners & Promotions"
        description="Manage promotional banners shown in the Mini App"
        action={<Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : '+ Add Banner'}</Button>}
      />

      <div className="mb-4 max-w-sm">
        <Input placeholder="Search banners…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {showCreate && (
        <Card title="Create banner" className="mb-4">
          <BannerForm initial={emptyForm} onSubmit={handleCreate} onCancel={() => setShowCreate(false)} submitLabel="Create Banner" />
        </Card>
      )}

      <Card>
        {banners.data && banners.data.banners.length > 0 ? (
          <>
            <Table headers={['Order', 'Banner', 'Target', 'Status', 'Schedule', 'Actions']}>
              {banners.data.banners.map((banner) => {
                const status = getBannerStatus(banner);
                const tone = STATUS_TONES[status] ?? 'default';
                return (
                  <tr key={banner.id}>
                    <td className="px-3 py-2 text-slate-400">{banner.sortOrder}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <BannerThumb src={banner.imageUrl} title={banner.title} />
                        <div>
                          <p className="font-medium text-slate-200">{banner.title}</p>
                          {banner.subtitle && <p className="text-xs text-slate-500 line-clamp-1">{banner.subtitle}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-slate-400">
                        <Badge tone="accent">{banner.targetType}</Badge>
                        {banner.targetCategory && <p className="mt-1">{banner.targetCategory.name}</p>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={tone}>{status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {banner.startsAt && <p>From: {formatDate(banner.startsAt)}</p>}
                      {banner.endsAt && <p>To: {formatDate(banner.endsAt)}</p>}
                      {!banner.startsAt && !banner.endsAt && 'Always'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <Button variant="ghost" onClick={() => setEditingId(editingId === banner.id ? null : banner.id)}>
                          {editingId === banner.id ? 'Close' : 'Edit'}
                        </Button>
                        <Button variant={banner.isActive ? 'danger' : 'subtle'} onClick={() => handleToggle(banner)}>
                          {banner.isActive ? 'Disable' : 'Enable'}
                        </Button>
                        <Button variant="danger" onClick={() => handleDelete(banner)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={banners.data.page} total={banners.data.total} pageSize={banners.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No banners yet" message="Create your first banner to promote products and categories." />
        )}
      </Card>

      {editingId && banners.data && (
        <Card title="Edit banner" className="mt-4">
          <BannerForm
            initial={toForm(banners.data.banners.find((b) => b.id === editingId)!)}
            onSubmit={handleUpdate}
            onCancel={() => setEditingId(null)}
            submitLabel="Save Changes"
          />
        </Card>
      )}
    </div>
  );
}
