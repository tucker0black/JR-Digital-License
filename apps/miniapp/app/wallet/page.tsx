'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createDeposit, expirePayment, getPaymentStatus, getWallet, ApiError, type WalletTransaction } from '@/lib/api';
import { StoreHeader } from '@/components/StoreHeader';
import { formatDateTime } from '@/lib/format';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';

const QrDisplay = dynamic(
  () => import('@/components/QrDisplay').then((module) => module.QrDisplay),
  { loading: () => <div className="h-64 w-64 rounded-xl bg-muted" /> }
);

const DEPOSIT_PRESETS = [1, 2, 5, 10, 20];

const TX_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: 'Deposit',
  PURCHASE: 'Purchase',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
  BONUS: 'Bonus'
};

const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'];

function formatRemaining(expiresAt?: string | null): string {
  if (!expiresAt) return '';
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function WalletPage() {
  const { status: telegramStatus } = useTelegramAuth();
  const [balance, setBalance] = useState<string | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [depositOpen, setDepositOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('5.00');
  const [depositCreating, setDepositCreating] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositPayment, setDepositPayment] = useState<{
    id: string;
    reference: string;
    expiresAt?: string | null;
    qrCodeData?: string;
    qrCodeImage?: string;
    paymentUrl?: string;
    amount?: string;
    currency?: string;
    merchantName?: string;
    resumed?: boolean;
  } | null>(null);
  const [depositStatus, setDepositStatus] = useState('PENDING');
  const [depositVerificationError, setDepositVerificationError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState('');
  const depositPaymentIdRef = useRef<string | null>(null);
  const [conflictPayment, setConflictPayment] = useState<{
    id: string;
    amount?: string;
    currency?: string;
    expiresAt?: string | null;
  } | null>(null);
  const [pendingRequestedAmount, setPendingRequestedAmount] = useState<string | null>(null);

  const loadWallet = useCallback(async () => {
    try {
      const result = await getWallet();
      setBalance(result.wallet.balance);
      setCurrency(result.wallet.currency);
      setTransactions(result.transactions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load wallet');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    void loadWallet();
  }, [loadWallet, telegramStatus]);

  useEffect(() => {
    const id = depositPaymentIdRef.current;
    if (!id) return;

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const stopPolling = () => {
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };
    const getNextDelay = () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed <= 5 * 60 * 1000) return 5_000;
      if (elapsed <= 15 * 60 * 1000) return 10_000;
      if (elapsed <= 60 * 60 * 1000) return 15_000;
      return 300_000;
    };
    const poll = () => {
      if (document.visibilityState !== 'visible') return;
        getPaymentStatus(id)
        .then((result) => {
          setDepositStatus(result.payment.status);
          setDepositVerificationError(result.verificationError ?? null);
          if (result.payment.status === 'SUCCEEDED') {
            void loadWallet();
          }
          if (result.isExpired || TERMINAL_STATUSES.includes(result.payment.status)) {
            stopPolling();
            return;
          }
          timeout = setTimeout(poll, getNextDelay());
        })
        .catch(() => {
          // Transient failures should not kill the session.
          timeout = setTimeout(poll, getNextDelay());
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        stopPolling();
        poll();
      } else {
        stopPolling();
      }
    };

    poll();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [depositPayment?.id, loadWallet]);

  useEffect(() => {
    if (!depositPayment?.expiresAt) {
      setRemaining('');
      return;
    }
    const update = () => setRemaining(formatRemaining(depositPayment.expiresAt));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [depositPayment?.expiresAt]);

  const handleCreateDeposit = useCallback(async () => {
    const normalizedAmount = customAmount.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedAmount)) {
      setDepositError('Enter a valid deposit amount');
      return;
    }
    const amount = Number(normalizedAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDepositError('Enter a valid deposit amount');
      return;
    }
    setDepositError(null);
    setDepositCreating(true);
    try {
      const result = await createDeposit({
        amount: amount.toFixed(2),
        currency,
        idempotencyKey: `deposit_ui_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      });
      setConflictPayment(null);
      setPendingRequestedAmount(null);
      setDepositPayment({
        ...result.payment,
        amount: result.payment.amount ?? amount.toFixed(2),
        currency: result.payment.currency ?? currency,
        resumed: result.resumed ?? false
      });
      setDepositStatus('PENDING');
      setDepositVerificationError(null);
      depositPaymentIdRef.current = result.payment.id;
      if (result.resumed) {
        setCustomAmount(result.payment.amount ?? customAmount);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as {
          error?: string;
          activePayment?: { id: string; amount?: string; currency?: string; expiresAt?: string | null };
        } | undefined;
        setDepositPayment(null);
        depositPaymentIdRef.current = null;
        setConflictPayment(body?.activePayment ?? null);
        setPendingRequestedAmount(amount.toFixed(2));
        setDepositError(body?.error ?? 'Another deposit is already active. Cancel it first.');
        return;
      }
      setDepositPayment(null);
      depositPaymentIdRef.current = null;
      setDepositError(err instanceof Error ? err.message : 'Unable to create deposit');
    } finally {
      setDepositCreating(false);
    }
  }, [customAmount, currency]);

  const handleResetDeposit = useCallback(() => {
    setDepositStatus('PENDING');
    setDepositVerificationError(null);
    setDepositPayment(null);
    depositPaymentIdRef.current = null;
    setDepositError(null);
    setConflictPayment(null);
    setPendingRequestedAmount(null);
  }, []);

  const handleCancelDeposit = useCallback(async () => {
    const id = depositPaymentIdRef.current;
    if (!id) return;
    try {
      await expirePayment(id);
    } catch {
      // best effort
    }
    setDepositStatus('EXPIRED');
    setDepositVerificationError(null);
    setDepositPayment(null);
    depositPaymentIdRef.current = null;
  }, []);

  const handleCancelConflictAndCreateNew = useCallback(async () => {
    if (!conflictPayment?.id) return;
    try {
      await expirePayment(conflictPayment.id);
    } catch {
      // best effort — the server will reject the new deposit if the old one is still active
    }
    setConflictPayment(null);
    setPendingRequestedAmount(null);
    setDepositError(null);
    void handleCreateDeposit();
  }, [conflictPayment, handleCreateDeposit]);

  if (telegramStatus !== 'ready') {
    return (
      <main className="min-h-screen bg-page text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
          <TelegramAuthNotice />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <section className="relative overflow-hidden rounded-3xl border border-line bg-card p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Wallet Balance</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-ink">
                {currency} {loading ? '—' : Number(balance ?? 0).toFixed(2)}
              </p>
              <p className="mt-1 text-sm text-soft">
                Use your balance to pay for orders instantly
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDepositOpen(!depositOpen);
                setDepositError(null);
              }}
              disabled={loading}
              className="rounded-xl bg-primary px-5 py-2.5 font-medium text-white shadow-sm shadow-primary/30 transition hover:bg-primary-dark disabled:opacity-50"
            >
              {depositOpen ? 'Close' : '+ Deposit'}
            </button>
          </div>
        </section>

        {error && (
          <div className="mt-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            {error}
          </div>
        )}

        {depositOpen && conflictPayment && !depositPayment && (
          <section className="animate-fade-up mt-4 rounded-2xl border border-warning/30 bg-warning/10 p-5">
            <p className="font-semibold text-warning">Another deposit is already active</p>
            <p className="mt-1 text-sm text-soft">
              An active payment session for{' '}
              <span className="font-bold text-ink">
                {conflictPayment.currency ?? currency} {Number(conflictPayment.amount ?? 0).toFixed(2)}
              </span>{' '}
              {conflictPayment.expiresAt ? (
                <>is still valid until {formatDateTime(conflictPayment.expiresAt)}.</>
              ) : (
                <>is still valid.</>
              )}
            </p>
            <p className="mt-1 text-sm text-soft">
              Your requested amount of{' '}
              <span className="font-bold text-ink">
                {currency} {Number(pendingRequestedAmount ?? 0).toFixed(2)}
              </span>{' '}
              was not created. Cancel the old deposit to create the new one.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCancelConflictAndCreateNew()}
                disabled={depositCreating}
                className="rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
              >
                {depositCreating ? 'Creating payment…' : 'Cancel Old Deposit & Create New'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConflictPayment(null);
                  setPendingRequestedAmount(null);
                  setDepositError(null);
                }}
                className="rounded-xl border border-line bg-page px-5 py-2.5 font-medium text-ink transition hover:border-primary/40"
              >
                Keep Old Deposit
              </button>
            </div>
          </section>
        )}

        {depositOpen && !depositPayment && !conflictPayment && (
          <section className="animate-fade-up mt-4 rounded-2xl border border-line bg-card p-5">
            <h2 className="font-semibold text-ink">Deposit via KHQR / Bakong</h2>
            <p className="mt-1 text-sm text-soft">
              Choose an amount. A payment QR will be generated — scan and pay with the Bakong app.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {DEPOSIT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setCustomAmount(preset.toFixed(2));
                  }}
                  className={`rounded-xl border px-4 py-2 font-medium transition ${
                    parseFloat(customAmount) === preset
                      ? 'border-primary bg-primary text-white'
                      : 'border-line bg-page text-ink hover:border-primary/40'
                  }`}
                >
                  {currency} {preset}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-sm text-soft">Custom amount</label>
              <input
                type="number"
                min="0.5"
                step="0.01"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-line bg-page px-3 py-2 text-ink outline-none focus:border-primary sm:max-w-xs"
              />
            </div>
            {depositError && <p className="mt-3 text-sm text-danger">{depositError}</p>}
            <button
              type="button"
              onClick={() => void handleCreateDeposit()}
              disabled={depositCreating}
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
            >
              {depositCreating ? 'Creating payment…' : 'Create Deposit QR'}
            </button>
          </section>
        )}

        {depositPayment && depositStatus === 'SUCCEEDED' && (
          <section className="animate-fade-up mt-4 rounded-2xl border border-success/30 bg-success/10 p-5 text-center">
            <div className="mb-2 text-2xl text-success">✓</div>
            <p className="font-medium text-success">Deposit completed</p>
            <p className="mt-1 text-sm text-success">Your balance has been updated.</p>
            <button
              type="button"
              onClick={handleResetDeposit}
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-dark"
            >
              Create New Deposit
            </button>
          </section>
        )}

        {depositPayment &&
          (depositStatus === 'EXPIRED' || depositStatus === 'CANCELLED' || depositStatus === 'FAILED') && (
            <section className="animate-fade-up mt-4 rounded-2xl border border-line bg-card p-5 text-center">
              <p className="font-medium text-danger">
                  {depositStatus === 'FAILED' ? 'Deposit failed' : depositStatus === 'EXPIRED' ? 'Payment expired' : 'Deposit session closed'}
              </p>
              <p className="mt-1 text-sm text-soft">
                  {depositStatus === 'EXPIRED'
                  ? 'The payment session expired. No money was charged — create a new payment QR to try again.'
                  : depositStatus === 'CANCELLED'
                    ? 'The payment session was cancelled. No money was charged — you can create a new deposit.'
                    : 'The deposit could not be completed. No money was charged.'}
              </p>
              <button
                type="button"
                onClick={handleResetDeposit}
                className="mt-4 rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-dark"
              >
                Create New Deposit
              </button>
            </section>
          )}

        {depositPayment && !TERMINAL_STATUSES.includes(depositStatus) && (
          <section className="animate-fade-up mt-4 rounded-2xl border border-line bg-card p-5">
            {depositPayment.resumed && (
              <p className="mb-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                A payment session for the same amount is already active and was kept — it stays valid until it expires. You can cancel it below and create a new one.
              </p>
            )}
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink">Scan to deposit</h2>
              <span className="rounded-full border border-line bg-page px-3 py-1 text-sm font-medium text-soft">
                {depositStatus}
              </span>
            </div>
            <div className="mt-3 space-y-2 text-sm text-soft">
              <div className="flex justify-between">
                <span>Reference</span>
                <span className="font-mono text-xs text-ink">{depositPayment.reference}</span>
              </div>
              {depositPayment.merchantName && (
                <div className="flex justify-between">
                  <span>Merchant</span>
                  <span className="font-medium text-ink">{depositPayment.merchantName}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Amount</span>
                <span className="font-bold text-primary">
                  {depositPayment.currency ?? currency} {Number(depositPayment.amount ?? 0).toFixed(2)}
                </span>
              </div>
              {remaining && (
                <div className="flex justify-between">
                  <span>Expires in</span>
                  <span className={`font-mono ${remaining === 'Expired' ? 'text-danger' : 'text-ink'}`}>
                    {remaining}
                  </span>
                </div>
              )}
            </div>
            {depositPayment.qrCodeData && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <QrDisplay
                  value={depositPayment.qrCodeImage ?? depositPayment.qrCodeData}
                  alt="KHQR deposit"
                />
                <p className="text-xs text-soft">Scan with the Bakong / KHQR app to deposit</p>
              </div>
            )}
            {depositVerificationError && (
              <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-center text-xs text-warning">
                {depositVerificationError}
              </p>
            )}
            {depositPayment.paymentUrl && (
              <a
                href={depositPayment.paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block rounded-xl bg-primary px-4 py-3 text-center font-medium text-white"
              >
                Open Payment Page
              </a>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const id = depositPaymentIdRef.current;
                  if (!id) return;
                  getPaymentStatus(id)
                    .then((result) => {
                      setDepositStatus(result.payment.status);
                      setDepositVerificationError(result.verificationError ?? null);
                      if (result.payment.status === 'SUCCEEDED') void loadWallet();
                    })
                    .catch(() => setDepositError('Unable to refresh payment status'));
                }}
                className="flex-1 rounded-xl border border-line bg-page px-4 py-2 font-medium text-ink hover:border-primary/40"
              >
                Refresh Status
              </button>
              <button
                type="button"
                onClick={() => void handleCancelDeposit()}
                className="flex-1 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2 font-medium text-danger hover:bg-danger/20"
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-lg font-bold tracking-tight text-ink">Transactions</h2>
          {transactions.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-line bg-card p-6 text-center text-sm text-soft">
              No transactions yet. Deposit to your wallet to get started.
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card">
              {transactions.map((tx) => {
                const amount = Number(tx.amount);
                const isCredit = tx.type === 'DEPOSIT' || tx.type === 'REFUND' || tx.type === 'BONUS';
                return (
                  <li key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {TX_TYPE_LABELS[tx.type] ?? tx.type}
                        <span className="ml-2 text-xs font-normal text-soft">{tx.status}</span>
                      </p>
                      <p className="truncate text-xs text-soft">
                        {tx.reason || tx.reference}
                      </p>
                      <p className="mt-0.5 text-xs text-soft">{formatDateTime(tx.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${isCredit ? 'text-success' : 'text-ink'}`}>
                        {isCredit ? '+' : '−'}{currency} {amount.toFixed(2)}
                      </p>
                      <p className="text-xs text-soft">Balance {currency} {Number(tx.balanceAfter).toFixed(2)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
