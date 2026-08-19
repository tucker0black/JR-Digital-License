'use client';

import { useCallback, useEffect, useState } from 'react';
import { getOrders } from '@/lib/api';
import type { Order } from '@/lib/api';
import { OrderCard } from '@/components/OrderCard';
import { StoreHeader } from '@/components/StoreHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';

export default function OrdersPage() {
  const { status: telegramStatus } = useTelegramAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getOrders({ page: 1, pageSize: 20 });
      setOrders(result.orders);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    void loadOrders();
  }, [loadOrders, telegramStatus]);

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Orders</h1>
          {!loading && !error && (
            <p className="mt-1 text-sm text-soft">
              {total} order{total !== 1 ? 's' : ''} in total
            </p>
          )}
        </header>

        {telegramStatus !== 'ready' ? (
          <TelegramAuthNotice />
        ) : loading ? (
          <p className="text-sm text-soft">Loading orders...</p>
        ) : error ? (
          <EmptyState
            title="Unable to load orders"
            description={error}
            action={<Button href="/">Back to Home</Button>}
          />
        ) : orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Your purchases will appear here."
            action={<Button href="/store">Browse Store</Button>}
          />
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
