'use client';

import { useState } from 'react';
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
  Select,
  StatusBadge,
  Table,
  Textarea,
  formatMoney
} from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { MediaImageField, MediaThumb } from '@/components/admin/MediaImageField';
import { humanizeError } from '@/lib/errors';
import {
  createAdminTopUpGame,
  createAdminTopUpPackage,
  createAdminTopUpProvider,
  createAdminTopUpProviderService,
  deleteAdminTopUpGame,
  deleteAdminTopUpGameConfig,
  deleteAdminTopUpPackage,
  deleteAdminTopUpProvider,
  deleteAdminTopUpProviderService,
  fetchRemoteProviderCategories,
  fetchRemoteProviderOffers,
  getAdminTopUpGameConfigs,
  getAdminTopUpGames,
  getAdminTopUpPackages,
  getAdminTopUpProviderServices,
  getAdminTopUpProviders,
  getAdminTopUpValidationSupport,
  setAdminTopUpGameStatus,
  setAdminTopUpPackageStatus,
  setAdminTopUpProviderServiceStatus,
  setAdminTopUpProviderStatus,
  testAdminTopUpProvider,
  updateAdminTopUpGame,
  updateAdminTopUpPackage,
  updateAdminTopUpProvider,
  updateAdminTopUpProviderService,
  upsertAdminTopUpGameConfig,
  type AdminTopUpCustomField,
  type AdminTopUpGame,
  type AdminTopUpGameConfig,
  type AdminTopUpPackage,
  type AdminTopUpProvider,
  type AdminTopUpProviderService,
  type RemoteCatalogWarning,
  type RemoteProviderCategory,
  type RemoteProviderOffer,
  type RemoteProviderOfferField
} from '@/lib/api-admin';

type Tab = 'providers' | 'services' | 'games' | 'packages' | 'config';

const TABS: { key: Tab; label: string }[] = [
  { key: 'providers', label: 'Providers' },
  { key: 'services', label: 'Provider Services' },
  { key: 'games', label: 'Games' },
  { key: 'packages', label: 'Packages' },
  { key: 'config', label: 'Game Input Config' }
];

const NOTE_COLORS = ['WARNING', 'INFO', 'SUCCESS', 'DANGER', 'PURPLE'] as const;

function formatPackageContent(pkg: AdminTopUpPackage): string {
  return pkg.content?.trim() || pkg.name.trim() || `${pkg.diamondAmount.toLocaleString()} Diamonds`;
}

