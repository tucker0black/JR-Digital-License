'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import type { CategoryDetail } from '@jr/shared';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Pagination, StatusBadge, Table, Textarea, formatDate } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { humanizeError } from '@/lib/errors';
import {
  activateAdminCategory,
  archiveAdminCategory,
  createAdminCategory,
  deactivateAdminCategory,
  deleteAdminCategory,
  getAdminCategories,
  reorderAdminCategories,
  updateAdminCategory
} from '@/lib/api-admin';

interface CategoryFormState {
  name: string;
  slug: string;
  description: string;
  icon: string;
  imageUrl: string;
  sortOrder: string;
  isActive: boolean;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const emptyForm: CategoryFormState = {
  name: '',
  slug: '',
  description: '',
  icon: '',
  imageUrl: '',
  sortOrder: '0',
  isActive: true
};

function toForm(category: CategoryDetail): CategoryFormState {
  return {
    name: category.name,
    slug: category.slug,
    description: category.description ?? '',
    icon: category.icon ?? '',
    imageUrl: category.imageUrl ?? '',
    sortOrder: String(category.sortOrder),
    isActive: category.isActive
  };
}

function CategoryForm({ initial, onSubmit, onCancel, submitLabel }: {
  initial: CategoryFormState;
  onSubmit: (form: CategoryFormState) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState<CategoryFormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CategoryFormState>(key: K, value: CategoryFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(humanizeError('Unable to save category', err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="Auto-generates slug when blank">
          <Input
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              set('name', name);
              if (!form.slug || form.slug === slugify(form.name)) set('slug', slugify(name));
            }}
            required
          />
        </Field>
        <Field label="Slug">
          <Input value={form.slug} onChange={(e) => set('slug', e.target.value)} />
        </Field>
        <Field label="Icon" hint="Emoji or short icon">
          <Input value={form.icon} onChange={(e) => set('icon', e.target.value)} />
        </Field>
        <Field label="Image URL">
          <Input value={form.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Sort order">
          <Input value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} type="number" />
        </Field>
        <label className="flex items-center gap-2 pt-6 text-sm text-slate-300">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          Active (visible to customers)
        </label>
      </div>
      <Field label="Description">
        <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export default function AdminCategoriesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const categories = useAsync(
    () => getAdminCategories({ page, pageSize: 50, search: search || undefined, sortBy: 'sortOrder', sortOrder: 'asc' }),
    [page, search]
  );

  const refresh = () => categories.reload();

  const handleCreate = async (form: CategoryFormState) => {
    await createAdminCategory({
      name: form.name,
      slug: form.slug || slugify(form.name),
      description: form.description || null,
      icon: form.icon || null,
      imageUrl: form.imageUrl || null,
      sortOrder: Number(form.sortOrder || 0),
      isActive: form.isActive
    });
    setShowCreate(false);
    refresh();
  };

  const handleUpdate = async (form: CategoryFormState) => {
    if (!editingId) return;
    await updateAdminCategory(editingId, {
      name: form.name,
      slug: form.slug || slugify(form.name),
      description: form.description || null,
      icon: form.icon || null,
      imageUrl: form.imageUrl || null,
      sortOrder: Number(form.sortOrder || 0),
      isActive: form.isActive
    });
    setEditingId(null);
    refresh();
  };

  const handleToggle = async (category: CategoryDetail) => {
    if (category.isActive) await deactivateAdminCategory(category.id);
    else await activateAdminCategory(category.id);
    refresh();
  };

  const handleArchive = async (category: CategoryDetail) => {
    const confirmed = window.confirm(`Archive "${category.name}"? It will no longer appear to customers.`);
    if (!confirmed) return;
    await archiveAdminCategory(category.id);
    refresh();
  };

  const handleDelete = async (category: CategoryDetail) => {
    const confirmed = window.confirm(`Permanently delete "${category.name}"? This fails if products exist.`);
    if (!confirmed) return;
    try {
      await deleteAdminCategory(category.id);
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Unable to delete category. Archive it instead.');
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!categories.data) return;
    const list = [...categories.data.categories];
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const item = list[index];
    if (!item) return;
    list.splice(index, 1);
    list.splice(target, 0, item);
    await reorderAdminCategories(list.map((c, i) => ({ id: c.id, sortOrder: i })));
    refresh();
  };

  if (categories.loading) return <LoadingState label="Loading categories…" />;
  if (categories.error) return <ErrorState error={categories.error} onRetry={refresh} />;

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Category management — changes apply to the store immediately"
        action={<Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : '+ Add Category'}</Button>}
      />

      <div className="mb-4 max-w-sm">
        <Input placeholder="Search categories…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {showCreate && (
        <Card title="Add category" className="mb-4">
          <CategoryForm initial={emptyForm} onSubmit={handleCreate} onCancel={() => setShowCreate(false)} submitLabel="Create Category" />
        </Card>
      )}

