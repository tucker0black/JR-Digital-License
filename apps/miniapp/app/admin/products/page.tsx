'use client';

import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import type { ProductDetail } from '@jr/shared';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Pagination, Select, StatusBadge, Table, Textarea, formatMoney } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { humanizeError } from '@/lib/errors';
import {
  activateAdminProduct,
  addAdminProductStock,
  bulkUpdateAdminProducts,
  createAdminProduct,
  deactivateAdminProduct,
  deleteAdminProduct,
  duplicateAdminProduct,
  getAdminCategories,
  getAdminProducts,
  updateAdminProduct
} from '@/lib/api-admin';

const BULK_ACTIONS = [
  { value: '', label: 'Bulk actions…' },
  { value: 'ACTIVATE', label: 'Enable selected' },
  { value: 'DEACTIVATE', label: 'Disable selected' },
  { value: 'ARCHIVE', label: 'Archive selected' },
  { value: 'CHANGE_CATEGORY', label: 'Change category…' }
];

const PRODUCT_TYPES = ['DIGITAL_LINK', 'DIGITAL_CODE', 'DIGITAL_TEXT', 'DIGITAL_FILE', 'DIGITAL_ACCOUNT', 'SMM_API'];
const DELIVERY_TYPES = ['DIGITAL_LINK', 'DIGITAL_CODE', 'DIGITAL_TEXT', 'DIGITAL_FILE', 'DIGITAL_ACCOUNT', 'MANUAL', 'SMM'];
const PRODUCT_STATUSES = ['ACTIVE', 'DISABLED', 'DRAFT', 'OUT_OF_STOCK', 'ARCHIVED'];

interface ProductFormState {
  name: string;
  slug: string;
  categoryId: string;
  description: string;
  imageUrl: string;
  type: string;
  deliveryType: string;
  price: string;
  currency: string;
  costPrice: string;
  markup: string;
  minimumQuantity: string;
  maximumQuantity: string;
  hideWhenOutOfStock: boolean;
  status: string;
  isActive: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  sortOrder: string;
  instructions: string;
  keywords: string;
}

