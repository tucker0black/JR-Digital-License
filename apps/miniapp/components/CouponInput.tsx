'use client';

import { useEffect, useRef, useState } from 'react';
import { validateCoupon } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import type { ValidateCouponResponse } from '@jr/shared';

interface CouponInputProps {
  productId: string;
  quantity: number;
  onApply: (result: ValidateCouponResponse) => void;
  onRemove: () => void;
  appliedCoupon: ValidateCouponResponse | null;
}

export function CouponInput({ productId, quantity, onApply, onRemove, appliedCoupon }: CouponInputProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the last product/quantity/code combination validated server-side so
  // the applied discount always matches the CURRENT cart, never a stale one.
  const validatedKeyRef = useRef('');

  const handleApply = async () => {
    if (!code.trim()) return;

    try {
      setLoading(true);
      setError(null);

      const result = await validateCoupon({
        code: code.trim(),
        productId,
        quantity
      });

      if (result.valid) {
        validatedKeyRef.current = `${productId}:${quantity}:${result.coupon?.code ?? ''}`;
        onApply(result);
        setCode('');
      } else {
        // Business rejection — show the generic translated message, never raw server text.
        setError(t('coupon.invalidCoupon'));
      }
    } catch {
      // Network/server/auth failures get the same friendly translated message.
      setError(t('coupon.applyFailed'));
    } finally {
      setLoading(false);
    }
  };

  // The database coupon configuration is the single source of truth: whenever
  // the quantity (or product) changes, re-validate against the API and swap in
  // the recomputed discount. If the coupon is no longer valid for the new cart
  // (minimum order, limits, restrictions…), remove it instead of showing a
  // discount the checkout would not honor.
  useEffect(() => {
    const appliedCode = appliedCoupon?.valid ? appliedCoupon.coupon?.code : undefined;
    if (!appliedCode) return;

    const key = `${productId}:${quantity}:${appliedCode}`;
    if (validatedKeyRef.current === key) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await validateCoupon({ code: appliedCode, productId, quantity });
        if (cancelled) return;
        if (result.valid && result.coupon?.code === appliedCode) {
          validatedKeyRef.current = key;
          onApply(result);
        } else {
          validatedKeyRef.current = '';
          onRemove();
        }
      } catch {
        // Transient failure — keep the current state; order creation still
        // re-validates and prices authoritatively on the backend.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedCoupon, productId, quantity, onApply, onRemove]);

  const handleRemove = () => {
    onRemove();
    validatedKeyRef.current = '';
    setCode('');
    setError(null);
  };

  if (appliedCoupon) {
    return (
      <div className="flex items-center justify-between p-3 rounded-xl bg-success/10 border border-success/30">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-5 h-5 text-success"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-success">
              {appliedCoupon.coupon?.code}
            </p>
            <p className="text-xs text-soft">
              {t('coupon.discountAmount', { amount: appliedCoupon.discountAmount ?? '0' })}
            </p>
          </div>
        </div>
        <button
          onClick={handleRemove}
          className="text-xs text-soft/70 hover:text-soft transition-colors"
        >
          {t('coupon.remove')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t('coupon.codePlaceholder')}
          className="flex-1 px-3 py-2 rounded-xl border border-line bg-card text-sm text-ink placeholder:text-muted-text/50 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          disabled={loading}
        />
        <button
          onClick={handleApply}
          disabled={!code.trim() || loading}
          className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            t('coupon.apply')
          )}
        </button>
      </div>
      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}
    </div>
  );
}