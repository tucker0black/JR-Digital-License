'use client';

import { useState } from 'react';
import { Badge, Button, Card, ErrorState, Field, Input, LoadingState, PageHeader, StatusBadge, Table, formatDate } from '@/components/admin/ui';
import { useAsync } from '@/components/admin/use-async';
import { humanizeError } from '@/lib/errors';
import {
  createAdminNotificationTarget,
  deleteAdminNotificationTarget,
  getAdminNotificationTargets,
  getAdminSettings,
  testAdminNotificationTarget,
  updateAdminNotificationTarget,
  updateAdminSetting
} from '@/lib/api-admin';

const NOTIFICATION_EVENT_TYPES = [
  'NEW_PAID_ORDER',
  'FULFILLMENT_FAILURE',
  'LOW_INVENTORY',
  'FAILED_PAYMENT',
  'EXPIRED_PAYMENT',
  'REFUND',
  'WALLET_ADJUSTMENT',
  'HIGH_VALUE_ORDER'
];

export default function AdminSettingsPage() {
  const settings = useAsync(() => getAdminSettings(), []);
  const targets = useAsync(() => getAdminNotificationTargets(), []);

  const refresh = () => {
    settings.reload();
    targets.reload();
  };

  if (settings.loading && targets.loading) return <LoadingState label="Loading settings…" />;
  if (settings.error) return <ErrorState error={settings.error} onRetry={refresh} />;

  return (
    <div>
      <PageHeader title="Settings" description="Application settings and notification targets" />

      <Card title="Application settings" description="Secret credentials are never shown or editable here" className="mb-4">
        {settings.data && settings.data.settings.length > 0 ? (
          <Table headers={['Key', 'Value', 'Description', 'Updated', 'Actions']}>
            {settings.data.settings.map((setting) => (
              <SettingRow key={setting.key} setting={setting} onChanged={refresh} />
            ))}
          </Table>
        ) : (
          <p className="text-sm text-slate-500">No application settings have been created yet.</p>
        )}
      </Card>

      <NotificationTargetsCard targets={targets.data?.targets ?? []} onChanged={refresh} />
    </div>
  );
}

function SettingRow({ setting, onChanged }: {
  setting: { key: string; value: unknown; description: string | null; updatedAt: string };
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    typeof setting.value === 'object' && setting.value !== null ? JSON.stringify(setting.value) : String(setting.value ?? '')
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valueKind = typeof setting.value;

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      let parsed: unknown = value;
      if (valueKind === 'object' && value.trim()) parsed = JSON.parse(value);
      await updateAdminSetting(setting.key, parsed);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to save setting', err));
    } finally {
      setBusy(false);
    }
  };

  const displayValue = valueKind === 'object'
    ? JSON.stringify(setting.value)
    : String(setting.value ?? '—');

  return (
    <tr>
      <td className="px-3 py-2">
        <p className="font-medium text-slate-200">{setting.key}</p>
        {setting.description && <p className="text-xs text-slate-500">{setting.description}</p>}
      </td>
      <td className="max-w-48 truncate px-3 py-2 text-slate-300">
        {editing ? (
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <span title={displayValue}>{displayValue}</span>
        )}
      </td>
      <td className="px-3 py-2 text-slate-400">{formatDate(setting.updatedAt)}</td>
      <td className="px-3 py-2">
        {editing ? (
          <div className="flex gap-1.5">
            <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        )}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  );
}

function NotificationTargetsCard({ targets, onChanged }: {
  targets: { id: string; chatId: string; name: string; channel: string; eventTypes: string[]; isActive: boolean; createdAt: string }[];
  onChanged: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [chatId, setChatId] = useState('');
  const [name, setName] = useState('');
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; error: string | null } | null>(null);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      await createAdminNotificationTarget({ chatId, name, eventTypes });
      setShowCreate(false);
      setChatId('');
      setName('');
      setEventTypes([]);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to create setting', err));
    } finally {
      setBusy(false);
    }
  };

  const testTarget = async (target: { id: string; chatId: string; name: string }) => {
    setTestResult(null);
    try {
      const result = await testAdminNotificationTarget(target.id);
      setTestResult({ id: target.id, success: result.success, error: result.error });
    } catch (err) {
      setTestResult({ id: target.id, success: false, error: humanizeError('Unable to send test message', err) });
    }
  };

  const toggleEventType = (eventType: string) => {
    setEventTypes((current) =>
      current.includes(eventType) ? current.filter((t) => t !== eventType) : [...current, eventType]
    );
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await updateAdminNotificationTarget(id, { isActive: !isActive });
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to update setting', err));
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this notification target?')) return;
    try {
      await deleteAdminNotificationTarget(id);
      onChanged();
    } catch (err) {
      setError(humanizeError('Unable to delete setting', err));
    }
  };

  return (
    <Card
      title="Notification targets"
      description="Telegram groups/chats that receive store event notifications"
      action={<Button variant="ghost" onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : '+ Add target'}</Button>}
    >
      {showCreate && (
        <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Chat ID" hint="Numeric Telegram chat/group ID">
              <Input value={chatId} onChange={(e) => setChatId(e.target.value)} required placeholder="-1001234567890" />
            </Field>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Sales group" />
            </Field>
          </div>
          <Field label="Event types">
            <div className="flex flex-wrap gap-2">
              {NOTIFICATION_EVENT_TYPES.map((eventType) => (
                <button
                  key={eventType}
                  type="button"
                  onClick={() => toggleEventType(eventType)}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${
                    eventTypes.includes(eventType)
                      ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {eventType}
                </button>
              ))}
            </div>
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button disabled={busy || !chatId || !name} onClick={create}>{busy ? 'Creating…' : 'Create target'}</Button>
        </div>
      )}

      {targets.length > 0 ? (
        <Table headers={['Name', 'Chat ID', 'Channel', 'Events', 'Status', 'Actions']}>
          {targets.map((target) => (
            <tr key={target.id}>
              <td className="px-3 py-2 font-medium text-slate-200">{target.name}</td>
              <td className="px-3 py-2 text-slate-400">{target.chatId}</td>
              <td className="px-3 py-2"><StatusBadge status={target.channel === 'TELEGRAM_GROUP' ? 'TELEGRAM GROUP' : 'TELEGRAM USER'} /></td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {target.eventTypes.length > 0 ? (
                    target.eventTypes.map((eventType) => (
                      <Badge key={eventType} tone="accent">{eventType}</Badge>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">all events</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">{target.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Disabled</Badge>}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1.5">
                  <Button variant="ghost" onClick={() => void testTarget(target)}>Test</Button>
                  <Button variant="ghost" onClick={() => toggleActive(target.id, target.isActive)}>
                    {target.isActive ? 'Disable' : 'Enable'}
                  </Button>
                  <Button variant="danger" onClick={() => remove(target.id)}>Delete</Button>
                </div>
                {testResult && testResult.id === target.id && (
                  <p className={`mt-1 text-xs ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testResult.success ? 'Test message sent to this chat.' : `Test failed: ${testResult.error}`}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="text-sm text-slate-500">No notification targets configured. Add the admin group to receive order notifications.</p>
      )}
    </Card>
  );
}