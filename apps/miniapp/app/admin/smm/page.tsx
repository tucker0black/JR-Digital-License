'use client';

import { useState } from 'react';
import type { AdminSmmProvider, AdminSmmService } from '@jr/shared';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Select, StatusBadge, Table, formatMoney } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { humanizeError } from '@/lib/errors';
import {
  createAdminSmmProvider,
  createAdminSmmService,
  getAdminProducts,
  getAdminSmmProviders,
  getAdminSmmServices,
  setAdminSmmProviderStatus,
  setAdminSmmServiceStatus,
  updateAdminSmmProvider,
  updateAdminSmmService
} from '@/lib/api-admin';

export default function AdminSmmPage() {
  const providers = useAsync(() => getAdminSmmProviders(), []);
  const services = useAsync(() => getAdminSmmServices(), []);
  const products = useAsync(() => getAdminProducts({ pageSize: 100 }), []);
  const [showProvider, setShowProvider] = useState(false);
  const [showService, setShowService] = useState(false);

  const refresh = () => {
    providers.reload();
    services.reload();
  };

  if (providers.loading || services.loading) return <LoadingState label="Loading SMM configuration…" />;
  if (providers.error) return <ErrorState error={providers.error} onRetry={refresh} />;

  return (
    <div>
      <PageHeader
        title="SMM"
        description="SMM providers and services. API keys are encrypted at rest and never shown."
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowService((v) => !v)}>{showService ? 'Cancel' : '+ Add Service'}</Button>
            <Button onClick={() => setShowProvider((v) => !v)}>{showProvider ? 'Cancel' : '+ Add Provider'}</Button>
          </div>
        }
      />

      {showProvider && (
        <ProviderForm
          onDone={() => { setShowProvider(false); refresh(); }}
          onCancel={() => setShowProvider(false)}
        />
      )}

      <Card title="Providers" className="mb-4">
        {providers.data && providers.data.providers.length > 0 ? (
          <Table headers={['Name', 'API URL', 'Services', 'Status', 'Actions']}>
            {providers.data.providers.map((provider) => (
              <ProviderRow key={provider.id} provider={provider} onChanged={refresh} />
            ))}
          </Table>
        ) : (
          <EmptyState title="No providers" message="Add an SMM provider to create services." />
        )}
      </Card>

      {showService && (
        <ServiceForm
          providers={providers.data?.providers ?? []}
          products={products.data?.products ?? []}
          onDone={() => { setShowService(false); refresh(); }}
          onCancel={() => setShowService(false)}
        />
      )}

      <Card title="Services">
        {services.data && services.data.services.length > 0 ? (
          <Table headers={['Service', 'Provider', 'Service ID', 'Cost', 'Qty range', 'Linked product', 'Status', 'Actions']}>
            {services.data.services.map((service) => (
              <ServiceRow key={service.id} service={service} onChanged={refresh} />
            ))}
          </Table>
        ) : (
          <EmptyState title="No services" message="Add a service and link it to a product for automatic SMM delivery." />
        )}
      </Card>
    </div>
  );
}

function ProviderForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await createAdminSmmProvider({ name, apiUrl, apiKey });
      onDone();
    } catch (err) {
      setError(humanizeError('Unable to create provider', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add SMM provider" className="mb-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="API URL">
          <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} required placeholder="https://panel.example.com/api/v2" />
        </Field>
        <Field label="API key" hint="Encrypted at rest; never shown again">
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" required />
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy || !name || !apiUrl || !apiKey} onClick={submit}>{busy ? 'Creating…' : 'Create provider'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function ProviderRow({ provider, onChanged }: { provider: AdminSmmProvider; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(provider.name);
  const [apiUrl, setApiUrl] = useState(provider.apiUrl);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await updateAdminSmmProvider(provider.id, { name, apiUrl, apiKey: apiKey || undefined });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to save provider', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td className="px-3 py-2 font-medium text-slate-200">
        {editing ? <Input value={name} onChange={(e) => setName(e.target.value)} /> : provider.name}
      </td>
      <td className="px-3 py-2 text-slate-300">
        {editing ? <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} /> : provider.apiUrl}
      </td>
      <td className="px-3 py-2 text-slate-400">{provider.serviceCount}</td>
      <td className="px-3 py-2"><StatusBadge status={provider.status} /></td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {editing ? (
            <>
              <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          )}
          {editing && (
            <Field label="New API key (optional)">
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="Only to replace" />
            </Field>
          )}
          <Button
            variant={provider.status === 'ACTIVE' ? 'danger' : 'subtle'}
            onClick={async () => {
              try {
                await setAdminSmmProviderStatus(provider.id, provider.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE');
                onChanged();
              } catch (err) {
                setError(humanizeError('Unable to update provider status', err));
              }
            }}
          >
            {provider.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          </Button>
        </div>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  );
}

function ServiceForm({ providers, products, onDone, onCancel }: {
  providers: AdminSmmProvider[];
  products: { id: string; name: string }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [providerId, setProviderId] = useState('');
  const [providerServiceId, setProviderServiceId] = useState('');
  const [name, setName] = useState('');
  const [providerCost, setProviderCost] = useState('');
  const [minimumQuantity, setMinimumQuantity] = useState('1');
  const [maximumQuantity, setMaximumQuantity] = useState('1');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await createAdminSmmService({
        providerId,
        providerServiceId,
        name,
        providerCost: providerCost === '' ? null : providerCost,
        minimumQuantity: Number(minimumQuantity),
        maximumQuantity: Number(maximumQuantity),
        productId: productId || null
      });
      onDone();
    } catch (err) {
      setError(humanizeError('Unable to create service', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add SMM service" className="mb-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Provider">
          <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} required>
            <option value="" disabled>Select provider</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Provider service ID">
          <Input value={providerServiceId} onChange={(e) => setProviderServiceId(e.target.value)} required placeholder="e.g. 12345" />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Provider cost" hint="Cost per unit charged by provider">
          <Input value={providerCost} onChange={(e) => setProviderCost(e.target.value)} type="number" step="0.0001" min="0" />
        </Field>
        <Field label="Min quantity">
          <Input value={minimumQuantity} onChange={(e) => setMinimumQuantity(e.target.value)} type="number" min="1" />
        </Field>
        <Field label="Max quantity">
          <Input value={maximumQuantity} onChange={(e) => setMaximumQuantity(e.target.value)} type="number" min="1" />
        </Field>
        <Field label="Linked product" hint="Optional — enables automatic SMM delivery">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">No product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy || !providerId || !providerServiceId || !name} onClick={submit}>{busy ? 'Creating…' : 'Create service'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function ServiceRow({ service, onChanged }: { service: AdminSmmService; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(service.name);
  const [providerServiceId, setProviderServiceId] = useState(service.providerServiceId);
  const [providerCost, setProviderCost] = useState(service.providerCost ?? '');
  const [minimumQuantity, setMinimumQuantity] = useState(String(service.minimumQuantity));
  const [maximumQuantity, setMaximumQuantity] = useState(String(service.maximumQuantity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await updateAdminSmmService(service.id, {
        name,
        providerServiceId,
        providerCost: providerCost === '' ? null : providerCost,
        minimumQuantity: Number(minimumQuantity),
        maximumQuantity: Number(maximumQuantity)
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to save service', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td className="px-3 py-2">
        <p className="font-medium text-slate-200">{editing ? <Input value={name} onChange={(e) => setName(e.target.value)} /> : service.name}</p>
      </td>
      <td className="px-3 py-2 text-slate-300">{service.provider.name}</td>
      <td className="px-3 py-2 text-slate-400">
        {editing ? <Input value={providerServiceId} onChange={(e) => setProviderServiceId(e.target.value)} /> : service.providerServiceId}
      </td>
      <td className="px-3 py-2 text-slate-300">
        {editing ? (
          <Input value={providerCost} onChange={(e) => setProviderCost(e.target.value)} type="number" step="0.0001" min="0" />
        ) : (
          service.providerCost ? formatMoney(service.providerCost, 'USD') : '—'
        )}
      </td>
      <td className="px-3 py-2 text-slate-400">
        {editing ? (
          <div className="flex gap-2">
            <Input value={minimumQuantity} onChange={(e) => setMinimumQuantity(e.target.value)} type="number" min="1" className="w-20" />
            <Input value={maximumQuantity} onChange={(e) => setMaximumQuantity(e.target.value)} type="number" min="1" className="w-20" />
          </div>
        ) : (
          `${service.minimumQuantity} – ${service.maximumQuantity}`
        )}
      </td>
      <td className="max-w-40 truncate px-3 py-2 text-slate-400">{service.product ? service.product.name : '—'}</td>
      <td className="px-3 py-2"><StatusBadge status={service.status} /></td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {editing ? (
            <>
              <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          )}
          <Button
            variant={service.status === 'ACTIVE' ? 'danger' : 'subtle'}
            onClick={async () => {
              try {
                await setAdminSmmServiceStatus(service.id, service.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE');
                onChanged();
              } catch (err) {
                setError(humanizeError('Unable to update service status', err));
              }
            }}
          >
            {service.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          </Button>
        </div>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        {service.status === 'ACTIVE' && service.productId && <Badge tone="success" >Auto-delivery</Badge>}
      </td>
    </tr>
  );
}