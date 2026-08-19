'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPayment, expirePayment, getPaymentStatus } from '@/lib/api';
import { QrDisplay } from '@/components/QrDisplay';

export interface PaymentPanelProps {
  orderId: string;
  orderNumber?: number;
  orderTotal: string;
  orderCurrency: string;
  provider?: 'KHQR';
  autoCreate?: boolean;
}

interface PaymentInfo {
  id: string;
  reference: string;
  providerPaymentId?: string;
  expiresAt?: string | null;
  paymentUrl?: string;
  qrCodeData?: string;
  qrCodeImage?: string;
  merchantName?: string;
}

const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'];

function formatRemaining(expiresAt?: string | null): string {
  if (!expiresAt) return '';
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const statusStyles: Record<string, string> = {
  PENDING: 'bg-warning/15 text-warning',
  PROCESSING: 'bg-primary/15 text-primary',
  SUCCEEDED: 'bg-success/15 text-success',
  FAILED: 'bg-danger/15 text-danger',
  EXPIRED: 'bg-danger/15 text-danger',
  CANCELLED: 'bg-muted text-soft'
};

export function PaymentPanel({
  orderId,
  orderNumber,
  orderTotal,
  orderCurrency,
  provider = 'KHQR',
  autoCreate = false
}: PaymentPanelProps) {
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [status, setStatus] = useState('PENDING');
  const [loading, setLoading] = useState(autoCreate);
  const [creating, setCreating] = useState(autoCreate);
  const [error, setError] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const paymentIdRef = useRef<string | null>(null);
  const autoCreateStarted = useRef(false);
  const [remaining, setRemaining] = useState('');

  const handleCreatePayment = useCallback(
    async (withSpinner: boolean) => {
      setError(null);
      if (withSpinner) setLoading(true);
      setCreating(true);
      try {
        const result = await createPayment({ orderId, provider });
        setPayment(result.payment);
        setStatus('PENDING');
        setVerificationError(null);
        paymentIdRef.current = result.payment.id;
      } catch (err) {
        setPayment(null);
        paymentIdRef.current = null;
        setStatus('FAILED');
        setError(err instanceof Error ? err.message : 'Unable to generate payment QR');
      } finally {
        setLoading(false);
        setCreating(false);
      }
    },
    [orderId, provider]
  );

  useEffect(() => {
    if (autoCreate && !autoCreateStarted.current) {
      autoCreateStarted.current = true;
      void handleCreatePayment(false);
    }
  }, [autoCreate, handleCreatePayment]);

  useEffect(() => {
    const id = paymentIdRef.current;
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
          setStatus(result.payment.status);
          setVerificationError(result.verificationError ?? null);
          if (result.isExpired || TERMINAL_STATUSES.includes(result.payment.status)) {
            stopPolling();
            return;
          }
          timeout = setTimeout(poll, getNextDelay());
        })
        .catch(() => {
          // Keep polling; transient failures should not kill the session.
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
  }, [payment?.id]);

  useEffect(() => {
    if (!payment?.expiresAt) {
      setRemaining('');
      return;
    }
    const update = () => setRemaining(formatRemaining(payment.expiresAt));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [payment?.expiresAt]);

  if (!payment) {
    if (creating || loading) {
      return (
        <div className="rounded-2xl border border-line bg-card p-4 text-center">
          <p className="font-medium text-ink">Generating payment…</p>
          <p className="mt-1 text-sm text-soft">Creating a secure payment session</p>
        </div>
      );
    }

    return (
      <div className="space-y-3 rounded-2xl border border-line bg-card p-4 text-center">
        <p className="font-medium text-danger">{error || 'Unable to generate payment QR'}</p>
        <button
          type="button"
          onClick={() => void handleCreatePayment(true)}
          disabled={loading}
          className="rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
        >
          {loading ? 'Retrying…' : 'Retry Payment'}
        </button>
      </div>
    );
  }

  const isTerminal = TERMINAL_STATUSES.includes(status);

  if (status === 'SUCCEEDED') {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-center">
        <div className="mb-2 text-2xl text-success">✓</div>
        <p className="font-medium text-success">Payment Completed</p>
        <p className="mt-1 text-sm text-soft">Order has been paid successfully</p>
      </div>
    );
  }

  if (status === 'EXPIRED' || status === 'CANCELLED' || status === 'FAILED') {
    return (
      <div className="space-y-3 rounded-2xl border border-line bg-card p-4 text-center">
        <p className="font-medium text-danger">
          {status === 'FAILED' ? 'Payment failed' : 'Payment session expired'}
        </p>
        <p className="text-sm text-soft">
          {error || 'No money was charged. You can start a new payment session.'}
        </p>
        <button
          type="button"
          onClick={() => void handleCreatePayment(true)}
          disabled={loading}
          className="rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
        >
          {loading ? 'Creating…' : 'Create New Payment'}
        </button>
      </div>
    );
  }

  const statusStyle = statusStyles[status] || 'bg-muted text-soft';

  return (
    <div className="animate-fade-up space-y-4 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink">KHQR Payment</h2>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusStyle}`}>
          {status}
        </span>
      </div>

      {orderNumber !== undefined && (
        <p className="text-sm text-soft">
          Order: <span className="font-semibold text-ink">#{orderNumber}</span>
        </p>
      )}

      <div className="space-y-2 text-sm">
        {payment.merchantName && (
          <div className="flex justify-between">
            <span className="text-soft">Merchant</span>
            <span className="font-medium text-ink">{payment.merchantName}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-soft">Reference</span>
          <span className="max-w-[150px] truncate font-mono text-xs text-ink">
            {payment.reference}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-soft">Amount</span>
          <span className="font-bold text-primary">
            {orderTotal} {orderCurrency}
          </span>
        </div>
        {remaining && (
          <div className="flex justify-between">
            <span className="text-soft">Expires in</span>
            <span className={`font-mono ${remaining === 'Expired' ? 'text-danger' : 'text-ink'}`}>
              {remaining}
            </span>
          </div>
        )}
      </div>

      {payment.qrCodeData && (
        <div className="flex flex-col items-center gap-2">
          <QrDisplay
            value={payment.qrCodeImage ?? payment.qrCodeData}
            alt={`KHQR payment for order ${orderNumber !== undefined ? `#${orderNumber}` : ''}`}
          />
          <p className="text-xs text-soft">Scan with the Bakong / KHQR app to pay</p>
        </div>
      )}

      {payment.paymentUrl && (
        <a
          href={payment.paymentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl bg-primary px-4 py-3 text-center font-medium text-white transition hover:bg-primary-dark"
        >
          Open Payment Page
        </a>
      )}

      {!isTerminal && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const id = paymentIdRef.current;
              if (!id) return;
               getPaymentStatus(id)
                .then((result) => {
                  setStatus(result.payment.status);
                  setVerificationError(result.verificationError ?? null);
                })
                .catch(() => setError('Unable to refresh payment status'));
            }}
            disabled={loading}
            className="flex-1 rounded-xl border border-line bg-muted/40 px-4 py-2 font-medium text-ink transition hover:border-primary/40 disabled:opacity-50"
          >
            Refresh Status
          </button>
          <button
            type="button"
            onClick={() => {
              if (!payment) return;
              setLoading(true);
                expirePayment(payment.id)
                .then(() => {
                  setStatus('EXPIRED');
                  paymentIdRef.current = null;
                  setError(null);
                })
                .catch(() => setError('Unable to expire payment'))
                .finally(() => setLoading(false));
            }}
            disabled={loading}
            className="flex-1 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2 font-medium text-danger transition hover:bg-danger/20 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="text-center text-sm text-danger">{error}</p>}
      {verificationError && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-center text-xs text-warning">
          {verificationError}
        </p>
      )}
    </div>
  );
}
