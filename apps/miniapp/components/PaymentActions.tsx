'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { getWallet, payOrderWithWallet } from '@/lib/api';

const PaymentPanel = dynamic(
  () => import('@/components/PaymentPanel').then((module) => module.PaymentPanel),
  { loading: () => <div className="rounded-2xl border border-line bg-card p-4 text-center text-sm text-soft">Loading payment options…</div> }
);

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
  const [provider, setProvider] = useState<'KHQR' | null>(null);
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
        <p className="font-medium text-success">Payment Completed</p>
        <p className="mt-1 text-sm text-soft">Order has been paid successfully</p>
      </div>
    );
  }

  if (isExpired) {
    return (
      <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-center">
        <p className="font-medium text-danger">Payment Expired</p>
        <p className="mt-1 text-sm text-soft">The payment session has expired</p>
      </div>
    );
  }

  if (!isPayable) {
    return (
      <div className="rounded-2xl border border-line bg-card p-4 text-center">
        <p className="font-medium text-soft">Payment not available for this order status</p>
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

  const canPayWithWallet = walletBalance !== null && walletBalance >= Number(orderTotal);

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
      setWalletError(err instanceof Error ? err.message : 'Unable to pay with wallet balance');
    } finally {
      setWalletPaying(false);
    }
  };

  return (
    <div className="animate-fade-up space-y-4 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div>
        <label className="mb-2 block text-sm text-soft">Select Payment Method</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setProvider('KHQR')}
            className="flex flex-col items-center gap-1 rounded-xl border border-line bg-muted/40 px-4 py-3.5 font-medium text-ink transition hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="text-lg">🏦</span>
            <span>KHQR / Bakong</span>
            <span className="text-xs text-soft">Scan with Bakong app</span>
          </button>
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-muted/30 px-4 py-3.5">
            <span className="text-lg">👛</span>
            <span className="font-medium text-ink">Wallet Balance</span>
            <span className="text-xs text-soft">
              Balance: {orderCurrency}{' '}
              {walletBalance !== null ? walletBalance.toFixed(2) : '—'}
            </span>
          </div>
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => void handleWalletPay()}
          disabled={walletLoading || walletPaying || !canPayWithWallet}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 font-medium text-primary transition hover:bg-primary/20 disabled:opacity-50"
        >
          {walletLoading
            ? 'Checking balance…'
            : walletBalance === null
              ? 'Pay with Balance'
              : canPayWithWallet
                ? `Pay ${orderTotal} ${orderCurrency} with Balance`
                : `Insufficient balance (${orderCurrency} ${walletBalance.toFixed(2)})`}
          {walletPaying && <span>…</span>}
        </button>
        {walletError && <p className="mt-2 text-sm text-danger">{walletError}</p>}
        {!canPayWithWallet && walletBalance !== null && (
          <Link
            href="/wallet"
            className="mt-2 block text-center text-sm font-medium text-primary transition hover:text-primary-dark"
          >
            + Deposit to your wallet
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-muted/40 p-3 text-sm text-soft">
        <p>
          <strong className="text-ink">Total:</strong> {orderTotal} {orderCurrency}
        </p>
        <p className="mt-1">Payment sessions expire automatically and never charge twice.</p>
      </div>
    </div>
  );
}
