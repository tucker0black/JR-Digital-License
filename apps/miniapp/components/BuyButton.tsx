'use client';

import { useMemo, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { createOrder, type SmmServiceOption } from '@/lib/api';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { CouponInput } from '@/components/CouponInput';
import { useTranslation } from '@/lib/i18n';
import type { ValidateCouponResponse } from '@jr/shared';

const PaymentActions = dynamic(
  () => import('@/components/PaymentActions').then((module) => module.PaymentActions),
  {
    loading: () => <BuyButtonPaymentLoading />
  }
);

function BuyButtonPaymentLoading() {
  const { t } = useTranslation();
  return <div className="rounded-2xl card-cosmic p-4 text-center text-sm text-soft">{t('cart.loadingPaymentOptions')}</div>;
}

interface BuyButtonProps {
  productId: string;
  price: string;
  currency: string;
  minimumQuantity: number;
  maximumQuantity?: number | null;
  isOutOfStock: boolean;
  availableStock?: number;
  isSmm?: boolean;
  services?: SmmServiceOption[];
}

export function BuyButton({
  productId,
  price,
  currency,
  minimumQuantity,
  maximumQuantity,
  isOutOfStock,
  availableStock,
  isSmm = false,
  services = []
}: BuyButtonProps) {
  const { status: telegramStatus } = useTelegramAuth();
  const { t } = useTranslation();
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  const selectedService = useMemo(() => {
    if (!isSmm || services.length === 0) return null;
    return services.find((s) => s.id === selectedServiceId) ?? services[0] ?? null;
  }, [isSmm, services, selectedServiceId]);

  const minimumAllowedQuantity = isSmm
    ? Math.max(1, selectedService?.minimumQuantity ?? minimumQuantity)
    : Math.max(1, minimumQuantity);
  const maximumAllowedQuantity = isSmm
    ? selectedService?.maximumQuantity ?? maximumQuantity ?? Number.POSITIVE_INFINITY
    : Math.min(
        maximumQuantity ?? Number.POSITIVE_INFINITY,
        availableStock ?? Number.POSITIVE_INFINITY
      );
  const outOfStock = isSmm
    ? services.length === 0
    : isOutOfStock || availableStock === 0 || maximumAllowedQuantity < minimumAllowedQuantity;

  const [quantity, setQuantity] = useState(minimumAllowedQuantity);
  const [quantityInput, setQuantityInput] = useState(String(minimumAllowedQuantity));
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{
    id: string;
    orderNumber: number;
    total: string;
    currency: string;
  } | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<ValidateCouponResponse | null>(null);
  // Synchronous guard: repeated clicks within one task can never double-submit
  // (state updates alone are not enough because they flush asynchronously).
  const submittingRef = useRef(false);

  const baseTotal = Number(price) * quantity;
  const discountAmount = appliedCoupon?.discountAmount ? parseFloat(appliedCoupon.discountAmount) : 0;
  // Clamp at zero: the backend is the pricing authority, this display must
  // never show a negative total even while a coupon revalidation is in flight.
  const total = Math.max(0, baseTotal - discountAmount);

  const handleSelectService = useCallback((serviceId: string) => {
    setSelectedServiceId(serviceId);
    const service = services.find((s) => s.id === serviceId);
    if (service) {
      const nextQuantity = Math.max(service.minimumQuantity, 1);
      setQuantity(nextQuantity);
      setQuantityInput(String(nextQuantity));
    }
  }, [services]);

  const handleIncrement = useCallback(() => {
    const nextQuantity = Math.min(quantity + 1, maximumAllowedQuantity);
    setQuantity(nextQuantity);
    setQuantityInput(String(nextQuantity));
  }, [maximumAllowedQuantity, quantity]);

  const handleDecrement = useCallback(() => {
    const nextQuantity = Math.max(quantity - 1, minimumAllowedQuantity);
    setQuantity(nextQuantity);
    setQuantityInput(String(nextQuantity));
  }, [minimumAllowedQuantity, quantity]);

  const handleCreateOrder = async () => {
    if (submittingRef.current) return; // hard guard against rapid double-clicks
    if (outOfStock) return;
    if (quantity < minimumAllowedQuantity || quantity > maximumAllowedQuantity) return;
    if (isSmm) {
      if (!selectedService) return;
      if (!target.trim()) {
        setError(t('cart.enterTarget'));
        return;
      }
    }

    submittingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const idempotencyKey = `${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const result = await createOrder({
        productId,
        quantity,
        target: isSmm ? target.trim() : undefined,
        serviceId: isSmm ? selectedService?.id : undefined,
        idempotencyKey,
        couponCode: appliedCoupon?.valid ? appliedCoupon.coupon?.code : undefined
      });
      setOrder({
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        total: result.order.total,
        currency: result.order.currency
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cart.unableToCreate'));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  if (telegramStatus !== 'ready') {
    return <TelegramAuthNotice />;
  }

  if (order) {
    return (
      <PaymentActions
        orderId={order.id}
        orderNumber={order.orderNumber}
        orderStatus="DRAFT"
        orderTotal={Number(order.total).toFixed(2)}
        orderCurrency={order.currency}
      />
    );
  }

  if (outOfStock) {
    return (
      <div className="rounded-2xl border border-danger/20 bg-danger/10 p-5 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-danger/20">
          <span className="text-danger">✕</span>
        </div>
        <p className="font-medium text-danger">{t('product.outOfStock')}</p>
        <p className="mt-1 text-sm text-soft">
          {isSmm ? t('cart.outOfStockService') : t('cart.outOfStockProduct')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl card-cosmic p-4 sm:p-5">
      {isSmm && services.length > 0 && (
        <div>
          <label className="mb-2 block text-sm font-medium text-soft">{t('cart.chooseService')}</label>
          <div className="space-y-2">
            {services.map((service) => (
              <button
                key={service.id}
                type="button"
                onClick={() => handleSelectService(service.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-default ${
                  selectedService?.id === service.id
                    ? 'border-primary bg-primary/10 ring-2 ring-primary/15'
                    : 'border-line bg-card hover:border-primary/40'
                }`}
              >
                <span className="block font-medium text-ink">{service.name}</span>
                <span className="mt-0.5 block text-xs text-soft">
                  {t('cart.minMax', { min: service.minimumQuantity, max: service.maximumQuantity })}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isSmm && (
        <div>
          <label htmlFor="smm-target" className="mb-2 block text-sm font-medium text-soft">
            {t('cart.targetLabel')}
          </label>
          <input
            id="smm-target"
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={t('cart.targetPlaceholder')}
            maxLength={500}
            className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-soft">{t('cart.quantity')}</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={t('cart.decreaseQuantity')}
            onClick={handleDecrement}
            disabled={quantity <= minimumAllowedQuantity || loading}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-card text-ink transition-default hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
          >
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            value={quantityInput}
            onChange={(e) => {
              const value = e.target.value;
              if (!/^\d*$/.test(value)) return;
              setQuantityInput(value);
              if (value === '') return;
              const nextQuantity = Number(value);
              if (Number.isSafeInteger(nextQuantity)) {
                setQuantity(Math.min(Math.max(nextQuantity, minimumAllowedQuantity), maximumAllowedQuantity));
              }
            }}
            onBlur={() => {
              const parsedQuantity = Number(quantityInput);
              const nextQuantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0
                ? Math.min(Math.max(parsedQuantity, minimumAllowedQuantity), maximumAllowedQuantity)
                : minimumAllowedQuantity;
              setQuantity(nextQuantity);
              setQuantityInput(String(nextQuantity));
            }}
            min={minimumAllowedQuantity}
            max={Number.isFinite(maximumAllowedQuantity) ? maximumAllowedQuantity : undefined}
            className="flex-1 rounded-xl border border-line bg-card px-4 py-2.5 text-center text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <button
            type="button"
            aria-label={t('cart.increaseQuantity')}
            onClick={handleIncrement}
            disabled={quantity >= maximumAllowedQuantity || loading}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-card text-ink transition-default hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
          >
            +
          </button>
        </div>
        {!isSmm && availableStock !== undefined && availableStock > 0 && (
          <p className="mt-2 text-xs text-soft">{t('cart.availableLabel', { count: availableStock })}</p>
        )}
      </div>

      {!isSmm && (
        <CouponInput
          productId={productId}
          quantity={quantity}
          onApply={setAppliedCoupon}
          onRemove={() => setAppliedCoupon(null)}
          appliedCoupon={appliedCoupon}
        />
      )}

      {/* Stacks vertically on narrow phones so price and CTA never collide */}
      <div className="space-y-3 sm:flex sm:items-end sm:justify-between sm:gap-4 sm:space-y-0">
        <div>
          <p className="text-sm text-soft">Total</p>
          {discountAmount > 0 && (
            <p className="text-xs text-success line-through">
              {currency === 'USD' ? '$' : ''}{baseTotal.toFixed(2)}
            </p>
          )}
          <p className="text-2xl font-bold text-primary">
            {currency === 'USD' ? '$' : ''}
            {total.toFixed(2)} <span className="text-sm font-medium text-soft">{currency}</span>
          </p>
          {discountAmount > 0 && (
            <p className="text-xs text-success">-{currency === 'USD' ? '$' : ''}{discountAmount.toFixed(2)} discount</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleCreateOrder}
          disabled={loading}
          className="w-full rounded-xl bg-gradient-to-r from-primary to-violet px-6 py-3 font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:shrink-0"
        >
          {loading ? t('cart.creating') : t('cart.createOrder')}
        </button>
      </div>

      {error && (
        <p className="text-center text-sm text-danger">{error}</p>
      )}
    </div>
  );
}