const emptyForm: ProductFormState = {
  name: '',
  slug: '',
  categoryId: '',
  description: '',
  imageUrl: '',
  type: 'DIGITAL_LINK',
  deliveryType: 'DIGITAL_LINK',
  price: '',
  currency: 'USD',
  costPrice: '',
  markup: '',
  minimumQuantity: '1',
  maximumQuantity: '',
  hideWhenOutOfStock: false,
  status: 'DRAFT',
  isActive: true,
  isFeatured: false,
  isPopular: false,
  sortOrder: '0',
  instructions: '',
  keywords: ''
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toForm(product: ProductDetail): ProductFormState {
  return {
    name: product.name,
    slug: product.slug,
    categoryId: product.categoryId,
    description: product.description ?? '',
    imageUrl: product.imageUrl ?? '',
    type: product.type,
    deliveryType: product.deliveryType,
    price: product.price,
    currency: product.currency,
    costPrice: product.costPrice ?? '',
    markup: product.markup ?? '',
    minimumQuantity: String(product.minimumQuantity),
    maximumQuantity: product.maximumQuantity === null ? '' : String(product.maximumQuantity),
    hideWhenOutOfStock: product.hideWhenOutOfStock,
    status: product.status,
    isActive: product.isActive,
    isFeatured: product.isFeatured,
    isPopular: product.isPopular,
    sortOrder: String(product.sortOrder),
    instructions: product.instructions ?? '',
    keywords: product.keywords.join(', ')
  };
}

function ProductForm({ initial, categories, onSubmit, onCancel, submitLabel }: {
  initial: ProductFormState;
  categories: { id: string; name: string }[];
  onSubmit: (form: ProductFormState) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState<ProductFormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(humanizeError('Unable to save product', err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name" hint="Auto-generates slug when blank">
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
        <Field label="Category">
          <Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)} required>
            <option value="" disabled>
              Select category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Image URL">
          <Input value={form.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Price" hint="Selling price in currency">
          <Input value={form.price} onChange={(e) => set('price', e.target.value)} type="number" step="0.01" min="0" required />
        </Field>
        <Field label="Currency">
          <Input value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={3} />
        </Field>
        <Field label="Cost price" hint="Provider cost">
          <Input value={form.costPrice} onChange={(e) => set('costPrice', e.target.value)} type="number" step="0.01" min="0" />
        </Field>
        <Field label="Markup">
          <Input value={form.markup} onChange={(e) => set('markup', e.target.value)} type="number" step="0.01" min="0" />
        </Field>
        <Field label="Type">
          <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
            {PRODUCT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Delivery type">
          <Select value={form.deliveryType} onChange={(e) => set('deliveryType', e.target.value)}>
            {DELIVERY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Minimum quantity">
          <Input value={form.minimumQuantity} onChange={(e) => set('minimumQuantity', e.target.value)} type="number" min="1" />
        </Field>
        <Field label="Maximum quantity" hint="Leave blank to use available stock">
          <Input value={form.maximumQuantity} onChange={(e) => set('maximumQuantity', e.target.value)} type="number" min="1" />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {PRODUCT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sort order">
          <Input value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} type="number" />
        </Field>
        <Field label="Keywords" hint="Comma-separated">
          <Input value={form.keywords} onChange={(e) => set('keywords', e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          Active
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} />
          Featured
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.isPopular} onChange={(e) => set('isPopular', e.target.checked)} />
          Popular
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.hideWhenOutOfStock} onChange={(e) => set('hideWhenOutOfStock', e.target.checked)} />
          Hide when out of stock
        </label>
      </div>

      <Field label="Description">
        <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label="Instructions" hint="Shown to customers after purchase">
        <Textarea value={form.instructions} onChange={(e) => set('instructions', e.target.value)} />
      </Field>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function AdminProductsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stockForId, setStockForId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const products = useAsync(
    () => getAdminProducts({ page, pageSize: 20, search: search || undefined, status: status || undefined, categoryId: categoryId || undefined }),
    [page, search, status, categoryId]
  );
  const categories = useAsync(() => getAdminCategories({ pageSize: 100 }), []);
  const categoryOptions = useMemo(
    () => (categories.data?.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
    [categories.data]
  );

  const refresh = () => {
    products.reload();
    categories.reload();
  };

  const handleCreate = async (form: ProductFormState) => {
    await createAdminProduct({
      name: form.name,
      slug: form.slug || slugify(form.name),
      categoryId: form.categoryId,
      description: form.description || null,
      imageUrl: form.imageUrl || null,
      type: form.type as never,
      deliveryType: form.deliveryType as never,
      price: form.price,
      currency: form.currency,
      costPrice: form.costPrice === '' ? null : form.costPrice,
      markup: form.markup === '' ? null : form.markup,
      minimumQuantity: Number(form.minimumQuantity),
      maximumQuantity: form.maximumQuantity === '' ? null : Number(form.maximumQuantity),
      hideWhenOutOfStock: form.hideWhenOutOfStock,
      status: form.status as never,
      isActive: form.isActive,
      isFeatured: form.isFeatured,
      isPopular: form.isPopular,
      sortOrder: Number(form.sortOrder || 0),
      instructions: form.instructions || null,
      keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean)
    });
    setShowCreate(false);
    refresh();
  };

  const handleUpdate = async (form: ProductFormState) => {
    if (!editingId) return;
    await updateAdminProduct(editingId, {
      name: form.name,
      slug: form.slug || slugify(form.name),
      categoryId: form.categoryId,
      description: form.description || null,
      imageUrl: form.imageUrl || null,
      type: form.type as never,
      deliveryType: form.deliveryType as never,
      price: form.price,
      currency: form.currency,
      costPrice: form.costPrice === '' ? null : form.costPrice,
      markup: form.markup === '' ? null : form.markup,
      minimumQuantity: Number(form.minimumQuantity),
      maximumQuantity: form.maximumQuantity === '' ? null : Number(form.maximumQuantity),
      hideWhenOutOfStock: form.hideWhenOutOfStock,
      status: form.status as never,
      isActive: form.isActive,
      isFeatured: form.isFeatured,
      isPopular: form.isPopular,
      sortOrder: Number(form.sortOrder || 0),
      instructions: form.instructions || null,
      keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean)
    });
    setEditingId(null);
    refresh();
  };

  const handleToggle = async (product: ProductDetail) => {
    try {
      if (product.isActive) await deactivateAdminProduct(product.id);
      else await activateAdminProduct(product.id);
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Unable to change product status');
    }
  };

  const handleDelete = async (product: ProductDetail) => {
    const confirmed = window.confirm(
      `Delete "${product.name}"? This permanently removes the product. Only products with no order history, no stock, no variants and no linked SMM service can be deleted. Use Disable or Archive for products with history.`
    );
    if (!confirmed) return;
    try {
      await deleteAdminProduct(product.id);
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed. Use "Disable" to hide the product while keeping its order history.');
    }
  };

  const handleAddStock = async (product: ProductDetail, deliveryType: string, values: string[]) => {
    try {
      await addAdminProductStock(product.id, deliveryType, values);
      setStockForId(null);
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Unable to add stock');
    }
  };

  const handleDuplicate = async (product: ProductDetail) => {
    try {
      await duplicateAdminProduct(product.id);
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Unable to duplicate product');
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: string[]) => {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = ids.every((id) => next.has(id));
      ids.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const handleBulk = async () => {
    if (selected.size === 0 || !bulkAction) return;
    setBulkError(null);
    setBulkBusy(true);
    const ids = Array.from(selected);
    try {
      if (bulkAction === 'CHANGE_CATEGORY' && !bulkCategoryId) {
        setBulkError('Select a category first.');
        setBulkBusy(false);
        return;
      }
      const result = await bulkUpdateAdminProducts(
        ids,
        bulkAction as 'ACTIVATE' | 'DEACTIVATE' | 'ARCHIVE' | 'CHANGE_CATEGORY',
        bulkAction === 'CHANGE_CATEGORY' ? bulkCategoryId : undefined
      );
      setSelected(new Set());
      setBulkAction('');
      setBulkCategoryId('');
      refresh();
      if (result.updatedCount < ids.length) {
        setBulkError(`Applied to ${result.updatedCount} of ${ids.length} products.`);
      }
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Bulk action failed');
    } finally {
      setBulkBusy(false);
    }
  };

  if (products.loading) return <LoadingState label="Loading products…" />;
  if (products.error) return <ErrorState error={products.error} onRetry={refresh} />;

  return (
    <div>
      <PageHeader
        title="Products"
        description="Catalog management — changes apply to the store immediately"
        action={
          <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : '+ Add Product'}</Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="Search products…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </div>

      {showCreate && (
        <Card title="Add product" className="mb-4">
          <ProductForm
            initial={emptyForm}
            categories={categoryOptions}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Product"
          />
        </Card>
      )}

      {selected.size > 0 && (
        <div className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-300">{selected.size} selected</span>
            <Select value={bulkAction} onChange={(e) => setBulkAction(e.target.value)} className="w-52">
              {BULK_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </Select>
            {bulkAction === 'CHANGE_CATEGORY' && (
              <Select value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)} className="w-52">
                <option value="" disabled>Select category</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            )}
            <Button disabled={bulkBusy || !bulkAction} onClick={handleBulk}>
              {bulkBusy ? 'Applying…' : 'Apply'}
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button variant="ghost" onClick={() => {
              if (!products.data) return;
              toggleSelectAll(products.data.products.map((p) => p.id));
            }}>
              Select page
            </Button>
          </div>
          {bulkError && <p className="mt-2 text-sm text-red-400">{bulkError}</p>}
        </div>
      )}

      <Card>
        {products.data && products.data.products.length > 0 ? (
          <>
            <Table headers={['', 'Product', 'Category', 'Price', 'Stock', 'Status', 'Actions']}>
              {products.data.products.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  editing={editingId === product.id}
                  stockEditor={stockForId === product.id}
                  selected={selected.has(product.id)}
                  categories={categoryOptions}
                  onToggleSelect={() => toggleSelected(product.id)}
                  onEdit={() => setEditingId(editingId === product.id ? null : product.id)}
                  onSave={handleUpdate}
                  onCancel={() => setEditingId(null)}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onStock={() => setStockForId(stockForId === product.id ? null : product.id)}
                  onAddStock={handleAddStock}
                />
              ))}
            </Table>
            <Pagination page={products.data.page} total={products.data.total} pageSize={products.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState title="No products found" message="Adjust filters or add a product." />
        )}
      </Card>
    </div>
  );
}

function ProductRow({ product, editing, stockEditor, selected, categories, onToggleSelect, onEdit, onSave, onCancel, onToggle, onDelete, onDuplicate, onStock, onAddStock }: {
  product: ProductDetail;
  editing: boolean;
  stockEditor: boolean;
  selected: boolean;
  categories: { id: string; name: string }[];
  onToggleSelect: () => void;
  onEdit: () => void;
  onSave: (form: ProductFormState) => Promise<void>;
  onCancel: () => void;
  onToggle: (product: ProductDetail) => Promise<void>;
  onDelete: (product: ProductDetail) => Promise<void>;
  onDuplicate: (product: ProductDetail) => Promise<void>;
  onStock: () => void;
  onAddStock: (product: ProductDetail, deliveryType: string, values: string[]) => Promise<void>;
}) {
  const [stockDeliveryType, setStockDeliveryType] = useState('DIGITAL_LINK');
  const [stockValues, setStockValues] = useState('');
  const [duplicating, setDuplicating] = useState(false);

  return (
    <>
      <tr>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-4 w-4 accent-cyan-500"
          />
        </td>
        <td className="px-3 py-2">
          <p className="font-medium text-slate-200">{product.name}</p>
          <p className="text-xs text-slate-500">{product.slug}</p>
        </td>
        <td className="px-3 py-2 text-slate-300">{product.category?.name ?? '—'}</td>
        <td className="px-3 py-2 text-slate-300">{formatMoney(product.price, product.currency)}</td>
        <td className="px-3 py-2">
          <span className="text-slate-300">{product.stockCount.available} available</span>
          <span className="ml-2 text-xs text-slate-500">({product.stockCount.reserved} res · {product.stockCount.sold} sold)</span>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={product.status} />
            {!product.isActive && <Badge tone="danger">Hidden</Badge>}
            {product.isFeatured && <Badge tone="accent">Featured</Badge>}
            {product.isPopular && <Badge tone="warning">Popular</Badge>}
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            <Button variant="ghost" onClick={onEdit}>{editing ? 'Close' : 'Edit'}</Button>
            <Button variant="ghost" onClick={onStock}>{stockEditor ? 'Close' : 'Stock'}</Button>
            <Button variant="ghost" disabled={duplicating} onClick={async () => {
              setDuplicating(true);
              try { await onDuplicate(product); } finally { setDuplicating(false); }
            }}>
              {duplicating ? '…' : 'Duplicate'}
            </Button>
            <Button variant={product.isActive ? 'danger' : 'subtle'} onClick={() => onToggle(product)}>
              {product.isActive ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="danger" onClick={() => onDelete(product)}>Delete</Button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={7} className="px-3 py-3">
            <ProductForm
              initial={toForm(product)}
              categories={categories}
              onSubmit={onSave}
              onCancel={onCancel}
              submitLabel="Save Changes"
            />
          </td>
        </tr>
      )}
      {stockEditor && (
        <tr>
          <td colSpan={7} className="px-3 py-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <p className="mb-2 text-xs text-slate-400">
                Add digital stock for <span className="text-slate-200">{product.name}</span>. Values are encrypted at rest.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Delivery type">
                  <Select value={stockDeliveryType} onChange={(e) => setStockDeliveryType(e.target.value)}>
                    {DELIVERY_TYPES.filter((t) => t !== 'MANUAL' && t !== 'SMM').map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Values" hint="One per line. e.g. license keys or links.">
                    <Textarea
                      value={stockValues}
                      onChange={(e) => setStockValues(e.target.value)}
                      placeholder={'value-1\nvalue-2\nvalue-3'}
                    />
                  </Field>
                </div>
              </div>
              <Button
                className="mt-3"
                disabled={!stockValues.trim()}
                onClick={() =>
                  onAddStock(
                    product,
                    stockDeliveryType,
                    stockValues.split('\n').map((v) => v.trim()).filter(Boolean)
                  )
                }
              >
                Add Stock
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
