'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { createOrder } from '@/lib/api';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';

const PaymentPanel = dynamic(
  () => import('@/components/PaymentPanel').then((module) => module.PaymentPanel),
  { loading: () => <div className="rounded-2xl border border-line bg-card p-4 text-center text-sm text-soft">Loading payment options…</div> }
);

interface BuyButtonProps {
  productId: string;
  price: string;
  currency: string;
  minimumQuantity: number;
  maximumQuantity?: number | null;
  isOutOfStock: boolean;
  availableStock?: number;
}

export function BuyButton({
  productId,
  price,
  currency,
  minimumQuantity,
  maximumQuantity,
  isOutOfStock,
  availableStock
}: BuyButtonProps) {
  const { status: telegramStatus } = useTelegramAuth();
  const minimumAllowedQuantity = Math.max(1, minimumQuantity);
  const maximumAllowedQuantity = Math.min(
    maximumQuantity ?? Number.POSITIVE_INFINITY,
    availableStock ?? Number.POSITIVE_INFINITY
  );
  const outOfStock = isOutOfStock || availableStock === 0 || maximumAllowedQuantity < minimumAllowedQuantity;
  const [quantity, setQuantity] = useState(minimumAllowedQuantity);
  const [quantityInput, setQuantityInput] = useState(String(minimumAllowedQuantity));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{
    id: string;
    orderNumber: number;
    total: string;
    currency: string;
  } | null>(null);

  const total = Number(price) * quantity;

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
    if (outOfStock) return;
    if (quantity < minimumAllowedQuantity || quantity > maximumAllowedQuantity) return;

    setLoading(true);
    setError(null);

    try {
      const idempotencyKey = `${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const result = await createOrder({ productId, quantity, idempotencyKey });
      setOrder({
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        total: result.order.total,
        currency: result.order.currency
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create order');
    } finally {
      setLoading(false);
    }
  };

  if (telegramStatus !== 'ready') {
    return <TelegramAuthNotice />;
  }

  if (order) {
    return (
      <PaymentPanel
        orderId={order.id}
        orderNumber={order.orderNumber}
        orderTotal={Number(order.total).toFixed(2)}
        orderCurrency={order.currency}
        provider="KHQR"
        autoCreate
      />
    );
  }

  if (outOfStock) {
    return (
      <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-center">
        <p className="font-medium text-danger">Out of Stock</p>
        <p className="mt-1 text-sm text-soft">This product is currently unavailable</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div>
        <label className="mb-2 block text-sm text-soft">Quantity</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={handleDecrement}
            disabled={quantity <= minimumAllowedQuantity || loading}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-muted/40 text-ink transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            −
          </button>
           <input
             type="number"
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
            className="flex-1 rounded-xl border border-line bg-muted/40 px-4 py-2 text-center text-ink outline-none focus:border-primary"
          />
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={handleIncrement}
            disabled={quantity >= maximumAllowedQuantity || loading}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-muted/40 text-ink transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            +
          </button>
        </div>
        {availableStock !== undefined && availableStock > 0 && (
          <p className="mt-2 text-xs text-soft">Available: {availableStock}</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-soft">Total</p>
          <p className="text-2xl font-bold text-primary">
            {currency === 'USD' ? '$' : ''}
            {total.toFixed(2)} {currency}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreateOrder}
          disabled={loading}
          className="rounded-xl bg-primary px-6 py-3 font-medium text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Order'}
        </button>
      </div>

      {error && (
        <p className="text-center text-sm text-danger">{error}</p>
      )}
    </div>
  );
}
