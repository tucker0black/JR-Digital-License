'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { getWallet, payOrderWithWallet } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';

const PaymentPanel = dynamic(
  () => import('@/components/PaymentPanel').then((module) => module.PaymentPanel),
  { loading: () => <PaymentOptionsLoading /> }
);

function PaymentOptionsLoading() {
  const { t } = useTranslation();
  return <div className="rounded-2xl border border-line bg-card p-4 text-center text-sm text-soft">{t('cart.loadingPaymentOptions')}</div>;
}

interface PaymentActionsProps {
  orderId: string;
  orderNumber?: number;
  orderStatus: string;
  orderTotal: string;
  orderCurrency: string;
}

export function PaymentActions({
  orderId,
  orderNumber,
  orderStatus,
  orderTotal,
  orderCurrency
}: PaymentActionsProps) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<'KHQRCC' | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletPaying, setWalletPaying] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletPaid, setWalletPaid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWallet()
      .then((result) => {
        if (!cancelled) setWalletBalance(Number(result.wallet.balance));
      })
      .catch(() => {
        if (!cancelled) setWalletBalance(null);
      })
      .finally(() => {
        if (!cancelled) setWalletLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const isPaid = walletPaid || orderStatus === 'PAID' || orderStatus === 'COMPLETED';
  const isExpired = orderStatus === 'EXPIRED' || orderStatus === 'CANCELLED';
  const isPayable = orderStatus === 'DRAFT' || orderStatus === 'PAYMENT_PENDING';

  if (isPaid) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-center">
        <div className="mb-2 text-2xl text-success">✓</div>
        <p className="font-medium text-success">{t('payment.completedTitle')}</p>
        <p className="mt-1 text-sm text-soft">{t('payment.completedDescription')}</p>
      </div>
    );
  }

  if (isExpired) {
    return (
      <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-center">
        <p className="font-medium text-danger">{t('payment.expiredTitle')}</p>
        <p className="mt-1 text-sm text-soft">{t('payment.expiredDescription')}</p>
      </div>
    );
  }

  if (!isPayable) {
    return (
      <div className="rounded-2xl border border-line bg-card p-4 text-center">
        <p className="font-medium text-soft">{t('payment.unavailableStatus')}</p>
      </div>
    );
  }

  if (provider) {
    return (
      <PaymentPanel
        orderId={orderId}
        orderNumber={orderNumber}
        orderTotal={orderTotal}
        orderCurrency={orderCurrency}
        provider={provider}
        autoCreate
      />
    );
  }

  const total = Number(orderTotal);
  const balanceKnown = walletBalance !== null;
  const canPayWithWallet = balanceKnown && walletBalance >= total;
  const hasActiveKhqrSession = walletError !== null && walletError.toLowerCase().includes('active payment session');

  const handleWalletPay = async () => {
    setWalletError(null);
    setWalletPaying(true);
    try {
      await payOrderWithWallet(
        orderId,
        `wallet_ui_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      );
      setWalletPaid(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('payment.walletPayError');
      setWalletError(message);
      if (message.toLowerCase().includes('active payment session')) {
        setProvider('KHQRCC');
      }
    } finally {
      setWalletPaying(false);
    }
  };

  return (
    <div className="animate-fade-up space-y-4 rounded-2xl border border-line/50 bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-ink">{t('payment.methodTitle')}</p>
        <span className="text-sm text-soft">
          {t('payment.totalPrefix')} <strong className="text-primary">{orderTotal} {orderCurrency}</strong>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void handleWalletPay()}
          disabled={walletLoading || walletPaying || !canPayWithWallet}
          className={`flex flex-col items-center gap-1 rounded-xl border px-4 py-3.5 font-medium transition-luxury disabled:cursor-not-allowed disabled:opacity-50 ${
            canPayWithWallet
              ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:shadow-glow-sm'
              : 'border-line/50 bg-muted/30 text-soft'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <rect x="3" y="6" width="18" height="14" rx="3" />
            <path d="M3 10h18" />
            <circle cx="16.5" cy="15.5" r="1.5" />
          </svg>
          <span className="text-ink">{t('payment.payWithWallet')}</span>
          <span className="text-xs text-soft">
            {walletLoading
              ? t('payment.checkingBalance')
              : balanceKnown
                ? t('payment.balanceLabel', { amount: `${orderCurrency} ${walletBalance.toFixed(2)}` })
                : t('payment.balanceUnavailable')}
          </span>
          {walletPaying && <span className="text-xs">{'Processing\u2026'}</span>}
        </button>

        <button
          type="button"
          onClick={() => {
            setWalletError(null);
            setProvider('KHQRCC');
          }}
          className="flex flex-col items-center gap-1 rounded-xl border border-line/50 bg-card px-4 py-3.5 font-medium text-ink transition-luxury hover:border-primary/30 hover:bg-primary/5 hover:shadow-glow-sm"
        >
          <span className="text-lg">&#x1F3E6;</span>
          <span>{t('payment.payWithKhqrcc')}</span>
          <span className="text-xs text-soft">{t('payment.payViaKhqrccCheckout')}</span>
        </button>
      </div>

      {balanceKnown && !canPayWithWallet && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-medium text-warning">{t('payment.insufficientTitle')}</p>
          <p className="mt-1 text-soft">
            {t('payment.insufficientDescription', {
              balance: `${orderCurrency} ${walletBalance.toFixed(2)}`,
              total: `${orderCurrency} ${orderTotal}`
            })}
          </p>
          <Link
            href="/wallet"
            className="mt-2 inline-block font-medium text-primary transition hover:text-primary-dark"
          >
            {t('payment.depositLink')}
          </Link>
        </div>
      )}

      {canPayWithWallet && (
        <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
          <p className="font-medium text-success">{t('payment.sufficientTitle')}</p>
          <p className="mt-1 text-soft">
            {t('payment.sufficientDescription', { balance: `${orderCurrency} ${walletBalance.toFixed(2)}` })}
          </p>
        </div>
      )}

      {walletError && !hasActiveKhqrSession && (
        <p className="text-sm text-danger">{walletError}</p>
      )}

      {hasActiveKhqrSession && (
        <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
          <p className="font-medium text-primary">{t('payment.activeSessionTitle')}</p>
          <p className="mt-1 text-soft">
            {t('payment.activeSessionDescription')}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-line/30 bg-muted/30 p-3 text-sm text-soft">
        <p>{t('payment.sessionsExpireNote')}</p>
      </div>
    </div>
  );
}