export default function AdminTopUpPage() {
  const [tab, setTab] = useState<Tab>('providers');
  const [showProvider, setShowProvider] = useState(false);
  const [showService, setShowService] = useState(false);
  const [showGame, setShowGame] = useState(false);
  const [showPackage, setShowPackage] = useState(false);

  const providers = useAsync(() => getAdminTopUpProviders(), []);
  const services = useAsync(() => getAdminTopUpProviderServices({ pageSize: 100 }), []);
  const games = useAsync(() => getAdminTopUpGames(), []);
  const packages = useAsync(() => getAdminTopUpPackages({ pageSize: 100 }), []);
  const configs = useAsync(() => getAdminTopUpGameConfigs(), []);

  const refresh = () => {
    providers.reload();
    services.reload();
    games.reload();
    packages.reload();
    configs.reload();
  };

  if (providers.loading || services.loading || games.loading || packages.loading || configs.loading) {
    return <LoadingState label="Loading Top-Up configuration…" />;
  }
  if (providers.error) return <ErrorState error={providers.error} onRetry={refresh} />;

  return (
    <div>
      <PageHeader
        title="Top Up"
        description="Configure top-up providers, services, games, packages, and customer input fields."
        action={
          <div className="flex flex-wrap gap-2">
            {tab === 'providers' && (
              <Button onClick={() => setShowProvider((v) => !v)}>{showProvider ? 'Cancel' : '+ Add Provider'}</Button>
            )}
            {tab === 'services' && (
              <Button onClick={() => setShowService((v) => !v)}>{showService ? 'Cancel' : '+ Add Service'}</Button>
            )}
            {tab === 'games' && (
              <Button onClick={() => setShowGame((v) => !v)}>{showGame ? 'Cancel' : '+ Add Game'}</Button>
            )}
            {tab === 'packages' && (
              <Button onClick={() => setShowPackage((v) => !v)}>{showPackage ? 'Cancel' : '+ Add Package'}</Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'providers' && (
        <>
          {showProvider && (
            <ProviderForm
              onDone={() => { setShowProvider(false); refresh(); }}
              onCancel={() => setShowProvider(false)}
            />
          )}
          <Card title="Providers" description="API keys are encrypted at rest and never shown again.">
            {providers.data && providers.data.providers.length > 0 ? (
              <Table headers={['Name', 'API URL', 'Packages', 'Status', 'Actions']}>
                {providers.data.providers.map((provider) => (
                  <ProviderRow key={provider.id} provider={provider} onChanged={refresh} />
                ))}
              </Table>
            ) : (
              <EmptyState title="No providers" message="Add a top-up provider to create services and games." />
            )}
          </Card>
        </>
      )}

      {tab === 'services' && (
        <>
          {showService && (
            <ServiceForm
              providers={providers.data?.providers ?? []}
              onDone={() => { setShowService(false); refresh(); }}
              onCancel={() => setShowService(false)}
            />
          )}
          <Card title="Provider Services" description="Each provider can have multiple services (e.g. Free Fire Diamonds, ML Diamonds).">
            {services.data && services.data.services.length > 0 ? (
              <Table headers={['Service', 'Provider', 'Service ID', 'Games', 'Packages', 'Status', 'Actions']}>
                {services.data.services.map((service) => (
                  <ServiceRow key={service.id} service={service} onChanged={refresh} />
                ))}
              </Table>
            ) : (
              <EmptyState title="No provider services" message="Add a service and link it to a game." />
            )}
          </Card>
        </>
      )}

      {tab === 'games' && (
        <>
          {showGame && (
            <GameForm
              providers={providers.data?.providers ?? []}
              services={services.data?.services ?? []}
              onDone={() => { setShowGame(false); refresh(); }}
              onCancel={() => setShowGame(false)}
            />
          )}
          <Card title="Games" description="Games shown to customers in the Top-Up flow. Every game is manageable here.">
            {games.data && games.data.games.length > 0 ? (
              <Table headers={['Game', 'Image', 'Provider', 'Service', 'Packages', 'Status', 'Actions']}>
                {games.data.games.map((game) => (
                  <GameRow
                    key={game.id}
                    game={game}
                    providers={providers.data?.providers ?? []}
                    services={services.data?.services ?? []}
                    onChanged={refresh}
                  />
                ))}
              </Table>
            ) : (
              <EmptyState title="No games" message="Add a game to start offering top-ups." />
            )}
          </Card>
        </>
      )}

      {tab === 'packages' && (
        <>
          {showPackage && (
            <PackageForm
              games={games.data?.games ?? []}
              onDone={() => { setShowPackage(false); refresh(); }}
              onCancel={() => setShowPackage(false)}
            />
          )}
          <Card title="Packages" description="Packages belong to one game. Customers only see packages for the selected game.">
            {packages.data && packages.data.packages.length > 0 ? (
              <Table headers={['Package', 'Game', 'Product Content / Quantity', 'Price', 'Provider Cost', 'Provider Offer ID', 'Status', 'Actions']}>
                {packages.data.packages.map((pkg) => (
                  <PackageRow
                    key={pkg.id}
                    pkg={pkg}
                    games={games.data?.games ?? []}
                    onChanged={refresh}
                  />
                ))}
              </Table>
            ) : (
              <EmptyState title="No packages" message="Add a package and link it to a game." />
            )}
          </Card>
        </>
      )}

      {tab === 'config' && (
        <Card title="Game Input Configuration" description="Configure which fields customers must fill in for each game.">
          {configs.data && configs.data.configs.length > 0 ? (
            <div className="space-y-4">
              {configs.data.configs.map((config) => (
                <GameConfigRow
                  key={config.id}
                  config={config}
                  games={games.data?.games ?? []}
                  onChanged={refresh}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No game input configurations" message="Select a game below to configure its input fields." />
          )}
          <div className="mt-6 border-t border-slate-800 pt-4">
            <GameConfigForm
              games={games.data?.games ?? []}
              onDone={refresh}
            />
          </div>
          <div className="mt-6 border-t border-slate-800 pt-4">
            <ValidationSupportPanel />
          </div>
        </Card>
      )}
    </div>
  );
}

// ==================== PROVIDERS ====================

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
      await createAdminTopUpProvider({ name, apiUrl, apiKey });
      onDone();
    } catch (err) {
      setError(humanizeError('Unable to create provider', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add top-up provider" className="mb-4">
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

function ProviderRow({ provider, onChanged }: { provider: AdminTopUpProvider; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(provider.name);
  const [apiUrl, setApiUrl] = useState(provider.apiUrl);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await updateAdminTopUpProvider(provider.id, { name, apiUrl, apiKey: apiKey || undefined });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to save provider', err));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTestResult(null);
    setTesting(true);
    try {
      const result = await testAdminTopUpProvider(provider.id);
      if (result.success) {
        const balanceInfo = result.balance != null
          ? ` — Balance: ${result.currency ?? ''} ${result.balance.toFixed(2)}`
          : '';
        setTestResult(`Connection OK${balanceInfo}`);
      } else {
        setTestResult(result.error ?? 'Connection failed');
      }
    } catch (err) {
      setTestResult(humanizeError('Test failed', err));
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    const confirmed = window.confirm(
      `Delete provider "${provider.name}"? Only providers with no linked packages can be deleted.`
    );
    if (!confirmed) return;
    setError(null);
    setBusy(true);
    try {
      await deleteAdminTopUpProvider(provider.id);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to delete provider', err));
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
      <td className="px-3 py-2 text-slate-400">{provider.packageCount}</td>
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
          <Button variant="ghost" disabled={testing} onClick={test}>{testing ? 'Testing…' : 'Test'}</Button>
          <Button
            variant={provider.status === 'ACTIVE' ? 'danger' : 'subtle'}
            onClick={async () => {
              try {
                await setAdminTopUpProviderStatus(provider.id, provider.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE');
                onChanged();
              } catch (err) {
                setError(humanizeError('Unable to update provider status', err));
              }
            }}
          >
            {provider.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          </Button>
          <Button variant="danger" onClick={remove}>Delete</Button>
        </div>
        {testResult && <p className="mt-1 text-xs text-slate-400">{testResult}</p>}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  );
}

// ==================== PROVIDER SERVICES ====================

function ServiceForm({ providers, onDone, onCancel }: {
  providers: AdminTopUpProvider[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [providerId, setProviderId] = useState('');
  const [providerServiceId, setProviderServiceId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<RemoteProviderCategory[]>([]);
  const [catalogWarnings, setCatalogWarnings] = useState<RemoteCatalogWarning[]>([]);
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');

  const loadCategories = async () => {
    if (!providerId) return;
    setLoadingCategories(true);
    setCategoryError(null);
    setCategories([]);
    setCatalogWarnings([]);
    setSelectedCategoryId('');
    try {
      const result = await fetchRemoteProviderCategories(providerId);
      setCategories(result.categories ?? []);
      setCatalogTotal(result.total ?? result.categories?.length ?? null);
      // Services configured earlier whose external IDs are no longer served
      // by the provider account are reported here — never deleted or disabled.
      setCatalogWarnings(result.warnings ?? []);
    } catch (err) {
      setCategoryError(humanizeError('Failed to load categories', err));
    } finally {
      setLoadingCategories(false);
    }
  };

  const selectedCategory = categories.find((c) => c.category_id === selectedCategoryId);
  const filteredCategories = catalogSearch.trim()
    ? categories.filter((cat) => {
        const q = catalogSearch.trim().toLowerCase();
        return cat.name.toLowerCase().includes(q)
          || cat.category_id.toLowerCase().includes(q)
          || (cat.region ?? '').toLowerCase().includes(q);
      })
    : categories;

  const handleCategorySelect = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    const cat = categories.find((c) => c.category_id === categoryId);
    if (cat) {
      setProviderServiceId(cat.category_id);
      setName(cat.name);
    }
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await createAdminTopUpProviderService({ providerId, providerServiceId, name });
      onDone();
    } catch (err) {
      setError(humanizeError('Unable to create service', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add provider service" className="mb-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Provider">
          <Select value={providerId} onChange={(e) => {
            setProviderId(e.target.value);
            setCategories([]);
            setSelectedCategoryId('');
            setProviderServiceId('');
            setName('');
            setCategoryError(null);
            setCatalogWarnings([]);
          }} required>
            <option value="" disabled>Select provider</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Fetch from Provider API" hint="Loads the full live catalog (all pages)">
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={!providerId || loadingCategories}
                onClick={loadCategories}
              >
                {loadingCategories ? 'Loading…' : 'Fetch Services'}
              </Button>
              {categories.length > 0 && (
                <span className="self-center text-xs text-slate-400">
                  {categories.length} loaded{catalogTotal != null ? ` of ${catalogTotal}` : ''}
                </span>
              )}
            </div>
          </Field>
        </div>
      </div>
      {categoryError && <p className="mt-2 text-sm text-red-400">{categoryError}</p>}
      {catalogWarnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm font-medium text-amber-300">Services missing from this provider account</p>
          <p className="mt-1 text-xs text-amber-200/80">
            These stored services were not found in the live FazerCards catalog. Their database
            configuration was preserved — review them below and re-point them at valid services.
          </p>
          <ul className="mt-2 space-y-1">
            {catalogWarnings.map((warning) => (
              <li key={warning.id} className="text-xs text-amber-200">
                {warning.name} — external ID <code>{warning.providerServiceId}</code> not offered by this account
              </li>
            ))}
          </ul>
        </div>
      )}
      {categories.length > 0 && (
        <div className="mt-3 space-y-3">
          <Field label="Search catalog" hint="Filter by game name, region or service ID">
            <Input value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} placeholder="e.g. Free Fire, Singapore…" />
          </Field>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-900 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Game</th>
                  <th className="px-3 py-2">Region</th>
                  <th className="px-3 py-2">Service ID</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filteredCategories.map((cat) => (
                  <tr key={cat.category_id} className={`border-t border-slate-800 ${selectedCategoryId === cat.category_id ? 'bg-cyan-500/10' : ''}`}>
                    <td className="px-3 py-2 text-slate-200" title={cat.note ?? undefined}>{cat.name}</td>
                    <td className="px-3 py-2 text-slate-400">{cat.region ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-300">{cat.category_id}</td>
                    <td className="px-3 py-2">
                      <Button
                        variant={selectedCategoryId === cat.category_id ? 'subtle' : 'ghost'}
                        onClick={() => handleCategorySelect(cat.category_id)}
                      >
                        {selectedCategoryId === cat.category_id ? 'Selected' : 'Select'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {filteredCategories.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-3 text-center text-xs text-slate-500">No matching services.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {selectedCategory && (
            <p className="text-xs text-slate-400">
              Selected: <span className="text-slate-200">{selectedCategory.name}</span>
              {selectedCategory.note ? ` — ${selectedCategory.note.split('\n')[0]}` : ''}
            </p>
          )}
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Provider service ID" hint="Auto-filled from selected category">
          <Input
            value={providerServiceId}
            onChange={(e) => setProviderServiceId(e.target.value)}
            required
            placeholder="e.g. free_fire_sg"
          />
        </Field>
        <Field label="Name" hint="Auto-filled from selected category">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Game category name"
          />
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

function ServiceRow({ service, onChanged }: { service: AdminTopUpProviderService; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [providerServiceId, setProviderServiceId] = useState(service.providerServiceId);
  const [name, setName] = useState(service.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await updateAdminTopUpProviderService(service.id, { name, providerServiceId });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to save service', err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = window.confirm(
      `Delete service "${service.name}"? Only services with no linked games or packages can be deleted.`
    );
    if (!confirmed) return;
    setError(null);
    setBusy(true);
    try {
      await deleteAdminTopUpProviderService(service.id);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to delete service', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td className="px-3 py-2">
        <p className="font-medium text-slate-200">{editing ? <Input value={name} onChange={(e) => setName(e.target.value)} /> : service.name}</p>
      </td>
      <td className="px-3 py-2 text-slate-300">{service.provider?.name ?? '—'}</td>
      <td className="px-3 py-2 text-slate-400">
        {editing ? <Input value={providerServiceId} onChange={(e) => setProviderServiceId(e.target.value)} /> : service.providerServiceId}
      </td>
      <td className="px-3 py-2 text-slate-400">{service.gameCount}</td>
      <td className="px-3 py-2 text-slate-400">{service.packageCount}</td>
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
                await setAdminTopUpProviderServiceStatus(service.id, service.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE');
                onChanged();
              } catch (err) {
                setError(humanizeError('Unable to update service status', err));
              }
            }}
          >
            {service.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          </Button>
          <Button variant="danger" onClick={remove}>Delete</Button>
        </div>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  );
}

// ==================== GAMES ====================

function GameForm({ providers, services, onDone, onCancel }: {
  providers: AdminTopUpProvider[];
  services: AdminTopUpProviderService[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [providerId, setProviderId] = useState('');
  const [providerServiceId, setProviderServiceId] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredServices = providerId
    ? services.filter((s) => s.providerId === providerId)
    : [];

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await createAdminTopUpGame({
        name,
        imageUrl: imageUrl || null,
        providerId: providerId || null,
        providerServiceId: providerId ? providerServiceId || undefined : undefined,
        isActive: true,
        sortOrder: Number(sortOrder || 0)
      });
      onDone();
    } catch (err) {
      setError(humanizeError('Unable to create game', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add game" className="mb-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Game name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Free Fire" />
        </Field>
        <MediaImageField
          label="Game Logo"
          value={imageUrl}
          onChange={setImageUrl}
          hint="Uploaded logos are stored permanently — they never expire and are never removed automatically."
        />
        <Field label="Sort order">
          <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" />
        </Field>
        <Field label="Provider">
          <Select value={providerId} onChange={(e) => { setProviderId(e.target.value); setProviderServiceId(''); }}>
            <option value="">No provider</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Provider service" hint="Service used for this game's top-ups">
          <Select value={providerServiceId} onChange={(e) => setProviderServiceId(e.target.value)} disabled={!providerId}>
            <option value="">Select service</option>
            {filteredServices.map((service) => (
              <option key={service.id} value={service.id}>{service.name} ({service.providerServiceId})</option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy || !name} onClick={submit}>{busy ? 'Creating…' : 'Create game'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function GameRow({ game, providers, services, onChanged }: {
  game: AdminTopUpGame;
  providers: AdminTopUpProvider[];
  services: AdminTopUpProviderService[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(game.name);
  const [imageUrl, setImageUrl] = useState(game.imageUrl ?? '');
  const [providerId, setProviderId] = useState(game.providerId ?? '');
  const [providerServiceId, setProviderServiceId] = useState(game.providerServiceId ?? '');
  const [sortOrder, setSortOrder] = useState(String(game.sortOrder));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredServices = providerId
    ? services.filter((s) => s.providerId === providerId)
    : [];

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await updateAdminTopUpGame(game.id, {
        name,
        imageUrl: imageUrl || null,
        providerId: providerId || null,
        providerServiceId: providerId ? providerServiceId || undefined : undefined,
        sortOrder: Number(sortOrder || 0)
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to save game', err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = window.confirm(
      `Delete game "${game.name}"? Only games with no packages can be deleted. Use Disable to hide it.`
    );
    if (!confirmed) return;
    setError(null);
    setBusy(true);
    try {
      await deleteAdminTopUpGame(game.id);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to delete game', err));
    } finally {
      setBusy(false);
    }
  };

  const serviceName = game.providerServiceId
    ? services.find((s) => s.id === game.providerServiceId)?.name ?? game.providerServiceId
    : '—';

  return (
    <tr>
      <td className="px-3 py-2">
        {editing ? <Input value={name} onChange={(e) => setName(e.target.value)} /> : (
          <p className="font-medium text-slate-200">{game.name}</p>
        )}
      </td>
      <td className="px-3 py-2">
        <MediaThumb url={game.imageUrl} title={game.name} />
      </td>
      <td className="px-3 py-2 text-slate-300">{game.provider?.name ?? '—'}</td>
      <td className="px-3 py-2 text-slate-400">{serviceName}</td>
      <td className="px-3 py-2 text-slate-400">{game.packageCount}</td>
      <td className="px-3 py-2"><StatusBadge status={game.isActive ? 'ACTIVE' : 'DISABLED'} /></td>
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
            variant={game.isActive ? 'danger' : 'subtle'}
            onClick={async () => {
              try {
                await setAdminTopUpGameStatus(game.id, !game.isActive);
                onChanged();
              } catch (err) {
                setError(humanizeError('Unable to update game status', err));
              }
            }}
          >
            {game.isActive ? 'Disable' : 'Enable'}
          </Button>
          <Button variant="danger" onClick={remove}>Delete</Button>
        </div>
        {editing && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <MediaImageField
              label="Game Logo"
              value={imageUrl}
              onChange={setImageUrl}
            />
            <Field label="Sort order">
              <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" />
            </Field>
            <Field label="Provider">
              <Select value={providerId} onChange={(e) => { setProviderId(e.target.value); setProviderServiceId(''); }}>
                <option value="">No provider</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Provider service">
              <Select value={providerServiceId} onChange={(e) => setProviderServiceId(e.target.value)} disabled={!providerId}>
                <option value="">Select service</option>
                {filteredServices.map((service) => (
                  <option key={service.id} value={service.id}>{service.name} ({service.providerServiceId})</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  );
}

// ==================== PACKAGES ====================

function PackageForm({ games, onDone, onCancel }: {
  games: AdminTopUpGame[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [gameId, setGameId] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [price, setPrice] = useState('');
  const [providerCost, setProviderCost] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [imageUrl, setImageUrl] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [noteColor, setNoteColor] = useState<'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'PURPLE'>('WARNING');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [offers, setOffers] = useState<RemoteProviderOffer[]>([]);
  const [offerFields, setOfferFields] = useState<RemoteProviderOfferField[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState('');

  const selectedGame = games.find((g) => g.id === gameId);
  const gameProviderId = selectedGame?.providerId ?? null;
  const gameProviderServiceId = selectedGame?.providerServiceId ?? null;

  const loadOffers = async () => {
    if (!gameProviderId || !gameProviderServiceId) return;
    setLoadingOffers(true);
    setOfferError(null);
    setOffers([]);
    setOfferFields([]);
    setSelectedOfferId('');
    try {
      // The API accepts the internal service reference and resolves the
      // external FazerCards category ID server-side.
      const result = await fetchRemoteProviderOffers(gameProviderId, gameProviderServiceId);
      setOffers(result.offers ?? []);
      setOfferFields(result.fields ?? []);
    } catch (err) {
      setOfferError(humanizeError('Failed to load offers', err));
    } finally {
      setLoadingOffers(false);
    }
  };

  const handleOfferSelect = (offerId: string) => {
    setSelectedOfferId(offerId);
    const offer = offers.find((o) => o.offer_id === offerId);
    if (offer) {
      // Provider data pre-fills name, quantity hint and the provider COST.
      // The customer-facing selling price is NEVER taken from the provider —
      // the admin sets it explicitly.
      setName(offer.offer_name);
      setContent(offer.offer_name);
      setProviderCost(String(offer.price_usd));
    }
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await createAdminTopUpPackage({
        gameId,
        name,
        content,
        price,
        providerCost: providerCost === '' ? null : providerCost,
        providerOfferId: selectedOfferId || null,
        isActive: true,
        sortOrder: Number(sortOrder || 0),
        imageUrl: imageUrl || null,
        customerNote: customerNote || null,
        noteColor
      });
      onDone();
    } catch (err) {
      setError(humanizeError('Unable to create package', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add package" className="mb-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Game">
          <Select value={gameId} onChange={(e) => {
            setGameId(e.target.value);
            setOffers([]);
            setSelectedOfferId('');
            setOfferError(null);
          }} required>
            <option value="" disabled>Select game</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>{game.name}</option>
            ))}
          </Select>
        </Field>
        {gameProviderId && gameProviderServiceId && (
          <div className="sm:col-span-2">
            <Field label="Fetch Offers from Provider">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={!gameId || loadingOffers}
                  onClick={loadOffers}
                >
                  {loadingOffers ? 'Loading…' : 'Fetch Offers from Provider'}
                </Button>
                {offers.length > 0 && (
                  <span className="self-center text-xs text-slate-400">{offers.length} offers loaded</span>
                )}
              </div>
            </Field>
          </div>
        )}
      </div>
      {offerError && <p className="mt-2 text-sm text-red-400">{offerError}</p>}
      {offerFields.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Provider input fields for this service: {offerFields.map((f) => f.label).join(', ')} — configure them in
          Game Input Config so customers are asked for exactly these values.
        </p>
      )}
      {offers.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Provider Offer" hint="Select an offer from the live API to auto-fill details">
            <Select value={selectedOfferId} onChange={(e) => handleOfferSelect(e.target.value)}>
              <option value="" disabled>Select offer</option>
              {offers.map((offer) => (
                <option key={offer.offer_id} value={offer.offer_id}>
                  {offer.offer_name} - ${offer.price_usd.toFixed(2)} USD
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Package name" hint="Auto-filled from selected offer">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. 100 Diamonds" />
        </Field>
        <Field label="Product Content / Quantity" hint="Text, numbers, or both. This is shown to customers.">
          <Input value={content} onChange={(e) => setContent(e.target.value)} required placeholder="e.g. 60 UC, Prime (1 Month), 25 Diamonds" />
        </Field>
        <Field label="Selling price" hint="You set this — provider prices are never copied here">
          <Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" min="0" required />
        </Field>
        <Field label="Provider cost" hint="Cost charged by provider">
          <Input value={providerCost} onChange={(e) => setProviderCost(e.target.value)} type="number" step="0.0001" min="0" />
        </Field>
        <Field label="Sort order">
          <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" />
        </Field>
        <MediaImageField
          label="Package Image"
          value={imageUrl}
          onChange={setImageUrl}
        />
        <Field label="Note color">
          <Select value={noteColor} onChange={(e) => setNoteColor(e.target.value as typeof noteColor)}>
            {NOTE_COLORS.map((color) => (
              <option key={color} value={color}>{color}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Customer note" hint="Shown to customers before checkout">
          <Textarea value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} />
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy || !gameId || !name || !content || !price} onClick={submit}>{busy ? 'Creating…' : 'Create package'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function PackageRow({ pkg, games, onChanged }: {
  pkg: AdminTopUpPackage;
  games: AdminTopUpGame[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [gameId, setGameId] = useState(pkg.gameId);
  const [name, setName] = useState(pkg.name);
  const [content, setContent] = useState(formatPackageContent(pkg));
  const [price, setPrice] = useState(pkg.price);
  const [providerCost, setProviderCost] = useState(pkg.providerCost ?? '');
  const [providerOfferId, setProviderOfferId] = useState(pkg.providerOfferId ?? '');
  const [sortOrder, setSortOrder] = useState(String(pkg.sortOrder));
  const [imageUrl, setImageUrl] = useState(pkg.imageUrl ?? '');
  const [customerNote, setCustomerNote] = useState(pkg.customerNote ?? '');
  const [noteColor, setNoteColor] = useState<'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'PURPLE'>(pkg.noteColor ?? 'WARNING');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offers, setOffers] = useState<RemoteProviderOffer[]>([]);
  const [offerFields, setOfferFields] = useState<RemoteProviderOfferField[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);

  const selectedGame = games.find((game) => game.id === gameId);
  const gameProviderId = selectedGame?.providerId ?? null;
  const gameProviderServiceId = selectedGame?.providerServiceId ?? null;

  const loadOffers = async () => {
    if (!gameProviderId || !gameProviderServiceId) return;
    setLoadingOffers(true);
    setOfferError(null);
    setOffers([]);
    setOfferFields([]);
    try {
      // Reuse the same server-side provider-service resolution as Add Package.
      const result = await fetchRemoteProviderOffers(gameProviderId, gameProviderServiceId);
      setOffers(result.offers ?? []);
      setOfferFields(result.fields ?? []);
    } catch (err) {
      setOfferError(humanizeError('Failed to load offers', err));
    } finally {
      setLoadingOffers(false);
    }
  };

  const handleOfferSelect = (offerId: string) => {
    setProviderOfferId(offerId);
    const offer = offers.find((item) => item.offer_id === offerId);
    if (offer) {
      // Offer selection changes only provider mapping and customer content;
      // the existing selling price remains under explicit admin control.
      setContent(offer.offer_name);
      setProviderCost(String(offer.price_usd));
    }
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await updateAdminTopUpPackage(pkg.id, {
        gameId,
        name,
        content,
        price,
        providerCost: providerCost === '' ? null : providerCost,
        providerOfferId: providerOfferId === '' ? null : providerOfferId,
        sortOrder: Number(sortOrder || 0),
        imageUrl: imageUrl || null,
        customerNote: customerNote || null,
        noteColor
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to save package', err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = window.confirm(
      `Delete package "${pkg.name}"? Only packages with no historical orders can be deleted. Use Disable to hide it.`
    );
    if (!confirmed) return;
    setError(null);
    setBusy(true);
    try {
      await deleteAdminTopUpPackage(pkg.id);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to delete package', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td className="px-3 py-2">
        <p className="font-medium text-slate-200">{pkg.name}</p>
        <div className="mt-1"><MediaThumb url={pkg.imageUrl} title={pkg.name} /></div>
      </td>
       <td className="px-3 py-2 text-slate-300">{pkg.game}</td>
       <td className="px-3 py-2 text-slate-300">{formatPackageContent(pkg)}</td>
      <td className="px-3 py-2 text-slate-300">{formatMoney(pkg.price, pkg.currency)}</td>
      <td className="px-3 py-2 text-slate-400">{pkg.providerCost ? formatMoney(pkg.providerCost, pkg.currency) : '—'}</td>
      <td className="px-3 py-2 font-mono text-xs text-slate-400">{pkg.providerOfferId ?? '—'}</td>
      <td className="px-3 py-2"><StatusBadge status={pkg.isActive ? 'ACTIVE' : 'DISABLED'} /></td>
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
            variant={pkg.isActive ? 'danger' : 'subtle'}
            onClick={async () => {
              try {
                await setAdminTopUpPackageStatus(pkg.id, !pkg.isActive);
                onChanged();
              } catch (err) {
                setError(humanizeError('Unable to update package status', err));
              }
            }}
          >
            {pkg.isActive ? 'Disable' : 'Enable'}
          </Button>
          <Button variant="danger" onClick={remove}>Delete</Button>
        </div>
        {editing && (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="Game">
              <Select value={gameId} onChange={(e) => {
                setGameId(e.target.value);
                setOffers([]);
                setOfferFields([]);
                setOfferError(null);
              }}>
                {games.map((game) => (
                  <option key={game.id} value={game.id}>{game.name}</option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Fetch Offers from Provider" hint="Loads live offers without changing the selling price.">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    disabled={!gameProviderId || !gameProviderServiceId || loadingOffers}
                    onClick={loadOffers}
                  >
                    {loadingOffers ? 'Loading…' : 'Fetch Offers from Provider'}
                  </Button>
                  {offers.length > 0 && (
                    <span className="text-xs text-slate-400">{offers.length} offers loaded</span>
                  )}
                </div>
              </Field>
            </div>
            {offerError && <p className="sm:col-span-3 text-sm text-red-400">{offerError}</p>}
            {offerFields.length > 0 && (
              <p className="sm:col-span-3 text-xs text-slate-400">
                Provider input fields for this service: {offerFields.map((field) => field.label).join(', ')}.
              </p>
            )}
            {offers.length > 0 && (
              <Field label="Provider Offer" hint="Selecting an offer updates its ID, provider cost, and content.">
                <Select value={providerOfferId} onChange={(e) => handleOfferSelect(e.target.value)}>
                  <option value="" disabled>Select offer</option>
                  {providerOfferId && !offers.some((offer) => offer.offer_id === providerOfferId) && (
                    <option value={providerOfferId}>Current: {providerOfferId}</option>
                  )}
                  {offers.map((offer) => (
                    <option key={offer.offer_id} value={offer.offer_id}>
                      {offer.offer_name} - ${offer.price_usd.toFixed(2)} USD
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Product Content / Quantity" hint="Text, numbers, or both. This is shown to customers.">
              <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. 60 UC, Prime (1 Month), 25 Diamonds" />
            </Field>
            <Field label="Price">
              <Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" min="0" />
            </Field>
            <Field label="Provider cost">
              <Input value={providerCost} onChange={(e) => setProviderCost(e.target.value)} type="number" step="0.0001" min="0" />
            </Field>
            <Field label="Provider Offer ID" hint="External offer ID from Fetch Offers">
              <Input value={providerOfferId} onChange={(e) => setProviderOfferId(e.target.value)} placeholder="e.g. 25_diamonds" />
            </Field>
            <Field label="Sort order">
              <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" />
            </Field>
            <MediaImageField
              label="Package Image"
              value={imageUrl}
              onChange={setImageUrl}
            />
            <Field label="Note color">
              <Select value={noteColor} onChange={(e) => setNoteColor(e.target.value as typeof noteColor)}>
                {NOTE_COLORS.map((color) => (
                  <option key={color} value={color}>{color}</option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-3">
              <Field label="Customer note">
                <Textarea value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} />
              </Field>
            </div>
          </div>
        )}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  );
}

// ==================== GAME INPUT CONFIGURATION ====================

function GameConfigForm({ games, onDone }: { games: AdminTopUpGame[]; onDone: () => void }) {
  const [gameId, setGameId] = useState('');
  const [requirePlayerId, setRequirePlayerId] = useState(true);
  const [requireServerId, setRequireServerId] = useState(false);
  const [allowUnverifiedPurchase, setAllowUnverifiedPurchase] = useState(false);
  const [customerNote, setCustomerNote] = useState('');
  const [customFields, setCustomFields] = useState<AdminTopUpCustomField[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = (index: number, patch: Partial<AdminTopUpCustomField>) => {
    setCustomFields((fields) => fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const addField = () => {
    setCustomFields((fields) => [...fields, { key: '', label: '', required: false, placeholder: '' }]);
  };

  const removeField = (index: number) => {
    setCustomFields((fields) => fields.filter((_, i) => i !== index));
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await upsertAdminTopUpGameConfig({
        gameId,
        requirePlayerId,
        requireServerId,
        allowUnverifiedPurchase,
        customerNote: customerNote || null,
        customFields: customFields.length > 0 ? customFields : null
      });
      setGameId('');
      setRequirePlayerId(true);
      setRequireServerId(false);
      setAllowUnverifiedPurchase(false);
      setCustomerNote('');
      setCustomFields([]);
      onDone();
    } catch (err) {
      setError(humanizeError('Unable to save game input configuration', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-slate-100">Configure game input</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Game">
          <Select value={gameId} onChange={(e) => setGameId(e.target.value)} required>
            <option value="" disabled>Select game</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>{game.name}</option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={requirePlayerId} onChange={(e) => setRequirePlayerId(e.target.checked)} />
          Require Player ID
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={requireServerId} onChange={(e) => setRequireServerId(e.target.checked)} />
          Require Server ID
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300" title="Only for games whose provider category does NOT support ID verification. When the provider supports verification, it is always enforced.">
          <input type="checkbox" checked={allowUnverifiedPurchase} onChange={(e) => setAllowUnverifiedPurchase(e.target.checked)} />
          Allow purchase without ID verification (unsupported games only)
        </label>
      </div>
      <div className="mt-3">
        <Field label="Customer note" hint="Shown to customers before checkout">
          <Textarea value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-200">Custom fields</p>
          <Badge tone={customFields.length > 0 ? 'success' : 'muted'}>{customFields.length} configured</Badge>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Add custom input fields customers must fill in (e.g. nickname, zone ID). Keys must be letters, numbers, and underscores.
        </p>
        {customFields.length === 0 ? (
          <p className="text-xs text-slate-500">No custom fields configured.</p>
        ) : (
          <div className="space-y-2">
            {customFields.map((field, index) => (
              <div key={index} className="grid gap-2 rounded-md border border-slate-700 bg-slate-900 p-2 sm:grid-cols-4">
                <Input
                  value={field.key}
                  onChange={(e) => updateField(index, { key: e.target.value })}
                  placeholder="key (e.g. nickname)"
                />
                <Input
                  value={field.label}
                  onChange={(e) => updateField(index, { label: e.target.value })}
                  placeholder="Label (e.g. Nickname)"
                />
                <Input
                  value={field.placeholder ?? ''}
                  onChange={(e) => updateField(index, { placeholder: e.target.value })}
                  placeholder="Placeholder (optional)"
                />
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-slate-300">
                    <input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} />
                    Required
                  </label>
                  <Button variant="danger" onClick={() => removeField(index)}>Remove</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button variant="ghost" className="mt-3" onClick={addField}>+ Add field</Button>
      </div>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy || !gameId} onClick={submit}>{busy ? 'Saving…' : 'Save configuration'}</Button>
      </div>
    </div>
  );
}

// ==================== PROVIDER VALIDATION SUPPORT (live metadata) ====================

function ValidationSupportPanel() {
  const support = useAsync(() => getAdminTopUpValidationSupport(), []);
  const [search, setSearch] = useState('');

  if (support.loading) return <p className="text-xs text-slate-500">Checking provider validation support…</p>;
  if (support.error) return <p className="text-xs text-amber-400">Validation support unavailable: {support.error}</p>;

  const categories = support.data?.categories ?? [];
  const filtered = search.trim()
    ? categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.categoryId.includes(search.toLowerCase()))
    : categories;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Provider ID-validation support</h3>
          <p className="text-xs text-slate-400">
            Live from the provider. Games whose service matches a category below REQUIRE account verification before purchase — automatically, no per-game configuration.
          </p>
        </div>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search game…" />
      </div>
      {filtered.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-500">
          No validation-supported categories matched. Games outside this list cannot be verified; enable “Allow purchase without ID verification” for them if needed.
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-900 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Game</th>
                <th className="px-3 py-2">Category ID</th>
                <th className="px-3 py-2">Required fields</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cat) => (
                <tr key={cat.categoryId} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-200">{cat.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{cat.categoryId}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{cat.fields.map((f) => f.label).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GameConfigRow({ config, games, onChanged }: {
  config: AdminTopUpGameConfig;
  games: AdminTopUpGame[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [requirePlayerId, setRequirePlayerId] = useState(config.requirePlayerId);
  const [requireServerId, setRequireServerId] = useState(config.requireServerId);
  const [customerNote, setCustomerNote] = useState(config.customerNote ?? '');
  const [customFields, setCustomFields] = useState<AdminTopUpCustomField[]>(config.customFields ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gameName = games.find((g) => g.id === config.game)?.name ?? config.game;

  const updateField = (index: number, patch: Partial<AdminTopUpCustomField>) => {
    setCustomFields((fields) => fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const addField = () => {
    setCustomFields((fields) => [...fields, { key: '', label: '', required: false, placeholder: '' }]);
  };

  const removeField = (index: number) => {
    setCustomFields((fields) => fields.filter((_, i) => i !== index));
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await upsertAdminTopUpGameConfig({
        gameId: config.game,
        requirePlayerId,
        requireServerId,
        customerNote: customerNote || null,
        customFields: customFields.length > 0 ? customFields : null
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to save configuration', err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = window.confirm(`Delete input configuration for "${gameName}"?`);
    if (!confirmed) return;
    setError(null);
    setBusy(true);
    try {
      await deleteAdminTopUpGameConfig(config.game);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to delete configuration', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-slate-200">{gameName}</p>
          <p className="text-xs text-slate-400">
            Player ID: {requirePlayerId ? 'Required' : 'Optional'} · Server ID: {requireServerId ? 'Required' : 'Optional'} · {customFields.length} custom field{customFields.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-1.5">
          {editing ? (
            <>
              <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          )}
          <Button variant="danger" onClick={remove}>Delete</Button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={requirePlayerId} onChange={(e) => setRequirePlayerId(e.target.checked)} />
              Require Player ID
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={requireServerId} onChange={(e) => setRequireServerId(e.target.checked)} />
              Require Server ID
            </label>
          </div>
          <Field label="Customer note">
            <Textarea value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} />
          </Field>
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <p className="mb-2 text-sm font-medium text-slate-200">Custom fields</p>
            {customFields.length === 0 ? (
              <p className="text-xs text-slate-500">No custom fields configured.</p>
            ) : (
              <div className="space-y-2">
                {customFields.map((field, index) => (
                  <div key={index} className="grid gap-2 rounded-md border border-slate-700 bg-slate-900 p-2 sm:grid-cols-4">
                    <Input value={field.key} onChange={(e) => updateField(index, { key: e.target.value })} placeholder="key" />
                    <Input value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} placeholder="Label" />
                    <Input value={field.placeholder ?? ''} onChange={(e) => updateField(index, { placeholder: e.target.value })} placeholder="Placeholder" />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-slate-300">
                        <input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} />
                        Required
                      </label>
                      <Button variant="danger" onClick={() => removeField(index)}>Remove</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button variant="ghost" className="mt-2" onClick={addField}>+ Add field</Button>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
