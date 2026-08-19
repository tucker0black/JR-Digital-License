'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button, Field, Input } from '@/components/admin/ui';
import { adminLogin, getAdminToken, isAdminApiError } from '@/lib/api-admin';
import { humanizeError } from '@/lib/errors';

export default function AdminLoginPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getAdminToken()) {
      router.replace('/admin');
    }
  }, [router]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminLogin(token.trim());
      router.replace('/admin');
    } catch (err: unknown) {
      if (isAdminApiError(err)) {
        setError(err.status === 401 || err.status === 403 ? 'Invalid admin token' : err.message);
      } else {
        setError(humanizeError('Unable to sign in', err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-card p-6">
        <h1 className="text-lg font-semibold text-slate-100">JR Digital license</h1>
        <p className="mt-1 text-sm text-slate-400">Admin Dashboard</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="Admin token" hint="Provided when the admin account was created.">
            <Input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your admin API token"
              required
            />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={loading || !token.trim()} className="w-full">
            {loading ? 'Verifying…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}