      <Card>
        {categories.data && categories.data.categories.length > 0 ? (
          <>
            <Table headers={['Order', 'Category', 'Products', 'Status', 'Actions']}>
              {categories.data.categories.map((category, index) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  index={index}
                  total={categories.data!.categories.length}
                  editing={editingId === category.id}
                  onEdit={() => setEditingId(editingId === category.id ? null : category.id)}
                  onSave={handleUpdate}
                  onCancel={() => setEditingId(null)}
                  onToggle={handleToggle}
                  onArchive={handleArchive}
                  onDelete={handleDelete}
                  onMove={handleMove}
                />
              ))}
            </Table>
            <Pagination page={categories.data.page} total={categories.data.total} pageSize={categories.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No categories found" message="Adjust filters or add a category." />
        )}
      </Card>
    </div>
  );
}

function CategoryRow({ category, index, total, editing, onEdit, onSave, onCancel, onToggle, onArchive, onDelete, onMove }: {
  category: CategoryDetail;
  index: number;
  total: number;
  editing: boolean;
  onEdit: () => void;
  onSave: (form: CategoryFormState) => Promise<void>;
  onCancel: () => void;
  onToggle: (category: CategoryDetail) => Promise<void>;
  onArchive: (category: CategoryDetail) => Promise<void>;
  onDelete: (category: CategoryDetail) => Promise<void>;
  onMove: (index: number, direction: -1 | 1) => Promise<void>;
}) {
  return (
    <>
      <tr>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" className="px-1.5" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="Move up">↑</Button>
            <Button variant="ghost" className="px-1.5" disabled={index === total - 1} onClick={() => onMove(index, 1)} aria-label="Move down">↓</Button>
          </div>
        </td>
        <td className="px-3 py-2">
          <p className="font-medium text-slate-200">
            {category.icon && <span className="mr-1">{category.icon}</span>}
            {category.name}
          </p>
          <p className="text-xs text-slate-500">{category.slug} · updated {formatDate(category.updatedAt)}</p>
        </td>
        <td className="px-3 py-2 text-slate-300">{category.productCount}</td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={category.isArchived ? 'ARCHIVED' : category.isActive ? 'ACTIVE' : 'DISABLED'} />
            {!category.isActive && !category.isArchived && <Badge tone="danger">Hidden</Badge>}
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            <Button variant="ghost" onClick={onEdit}>{editing ? 'Close' : 'Edit'}</Button>
            <Button variant={category.isActive ? 'danger' : 'subtle'} onClick={() => onToggle(category)}>
              {category.isActive ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="ghost" onClick={() => onArchive(category)}>Archive</Button>
            <Button variant="danger" onClick={() => onDelete(category)}>Delete</Button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={5} className="px-3 py-3">
            <CategoryForm initial={toForm(category)} onSubmit={onSave} onCancel={onCancel} submitLabel="Save Changes" />
          </td>
        </tr>
      )}
    </>
  );
}