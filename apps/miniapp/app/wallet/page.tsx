'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createDeposit, expirePayment, getPaymentStatus, getWallet, ApiError, type WalletTransaction } from '@/lib/api';
import { StoreHeader } from '@/components/StoreHeader';
import { useTranslation } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';

const QrDisplay = dynamic(
  () => import('@/components/QrDisplay').then((module) => module.QrDisplay),
  { loading: () => <div className="h-64 w-64 rounded-2xl bg-muted" /> }
);

const DEPOSIT_PRESETS = [1, 2, 5, 10, 20];

const TX_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: 'wallet.txDeposit',
  PURCHASE: 'wallet.txPurchase',
  REFUND: 'wallet.txRefund',
  ADJUSTMENT: 'wallet.txAdjustment',
  BONUS: 'wallet.txBonus'
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
  return (
    <Suspense>
      <WalletContent />
    </Suspense>
  );
}

function WalletContent() {
  const searchParams = useSearchParams();
  const { status: telegramStatus } = useTelegramAuth();
  const { t } = useTranslation();
  const [balance, setBalance] = useState<string | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [depositOpen, setDepositOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('5.00');
  const [topUpGame, setTopUpGame] = useState<string | null>(null);
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
    abapayDeeplink?: string;
    checkoutQrUrl?: string;
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
      setError(err instanceof Error ? err.message : t('store.unableToLoad'));
    } finally {
      setLoading(false);
    }
    // Deliberately not keyed on t: switching language must not refetch data.
  }, []);

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    void loadWallet();
  }, [loadWallet, telegramStatus]);

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    const amountParam = searchParams.get('amount');
    const gameParam = searchParams.get('game');
    if (gameParam) setTopUpGame(gameParam);
    if (amountParam && /^\d+(?:\.\d{1,2})?$/.test(amountParam)) {
      setCustomAmount(amountParam);
      setDepositOpen(true);
    }
  }, [searchParams, telegramStatus]);

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
      setDepositError(t('wallet.enterValidAmount'));
      return;
    }
    const amount = Number(normalizedAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDepositError(t('wallet.enterValidAmount'));
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
        setDepositError(body?.error ?? t('wallet.activeDeposit'));
        return;
      }
      setDepositPayment(null);
      depositPaymentIdRef.current = null;
      setDepositError(err instanceof Error ? err.message : t('wallet.enterValidAmount'));
    } finally {
      setDepositCreating(false);
    }
  }, [customAmount, currency, t]);

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
      const result = await expirePayment(id);
      if (result.paid && result.status === 'SUCCEEDED') {
        setDepositStatus('SUCCEEDED');
        setDepositVerificationError(null);
        setDepositError(null);
        depositPaymentIdRef.current = null;
        void loadWallet();
        return;
      }
      if (result.status === 'SUCCEEDED') {
        setDepositStatus('SUCCEEDED');
        setDepositVerificationError(null);
        setDepositError(null);
        depositPaymentIdRef.current = null;
        void loadWallet();
        return;
      }
    } catch {
      // best effort
    }
    setDepositStatus('EXPIRED');
    setDepositVerificationError(null);
    setDepositPayment(null);
    depositPaymentIdRef.current = null;
  }, [loadWallet]);

  const handleCancelConflictAndCreateNew = useCallback(async () => {
    if (!conflictPayment?.id) return;
    try {
      const result = await expirePayment(conflictPayment.id);
      if (result.paid && result.status === 'SUCCEEDED') {
        setConflictPayment(null);
        setPendingRequestedAmount(null);
        setDepositError(null);
        setDepositStatus('SUCCEEDED');
        void loadWallet();
        return;
      }
    } catch {
      // best effort
    }
    setConflictPayment(null);
    setPendingRequestedAmount(null);
    setDepositError(null);
    void handleCreateDeposit();
  }, [conflictPayment, handleCreateDeposit, loadWallet]);

  if (telegramStatus !== 'ready') {
    return (
      <main className="min-h-screen bg-page bg-cosmic text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
          <TelegramAuthNotice />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        {/* Balance card */}
        <section className="animate-fade-up relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-violet to-accent p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-white/5 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide-premium text-white/50">{t('wallet.title')}</p>
              <p className="mt-2 text-4xl font-bold tracking-premium text-white tabular-nums">
                {currency} {loading ? '\u2014' : Number(balance ?? 0).toFixed(2)}
              </p>
              <p className="mt-1 text-sm text-white/60">{t('wallet.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDepositOpen(!depositOpen);
                setDepositError(null);
              }}
              disabled={loading}
              className="rounded-xl bg-white/20 px-5 py-2.5 font-semibold text-white backdrop-blur-sm transition-default hover:bg-white/30 active:scale-95 disabled:opacity-50"
            >
              {depositOpen ? t('wallet.close') : t('wallet.deposit')}
            </button>
          </div>
        </section>

        {error && (
          <div className="mt-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            {error}
          </div>
        )}

        {/* Conflict payment */}
        {depositOpen && conflictPayment && !depositPayment && (
          <section className="animate-fade-up mt-4 rounded-2xl border border-warning/30 bg-warning/10 p-5">
            <p className="font-semibold text-warning">{t('wallet.activeDeposit')}</p>
            <p className="mt-1 text-sm text-soft">
              {t('wallet.activeDepositDescription', {
                amount: `${conflictPayment.currency ?? currency} ${Number(conflictPayment.amount ?? 0).toFixed(2)}`,
                expiry: conflictPayment.expiresAt ? ` ${t('wallet.activeDepositUntil', { date: formatDateTime(conflictPayment.expiresAt) })}` : '',
              })}
            </p>
            <p className="mt-1 text-sm text-soft">
              {t('wallet.requestedAmountNotCreated', { amount: `${currency} ${Number(pendingRequestedAmount ?? 0).toFixed(2)}` })}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCancelConflictAndCreateNew()}
                disabled={depositCreating}
                className="rounded-xl bg-gradient-to-r from-primary to-violet px-5 py-2.5 font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95 disabled:opacity-50"
              >
                {depositCreating ? t('wallet.creatingPaymentDots') : t('wallet.cancelOldAndCreateNew')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConflictPayment(null);
                  setPendingRequestedAmount(null);
                  setDepositError(null);
                }}
                className="rounded-xl border border-line bg-card px-5 py-2.5 font-medium text-ink transition-default hover:border-primary/40"
              >
                {t('wallet.keepOldDeposit')}
              </button>
            </div>
          </section>
        )}

        {/* Deposit form */}
        {depositOpen && !depositPayment && !conflictPayment && (
          <section className="animate-fade-up mt-4 rounded-2xl card-cosmic p-5">
            <h2 className="font-semibold text-ink">{t('wallet.depositViaPayWay')}</h2>
            <p className="mt-1 text-sm text-soft">
              {t('wallet.chooseAmount')}
            </p>
            {topUpGame && (
              <p className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                {t('wallet.depositForGame', { game: topUpGame })}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {DEPOSIT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCustomAmount(preset.toFixed(2))}
                  className={`rounded-xl border px-4 py-2.5 font-semibold transition-default ${
                    parseFloat(customAmount) === preset
                      ? 'border-primary bg-gradient-to-r from-primary to-violet text-white shadow-md shadow-primary/20'
                      : 'border-line bg-card text-ink hover:border-primary/40'
                  }`}
                >
                  {currency} {preset}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-soft">{t('wallet.customAmount')}</label>
              <input
                type="number"
                min="0.5"
                step="0.01"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15 sm:max-w-xs"
              />
            </div>
            {depositError && <p className="mt-3 text-sm text-danger">{depositError}</p>}
            <button
              type="button"
              onClick={() => void handleCreateDeposit()}
              disabled={depositCreating}
              className="mt-5 rounded-xl bg-gradient-to-r from-primary to-violet px-5 py-3 font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95 disabled:opacity-50"
            >
              {depositCreating ? t('wallet.creatingPayment') : t('wallet.createDepositPayWay')}
            </button>
          </section>
        )}

        {/* Success */}
        {depositPayment && depositStatus === 'SUCCEEDED' && (
          <section className="animate-fade-up mt-4 rounded-2xl border border-success/30 bg-success/10 p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/20">
              <span className="text-xl text-success">✓</span>
            </div>
            <p className="font-semibold text-success">{t('wallet.depositCompleted')}</p>
            <p className="mt-1 text-sm text-success/80">{t('wallet.balanceUpdated')}</p>
            <button
              type="button"
              onClick={handleResetDeposit}
              className="mt-4 rounded-xl bg-gradient-to-r from-primary to-violet px-5 py-2.5 font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95"
            >
              {t('wallet.createNewDeposit')}
            </button>
          </section>
        )}

        {/* Expired/Failed/Cancelled */}
        {depositPayment &&
          (depositStatus === 'EXPIRED' || depositStatus === 'CANCELLED' || depositStatus === 'FAILED') && (
            <section className="animate-fade-up mt-4 rounded-2xl card-cosmic p-5 text-center">
              <p className="font-medium text-danger">
                  {depositStatus === 'FAILED' ? t('wallet.depositFailed') : depositStatus === 'EXPIRED' ? t('wallet.paymentExpired') : t('wallet.depositClosed')}
              </p>
              <p className="mt-1 text-sm text-soft">
                  {depositStatus === 'EXPIRED'
                  ? t('wallet.expiredDescription')
                  : depositStatus === 'CANCELLED'
                    ? t('wallet.cancelledDescription')
                    : t('wallet.failedDescription')}
              </p>
              <button
                type="button"
                onClick={handleResetDeposit}
                className="mt-4 rounded-xl bg-gradient-to-r from-primary to-violet px-5 py-2.5 font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95"
              >
                {t('wallet.createNewDeposit')}
              </button>
            </section>
          )}

        {/* Active payment checkout */}
        {depositPayment && !TERMINAL_STATUSES.includes(depositStatus) && (
          <section className="animate-fade-up mt-4 rounded-2xl card-cosmic p-5">
            {depositPayment.resumed && (
              <p className="mb-4 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                {t('wallet.resumedSessionNote')}
              </p>
            )}
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink">{t('wallet.payWayPayment')}</h2>
              <span className="rounded-lg border border-line bg-muted px-3 py-1 text-xs font-medium text-soft">
                {depositStatus}
              </span>
            </div>
            <div className="mt-4 space-y-2.5 text-sm text-soft">
              <div className="flex justify-between">
                <span>{t('wallet.reference')}</span>
                <span className="font-mono text-xs text-ink">{depositPayment.reference}</span>
              </div>
              {depositPayment.merchantName && (
                <div className="flex justify-between">
                  <span>{t('wallet.merchant')}</span>
                  <span className="font-medium text-ink">{depositPayment.merchantName}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>{t('wallet.amount')}</span>
                <span className="font-bold text-primary">
                  {depositPayment.currency ?? currency} {Number(depositPayment.amount ?? 0).toFixed(2)}
                </span>
              </div>
              {remaining && (
                <div className="flex justify-between">
                  <span>{t('wallet.expiresIn')}</span>
                  <span className={`font-mono ${remaining === 'Expired' ? 'text-danger' : 'text-ink'}`}>
                    {remaining}
                  </span>
                </div>
              )}
            </div>
            {depositPayment.paymentUrl ? (
              <div className="mt-5">
                <a
                  href={depositPayment.paymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full rounded-xl bg-gradient-to-r from-primary to-violet px-5 py-3 text-center font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95"
                >
                  {t('wallet.payNow') || 'Pay Now'}
                </a>
                <p className="mt-2 text-center text-xs text-soft">
                  {t('wallet.checkoutNote') || 'You will be redirected to KHQR.cc to complete payment'}
                </p>
              </div>
            ) : depositPayment.qrCodeData ? (
              <>
                <div className="mt-5 flex flex-col items-center gap-2">
                  <QrDisplay
                    value={depositPayment.qrCodeData}
                    alt="KHQR deposit"
                  />
                  <p className="text-center text-xs text-soft">{t('payment.scanToPayAnyApp')}</p>
                </div>
              </>
            ) : null}
            {depositPayment.abapayDeeplink && (
              <div className="mt-4">
                <a
                  href={depositPayment.abapayDeeplink}
                  className="block w-full rounded-xl bg-gradient-to-r from-primary to-violet px-5 py-3 text-center font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95"
                >
                  {t('wallet.openAbaMobile')}
                </a>
                <p className="mt-2 text-center text-xs text-soft">
                  {t('wallet.deeplinkNote')}
                </p>
              </div>
            )}
            {depositVerificationError && (
              <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-center text-xs text-warning">
                {depositVerificationError}
              </p>
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
                    .catch(() => setDepositError(t('store.unableToLoad')));
                }}
                className="flex-1 rounded-xl border border-line bg-card px-4 py-2.5 font-medium text-ink transition-default hover:border-primary/40"
              >
                {t('wallet.refreshStatus')}
              </button>
              <button
                type="button"
                onClick={() => void handleCancelDeposit()}
                className="flex-1 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 font-medium text-danger transition-default hover:bg-danger/20"
              >
                {t('wallet.cancel')}
              </button>
            </div>
          </section>
        )}

        {/* Transactions */}
        <section className="mt-8">
          <h2 className="text-lg font-bold tracking-premium text-ink">{t('wallet.transactions')}</h2>
          {transactions.length === 0 ? (
            <div className="mt-3 rounded-2xl card-cosmic p-6 text-center text-sm text-muted-text">
              {t('wallet.noTransactions')}
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {transactions.map((tx) => {
                const amount = Number(tx.amount);
                const isCredit = tx.type === 'DEPOSIT' || tx.type === 'REFUND' || tx.type === 'BONUS';
                return (
                  <li key={tx.id} className="flex items-center justify-between gap-3 rounded-2xl card-cosmic p-4 transition-luxury hover:-translate-y-0.5 hover:shadow-md">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                        isCredit ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
                      }`}>
                        {isCredit ? '+' : '\u2212'}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">
                          {t(TX_TYPE_LABELS[tx.type] ?? tx.type)}
                        </p>
                        <p className="truncate text-xs text-muted-text">
                          {tx.reason || tx.reference}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-text/70">{formatDateTime(tx.createdAt)}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`whitespace-nowrap text-sm font-bold tabular-nums ${isCredit ? 'text-success' : 'text-ink'}`}>
                        {isCredit ? '+' : '\u2212'}{currency} {amount.toFixed(2)}
                      </p>
                      <p className="whitespace-nowrap text-[10px] text-muted-text">{t('wallet.balanceAfterLabel', { amount: `${currency} ${Number(tx.balanceAfter).toFixed(2)}` })}</p>
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
